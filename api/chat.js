import { CharacterAI } from '../lib/characterai.js';
import { ConversationStorage } from '../lib/storage.js';

const storage = new ConversationStorage();

function generateConversationId(characterId, userId = 'default') {
  return `${userId}_${characterId}`;
}

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
}

function ensureMessageIds(conversation) {
  let changed = false;
  conversation.messages = conversation.messages.map(m => {
    if (!m.id) {
      changed = true;
      return { ...m, id: genId() };
    }
    return m;
  });
  return changed;
}

function convertToOpenAIFormat(text, characterName = 'Assistant') {
  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: characterName,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: text
      },
      finish_reason: 'stop'
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  };
}

async function getRequestJson(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch(e) { resolve(body); }
    });
    req.on('error', reject);
  });
}

function findMessageIndex(messages, { id, time, index }) {
  if (typeof index === 'number' && index >= 0 && index < messages.length) return index;
  if (id) {
    const i = messages.findIndex(m => m.id === id);
    if (i !== -1) return i;
  }
  if (time) {
    const i = messages.findIndex(m => m.time === time || m.timestamp === time || String(m.time) === String(time));
    if (i !== -1) return i;
  }
  return -1;
}

// Отправить один user-сообщение в Character.AI и получить assistant ответ,
// также вернуть historyId (если есть) для последующих запросов.
async function sendOne(client, characterId, userText, historyId) {
  const resp = await client.sendMessage(characterId, userText, historyId);
  // resp.historyId — ожидаем, что cainode возвращает идентификатор истории
  return {
    assistantText: resp.text || '',
    historyId: resp.historyId || resp.turn?.turn_key?.turn_id || null
  };
}

// Частичный rebuild: из исходной истории (originalMessages) начиная с позиции startUserIndex
// отправляем в Character.AI последовательно все user сообщения, получая ассистентские ответы.
// startHistoryId — historyId предыдущей ассистентской записи (или null).
async function partialRebuild(client, characterId, baseConversation, originalMessages, startUserIndex, startHistoryId) {
  // baseConversation — объект, который мы будем дополнять (с сохранёнными сообщениями до startUserIndex)
  let historyId = startHistoryId;
  // пройдём по originalMessages от startUserIndex до конца, но берем только user сообщения:
  for (let i = startUserIndex; i < originalMessages.length; i++) {
    const m = originalMessages[i];
    if (m.role !== 'user') continue;

    // отправляем user
    const userEntry = {
      id: m.id || genId(),
      role: 'user',
      content: m.content,
      time: m.time || m.timestamp || Date.now()
    };
    baseConversation.messages.push(userEntry);

    const resp = await sendOne(client, characterId, userEntry.content, historyId);

    // добавляем assistant сообщение, сохраняем historyId в нём
    const assistantEntry = {
      id: genId(),
      role: 'assistant',
      content: resp.assistantText,
      time: Date.now(),
      historyId: resp.historyId
    };
    baseConversation.messages.push(assistantEntry);

    // обновляем historyId для следующего шага
    if (resp.historyId) historyId = resp.historyId;
  }

  baseConversation.historyId = historyId || baseConversation.historyId || null;
  baseConversation.updatedAt = new Date().toISOString();
  storage.saveConversation(baseConversation.conversationId, baseConversation);
  return baseConversation;
}

async function handleChatCompletion(req, res) {
  try {
    const body = await getRequestJson(req);
    const {
      model: characterId,
      messages,
      stream = false,
      operation = 'send', // send | edit | delete | regen
      target = null,      // для edit/delete/regеn: { id, time, index }
      newContent = null   // для edit
    } = body;

    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: { message: 'Missing or invalid authorization header', type: 'invalid_request_error', code: 'invalid_api_key' } });
    }
    const token = authHeader.replace('Bearer ', '');
    if (!characterId) return res.status(400).json({ error: { message: 'Missing model parameter', type: 'invalid_request_error', code: 'invalid_model' } });

    const client = new CharacterAI(token);
    const conversationId = generateConversationId(characterId);
    let conversation = storage.loadConversation(conversationId);
    let characterName = characterId;

    if (!conversation) {
      // создаём пустой
      try {
        const info = await client.getCharacterInfo(characterId).catch(()=>({name:characterId}));
        characterName = info.name || characterId;
      } catch(e){}
      conversation = {
        conversationId,
        characterId,
        characterName,
        historyId: null,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else {
      characterName = conversation.characterName || characterId;
    }

    // гарантируем id у уже существующих сообщений
    ensureMessageIds(conversation);

    // Common validation for send operation: messages array with last user
    if (operation === 'send') {
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: { message: 'Messages array is required', type: 'invalid_request_error', code: 'invalid_messages' } });
      }
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'user') {
        return res.status(400).json({ error: { message: 'Last message must be user', type: 'invalid_request_error', code: 'invalid_last_message' } });
      }

      // пушим в Character.AI, используя текущ conversation.historyId как база (если есть)
      const userText = last.content;
      // добавляем user локально
      const userEntry = { id: last.id || genId(), role: 'user', content: userText, time: last.time || Date.now() };
      conversation.messages.push(userEntry);

      const resp = await client.sendMessage(characterId, userText, conversation.historyId);

      const assistantEntry = {
        id: genId(),
        role: 'assistant',
        content: resp.text || '',
        time: Date.now(),
        historyId: resp.historyId || resp.turn?.turn_key?.turn_id || null
      };

      // сохраняем historyId если нет
      if (assistantEntry.historyId && !conversation.historyId) conversation.historyId = assistantEntry.historyId;

      conversation.messages.push(assistantEntry);
      conversation.updatedAt = new Date().toISOString();
      storage.saveConversation(conversation.conversationId, conversation);

      if (stream) {
        res.setHeader('Content-Type','text/event-stream');
        res.setHeader('Cache-Control','no-cache');
        res.setHeader('Connection','keep-alive');
        res.write(`data: ${JSON.stringify({ id:`chatcmpl-${Date.now()}`, object:'chat.completion.chunk', created:Math.floor(Date.now()/1000), model: characterName, choices:[{index:0, delta:{role:'assistant', content: assistantEntry.content}, finish_reason:null}] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id:`chatcmpl-${Date.now()}`, object:'chat.completion.chunk', created:Math.floor(Date.now()/1000), model: characterName, choices:[{index:0, delta:{}, finish_reason:'stop'}] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        return res.status(200).json(convertToOpenAIFormat(assistantEntry.content, conversation.characterName));
      }
    } else if (operation === 'regen') {
      // regen last user (or target)
      // определим индекс user
      let targetIdx = -1;
      if (target) targetIdx = findMessageIndex(conversation.messages, target);
      else {
        for (let i = conversation.messages.length -1; i>=0; i--) {
          if (conversation.messages[i].role === 'user') { targetIdx = i; break; }
        }
      }
      if (targetIdx === -1) return res.status(400).json({ error: 'No user message to regen' });

      // найдем пред. ассистента перед этим user (для historyId)
      let prevAssistantIdx = -1;
      for (let i = targetIdx -1; i >=0; i--) {
        if (conversation.messages[i].role === 'assistant') { prevAssistantIdx = i; break; }
      }
      const baseHistoryId = prevAssistantIdx !== -1 ? conversation.messages[prevAssistantIdx].historyId || conversation.historyId : conversation.historyId;

      // обрежем локальную историю до targetIdx (включая user)
      const original = conversation.messages.slice(); // copy
      conversation.messages = conversation.messages.slice(0, targetIdx + 1);

      // теперь отправим только тот user (targetIdx) и получим новый assistant ответ
      const user = conversation.messages[conversation.messages.length -1];
      const res1 = await sendOne(client, characterId, user.content, baseHistoryId);

      const assistantEntry = {
        id: genId(),
        role: 'assistant',
        content: res1.assistantText,
        time: Date.now(),
        historyId: res1.historyId
      };
      if (assistantEntry.historyId) conversation.historyId = assistantEntry.historyId;
      conversation.messages.push(assistantEntry);

      conversation.updatedAt = new Date().toISOString();
      storage.saveConversation(conversation.conversationId, conversation);

      return res.status(200).json({ status:'ok', conversation });
    } else if (operation === 'edit' || operation === 'delete') {
      // edit: target + newContent required. delete: target required.
      if (!target) return res.status(400).json({ error: 'target required' });
      const idx = findMessageIndex(conversation.messages, target);
      if (idx === -1) return res.status(400).json({ error: 'target not found' });
      if (conversation.messages[idx].role !== 'user') return res.status(400).json({ error: 'target must be a user message' });

      const originalMessages = conversation.messages.slice(); // keep original to know subsequent user messages

      // find previous assistant before idx to get baseHistoryId
      let prevAssistantIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (originalMessages[i].role === 'assistant') { prevAssistantIdx = i; break; }
      }
      const baseHistoryId = prevAssistantIdx !== -1 ? originalMessages[prevAssistantIdx].historyId || conversation.historyId : conversation.historyId;

      // Build new baseConversation with messages up to idx (depending on delete/edit)
      let baseConversation = {
        ...conversation,
        messages: originalMessages.slice(0, idx + (operation === 'edit' ? 1 : 0)) // keep user if edit, remove it if delete
      };

      if (operation === 'edit') {
        // update that user content
        baseConversation.messages[baseConversation.messages.length -1].content = newContent;
        baseConversation.messages[baseConversation.messages.length -1].time = Date.now();
      } else if (operation === 'delete') {
        // remove the user message already handled by slice above
      }

      // now, we need to append subsequent user messages from originalMessages after idx
      // compute start index for subsequent messages:
      const startIndex = idx + 1; // messages after target
      // perform partial rebuild: send only user messages from originalMessages[startIndex .. end]
      const rebuilt = await partialRebuild(client, characterId, baseConversation, originalMessages, startIndex, baseHistoryId);

      return res.status(200).json({ status:'ok', conversation: rebuilt });
    } else {
      return res.status(400).json({ error: 'unknown operation' });
    }
  } catch (error) {
    console.error('Chat completion error:', error);
    return res.status(500).json({ error: { message: error.message || 'Internal server error', type:'internal_error', code:'server_error' } });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed. Use POST.', type:'invalid_request_error', code:'method_not_allowed' } });

  return handleChatCompletion(req, res);
}

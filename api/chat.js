import { CharacterAI } from '../lib/characterai.js';
import { ConversationStorage } from '../lib/storage.js';

const storage = new ConversationStorage();

function generateConversationId(characterId, userId = 'default') {
  return `${userId}_${characterId}`;
}

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
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

function ensureMessageIds(conversation) {
  conversation.messages = conversation.messages.map(m => {
    if (!m.id) m.id = genId();
    return m;
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

// Отправка одного user-сообщения, возвращает { assistantText, historyId, turn }
async function sendOne(client, characterId, userText, historyId = null) {
  const resp = await client.sendMessage(characterId, userText, historyId);
  const turn = resp.turn || resp;
  const text =
    (turn?.candidates && (turn.candidates[0]?.raw_content || turn.candidates[0]?.content)) ||
    resp?.text ||
    '';
  const history = turn?.turn_key?.turn_id || resp?.historyId || null;
  return { assistantText: text, historyId: history, turn: turn || resp };
}

// попытка удалить ассистентские turn'ы серверно, игнорируем ошибки (логируем)
async function tryDeleteAssistantTurns(client, conversation, startIdx) {
  for (let i = startIdx; i < conversation.messages.length; i++) {
    const m = conversation.messages[i];
    if (m.role === 'assistant' && m.turnId) {
      try {
        await client.deleteMessage(m.turnId);
      } catch (err) {
        // не фатально — просто логируем
        console.warn('deleteMessage failed for', m.turnId, err?.message || err);
      }
    }
  }
}

// partial rebuild: отправляем в Character.AI все user-сообщения из originalMessages, начиная с startUserIndex,
// используя базовый historyId (history from previous assistant).
async function partialRebuild(client, characterId, baseConversation, originalMessages, startUserIndex, baseHistoryId) {
  let historyId = baseHistoryId || baseConversation.historyId || null;

  // ensure baseConversation.messages already contains messages up to startUserIndex-1
  for (let i = startUserIndex; i < originalMessages.length; i++) {
    const m = originalMessages[i];
    if (m.role !== 'user') continue;

    // add user locally
    const userEntry = {
      id: m.id || genId(),
      role: 'user',
      content: m.content,
      time: m.time || m.timestamp || Date.now()
    };
    baseConversation.messages.push(userEntry);

    const resp = await sendOne(client, characterId, userEntry.content, historyId);

    // store assistant entry with turnId/candidate if available
    const assistantEntry = {
      id: genId(),
      role: 'assistant',
      content: resp.assistantText || '',
      time: Date.now(),
      turnId: resp.turn?.turn_key?.turn_id || resp.historyId || null,
      // candidate id fallback (some cainode versions)
      candidateId: resp.turn?.candidates?.[0]?.candidate_id || resp.turn?.candidates?.[0]?.id || null
    };

    if (assistantEntry.turnId) historyId = assistantEntry.turnId;
    baseConversation.messages.push(assistantEntry);
  }

  baseConversation.historyId = baseConversation.historyId || historyId;
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
      target = null,      // { id, time, index }
      newContent = null   // for edit
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
      const info = await client.getCharacterInfo(characterId).catch(()=>({name:characterId}));
      characterName = info.name || characterId;
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

    // гарантируем id у сообщений
    ensureMessageIds(conversation);

    // ---- SEND (обычная отправка) ----
    if (operation === 'send') {
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: { message: 'Messages array is required', type: 'invalid_request_error', code: 'invalid_messages' } });
      }
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'user') {
        return res.status(400).json({ error: { message: 'Last message must be user', type: 'invalid_request_error', code: 'invalid_last_message' } });
      }

      const userText = last.content;
      const userEntry = { id: last.id || genId(), role: 'user', content: userText, time: last.time || Date.now() };
      conversation.messages.push(userEntry);

      // отправляем, используя conversation.historyId если есть
      const resp = await client.sendMessage(characterId, userText, conversation.historyId);

      const assistantEntry = {
        id: genId(),
        role: 'assistant',
        content: resp.text || (resp.turn && (resp.turn.candidates?.[0]?.raw_content || resp.turn.candidates?.[0]?.content)) || '',
        time: Date.now(),
        turnId: resp.turn?.turn_key?.turn_id || resp.historyId || null,
        candidateId: resp.turn?.candidates?.[0]?.candidate_id || resp.turn?.candidates?.[0]?.id || null
      };

      if (assistantEntry.turnId && !conversation.historyId) conversation.historyId = assistantEntry.turnId;
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
    }

    // ---- REGEN ----
    if (operation === 'regen') {
      // определяем target user (если есть) или последний user
      let targetIdx = -1;
      if (target) targetIdx = findMessageIndex(conversation.messages, target);
      else {
        for (let i = conversation.messages.length -1; i>=0; i--) if (conversation.messages[i].role === 'user') { targetIdx = i; break; }
      }
      if (targetIdx === -1) return res.status(400).json({ error: 'No user message to regen' });

      // ассистент после target
      const assistantIdx = (targetIdx + 1 < conversation.messages.length && conversation.messages[targetIdx+1].role === 'assistant') ? targetIdx+1 : -1;

      // если есть turnId у assistant, попробуем regenerateTurn(turnId)
      if (assistantIdx !== -1 && conversation.messages[assistantIdx].turnId) {
        try {
          const turnId = conversation.messages[assistantIdx].turnId;
          const regenResp = await client.regenerateTurn(turnId);
          // извлечём текст из regenResp (fallbacks)
          const newText = regenResp?.turn?.candidates?.[0]?.raw_content || regenResp?.text || regenResp?.candidates?.[0]?.raw_content || null;
          if (newText) {
            conversation.messages[assistantIdx].content = newText;
            conversation.messages[assistantIdx].time = Date.now();
            storage.saveConversation(conversation.conversationId, conversation);
            return res.status(200).json({ status: 'ok', conversation });
          }
        } catch (err) {
          console.warn('regenerateTurn failed, fallback to sendOne', err?.message || err);
        }
      }

      // fallback: удаляем старого ассистента локально и просто отправляем user снова (используя historyId from previous assistant if exists)
      // ищем предыдущ assistant before targetIdx
      let prevAssistantIdx = -1;
      for (let i = targetIdx-1; i>=0; i--) if (conversation.messages[i].role === 'assistant') { prevAssistantIdx = i; break; }
      const baseHistoryId = prevAssistantIdx !== -1 ? (conversation.messages[prevAssistantIdx].turnId || conversation.historyId) : conversation.historyId;

      // обрезаем до targetIdx (включая user)
      conversation.messages = conversation.messages.slice(0, targetIdx+1);

      const user = conversation.messages[conversation.messages.length -1];
      const resp1 = await sendOne(client, characterId, user.content, baseHistoryId);

      const assistantEntry = {
        id: genId(),
        role: 'assistant',
        content: resp1.assistantText || '',
        time: Date.now(),
        turnId: resp1.turn?.turn_key?.turn_id || resp1.historyId || null,
        candidateId: resp1.turn?.candidates?.[0]?.candidate_id || resp1.turn?.candidates?.[0]?.id || null
      };
      if (assistantEntry.turnId && !conversation.historyId) conversation.historyId = assistantEntry.turnId;
      conversation.messages.push(assistantEntry);
      conversation.updatedAt = new Date().toISOString();
      storage.saveConversation(conversation.conversationId, conversation);
      return res.status(200).json({ status: 'ok', conversation });
    }

    // ---- EDIT / DELETE ----
    if (operation === 'edit' || operation === 'delete') {
      if (!target) return res.status(400).json({ error: 'target required' });
      const idx = findMessageIndex(conversation.messages, target);
      if (idx === -1) return res.status(400).json({ error: 'target not found' });
      if (conversation.messages[idx].role !== 'user') return res.status(400).json({ error: 'target must be a user message' });

      const original = conversation.messages.slice();

      // найдем предыдущего assistant для получения базового historyId
      let prevAssistantIdx = -1;
      for (let i = idx - 1; i >= 0; i--) {
        if (original[i].role === 'assistant') { prevAssistantIdx = i; break; }
      }
      const baseHistoryId = prevAssistantIdx !== -1 ? (original[prevAssistantIdx].turnId || conversation.historyId) : conversation.historyId;

      // перед модификацией попробуем удалить серверные assistant-turn'ы, которые идут после idx
      // ищем первый assistant after idx
      let firstAssistantAfter = -1;
      for (let i = idx + 1; i < original.length; i++) {
        if (original[i].role === 'assistant') { firstAssistantAfter = i; break; }
      }
      if (firstAssistantAfter !== -1) {
        // delete assistant turns from firstAssistantAfter to end
        await tryDeleteAssistantTurns(client, { messages: original }, firstAssistantAfter);
      }

      // build baseConversation: messages up to idx (include user if edit, exclude if delete)
      let baseConversation = {
        ...conversation,
        messages: original.slice(0, idx + (operation === 'edit' ? 1 : 0))
      };

      if (operation === 'edit') {
        if (!newContent) return res.status(400).json({ error: 'newContent required for edit' });
        baseConversation.messages[baseConversation.messages.length -1].content = newContent;
        baseConversation.messages[baseConversation.messages.length -1].time = Date.now();
      } else {
        // delete: user removed (already sliced)
      }

      // start index for subsequent user messages in original
      const startIndex = idx + 1;

      // now partialRebuild from startIndex using baseHistoryId
      const rebuilt = await partialRebuild(client, characterId, baseConversation, original, startIndex, baseHistoryId);

      return res.status(200).json({ status: 'ok', conversation: rebuilt });
    }

    return res.status(400).json({ error: 'unknown operation' });
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

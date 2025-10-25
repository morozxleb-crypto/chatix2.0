// scripts/import_risu_and_sync.js
// Usage: node import_risu_and_sync.js path/to/risu.json CHARACTER_ID CHARACTER_AI_TOKEN
//
// What it does:
//  - reads Risu export JSON
//  - merges messages into local conversation (conversations/<conversationId>.json)
//  - assigns ids to messages
//  - finds last assistant message with turnId; sends only user messages after that to Character.AI
//  - saves conversation (adds assistant entries with turnId/candidateId if returned)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CharacterAI } from '../lib/characterai.js';
import { ConversationStorage } from '../lib/storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function genId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('Failed to read JSON', file, e.message);
    process.exit(1);
  }
}

function saveJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function toLocalMessage(risuMsg) {
  // risu role: 'user' or 'char'
  if (risuMsg.role === 'user') {
    return {
      id: risuMsg.id || genId(),
      role: 'user',
      content: risuMsg.data || risuMsg.content || '',
      time: risuMsg.time || risuMsg.timestamp || Date.now()
    };
  } else {
    return {
      id: risuMsg.id || genId(),
      role: 'assistant',
      content: risuMsg.data || risuMsg.content || '',
      time: risuMsg.time || risuMsg.timestamp || Date.now()
      // turnId/candidateId may be absent for Risu exports
    };
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.log('Usage: node import_risu_and_sync.js path/to/risu.json CHARACTER_ID CHARACTER_AI_TOKEN');
    process.exit(1);
  }
  const [risuPath, characterId, charAiToken] = args;

  const risu = loadJson(risuPath);
  if (!risu || !risu.data || !Array.isArray(risu.data) || risu.data.length === 0) {
    console.error('Invalid Risu JSON format or empty.');
    process.exit(1);
  }

  // Собираем все сообщения из первого чата (в примере у тебя один чат)
  const chat = risu.data[0];
  if (!chat || !Array.isArray(chat.message)) {
    console.error('No messages found in Risu JSON');
    process.exit(1);
  }

  const risuMsgs = chat.message;

  // local conversation id formula: default_<characterId>
  const conversationId = `default_${characterId}`;
  const storage = new ConversationStorage();
  let local = storage.loadConversation(conversationId);
  if (!local) {
    local = {
      conversationId,
      characterId,
      characterName: characterId,
      historyId: null,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    storage.saveConversation(conversationId, local);
    console.log('Created new local conversation:', conversationId);
  } else {
    console.log('Loaded existing local conversation:', conversationId);
  }

  // Convert risu -> local messages
  const converted = risuMsgs.map(toLocalMessage);

  // Merge: append only those risu messages that are not already present.
  // We'll de-duplicate by exact match of (role + time + content)
  const existsKey = (m) => `${m.role}||${m.time}||${(m.content||'').slice(0,200)}`;
  const existingSet = new Set(local.messages.map(existsKey));
  const newMessages = [];
  for (const m of converted) {
    if (!existingSet.has(existsKey(m))) {
      // ensure id
      if (!m.id) m.id = genId();
      newMessages.push(m);
    }
  }

  if (newMessages.length === 0) {
    console.log('No new messages to merge from Risu.');
  } else {
    console.log('Merging', newMessages.length, 'new messages into local conversation.');
    // Simple policy: append newMessages at the end of local.messages
    local.messages = local.messages.concat(newMessages);
    local.updatedAt = new Date().toISOString();
    storage.saveConversation(conversationId, local);
    console.log('Merged and saved local conversation; total messages:', local.messages.length);
  }

  // Теперь синхронизация с Character.AI: отправляем только user-сообщения,
  // которые идут после последнего assistant с turnId (если есть).
  // Если нет turnId вовсе — отправляем только NEW user messages (те что мы только добавили).
  // Подготовим CAI client
  if (!charAiToken) {
    console.log('No Character.AI token provided — skipping sync to Character.AI.');
    process.exit(0);
  }
  const client = new CharacterAI(charAiToken);
  await client.initialize();

  // Найти индекс последнего assistant с turnId
  let lastAssistantWithTurnIdx = -1;
  for (let i = local.messages.length - 1; i >= 0; i--) {
    const m = local.messages[i];
    if (m.role === 'assistant' && (m.turnId || m.historyId)) {
      lastAssistantWithTurnIdx = i;
      break;
    }
  }

  // Сформируем список user сообщений, которые нужно отправить
  let userToSend = [];

  if (lastAssistantWithTurnIdx >= 0) {
    // права: берем все user-сообщения после that assistant
    for (let i = lastAssistantWithTurnIdx + 1; i < local.messages.length; i++) {
      const m = local.messages[i];
      if (m.role === 'user') userToSend.push(m);
    }
    console.log('Found last assistant with turn at idx', lastAssistantWithTurnIdx, '; will send', userToSend.length, 'user messages after it.');
  } else {
    // если lastAssistantWithTurnIdx == -1, отправляем user сообщения, которые не имеют связанного assistant с turnId
    // проще: отправим все user messages that do not have a following assistant with turnId
    for (let i = 0; i < local.messages.length; i++) {
      const m = local.messages[i];
      if (m.role !== 'user') continue;
      const next = local.messages[i+1];
      if (!next || !next.turnId) {
        // either no assistant after, or assistant exists but without turnId -> we need to send
        // But to avoid re-sending messages that already have assistant, check if next exists and has content equal
        userToSend.push(m);
      }
    }
    console.log('No assistant with turnId found; will attempt to send', userToSend.length, 'user messages (new or missing assistant).');
  }

  if (userToSend.length === 0) {
    console.log('Nothing to sync to Character.AI.');
    process.exit(0);
  }

  // Determine base historyId: use conversation.historyId or lastAssistant.turnId if found
  const baseHistoryId = lastAssistantWithTurnIdx >= 0 ? (local.messages[lastAssistantWithTurnIdx].turnId || local.historyId) : local.historyId;

  // Send sequentially userToSend and append assistant entries into local.messages properly (and save)
  let historyId = baseHistoryId || null;
  const startPos = local.messages.length; // we'll append new assistant messages at end (but better to find exact positions)
  for (const userMsg of userToSend) {
    console.log('Sending user:', userMsg.content.slice(0,80));
    const resp = await client.sendMessage(characterId, userMsg.content, historyId);
    const turn = resp.turn || resp;
    const assistantText = resp.text || (turn?.candidates?.[0]?.raw_content) || (turn?.candidates?.[0]?.content) || '';
    const turnId = turn?.turn_key?.turn_id || resp.historyId || null;
    const candidateId = turn?.candidates?.[0]?.candidate_id || turn?.candidates?.[0]?.id || null;

    // find where to put assistant: the local.messages might already have placeholders; try to find the userMsg index
    const uidx = local.messages.findIndex(m => m.role === 'user' && (m.time === userMsg.time && m.content === userMsg.content));
    const insertIdx = (uidx !== -1) ? uidx + 1 : local.messages.length;

    const assistantEntry = {
      id: genId(),
      role: 'assistant',
      content: assistantText,
      time: Date.now(),
      turnId,
      candidateId
    };

    // if next slot exists and it's assistant without turnId, replace it; else insert
    if (local.messages[insertIdx] && local.messages[insertIdx].role === 'assistant' && !local.messages[insertIdx].turnId) {
      local.messages[insertIdx] = assistantEntry;
    } else {
      local.messages.splice(insertIdx, 0, assistantEntry);
    }

    if (turnId) historyId = turnId;
    if (!local.historyId && turnId) local.historyId = turnId;
    local.updatedAt = new Date().toISOString();
    storage.saveConversation(conversationId, local);
    console.log('Saved assistant with turnId:', turnId, 'candidateId:', candidateId);
  }

  console.log('Sync complete. Conversation saved to storage.');
  console.log('Total messages now:', local.messages.length);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

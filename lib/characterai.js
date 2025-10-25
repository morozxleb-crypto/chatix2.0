// lib/characterai.js
import { CAINode } from 'cainode';

export class CharacterAI {
  constructor(token) {
    if (!token) {
      throw new Error('CharacterAI token required');
    }
    this.token = token;
    this.client = null;
    this.connectedCharacter = null; // последний characterId, если использовали connect
  }

  async initialize() {
    if (this.client) return this.client;
    try {
      this.client = new CAINode();
      await this.client.login(this.token);
      return this.client;
    } catch (err) {
      this.client = null;
      throw new Error(`CharacterAI initialization error: ${err?.message || err}`);
    }
  }

  async ensureInitialized() {
    if (!this.client) await this.initialize();
    return this.client;
  }

  // connect к конкретному character (не обязательно, можно использовать manual options при отправке)
  async connectToCharacter(characterId) {
    await this.ensureInitialized();
    if (this.connectedCharacter === characterId) return;
    await this.client.character.connect(characterId);
    this.connectedCharacter = characterId;
  }

  // sendMessage: возвращаем удобный объект { text, historyId, turn }
  // Если передан historyId — он может быть проигнорирован CAINode; но мы используем manual_opt для char_id чтобы не зависеть от предыдущего connect
  async sendMessage(characterId, message, historyId = null, options = {}) {
    await this.ensureInitialized();

    try {
      // Пробуем отправку "мануально" к char_id — это работает без предварительного client.character.connect
      // CAINode signature: character.send_message(message, manual_turn=false, image_url='', manual_opt={char_id, chat_id})
      const manualOpt = { char_id: characterId };
      // Если опционально передали chat_id в options — подставим
      if (options.chat_id) manualOpt.chat_id = options.chat_id;

      const resp = await this.client.character.send_message(
        message,
        false, // manual_turn
        '', // image_url
        manualOpt
      );

      // Структура resp может отличаться — ищем common поля
      const turn = resp?.turn || resp;
      const historyId =
        turn?.turn_key?.turn_id ||
        turn?.turn_id ||
        resp?.historyId ||
        null;

      const text =
        // candidates -> raw_content
        (turn?.candidates && turn.candidates[0] && (turn.candidates[0].raw_content || turn.candidates[0].content)) ||
        resp?.text ||
        '';

      return {
        text,
        historyId,
        turn: turn || resp
      };
    } catch (err) {
      throw new Error(`CharacterAI sendMessage error: ${err?.message || err}`);
    }
  }

  // regenerate a candidate/turn
  // CAINode: character.generate_turn_candidate(turn_id)
  async regenerateTurn(turnId, options = {}) {
    await this.ensureInitialized();
    try {
      const resp = await this.client.character.generate_turn_candidate(turnId, options.manual_opt);
      return resp;
    } catch (err) {
      throw new Error(`CharacterAI regenerateTurn error: ${err?.message || err}`);
    }
  }

  // delete a message/turn (character-side)
  // CAINode: character.delete_message(turn_id)
  async deleteMessage(turnId, manualOpt = null) {
    await this.ensureInitialized();
    try {
      if (manualOpt) return await this.client.character.delete_message(turnId, manualOpt);
      return await this.client.character.delete_message(turnId);
    } catch (err) {
      throw new Error(`CharacterAI deleteMessage error: ${err?.message || err}`);
    }
  }

  // edit a character message (requires candidate_id and turn_id)
  // CAINode: character.edit_message(candidate_id, turn_id, new_message)
  async editCharacterMessage(candidateId, turnId, newMessage, manualOpt = null) {
    await this.ensureInitialized();
    try {
      if (manualOpt) return await this.client.character.edit_message(candidateId, turnId, newMessage, manualOpt);
      return await this.client.character.edit_message(candidateId, turnId, newMessage);
    } catch (err) {
      throw new Error(`CharacterAI editCharacterMessage error: ${err?.message || err}`);
    }
  }

  // get character info
  async getCharacterInfo(characterId) {
    await this.ensureInitialized();
    try {
      const info = await this.client.character.info(characterId);
      return {
        name: info?.name || characterId,
        title: info?.title || '',
        description: info?.description || '',
        raw: info
      };
    } catch (err) {
      // не фатал — вернём дефолтную структуру
      return { name: characterId, title: '', description: '', raw: null };
    }
  }

  async healthCheck() {
    try {
      await this.initialize();
      return true;
    } catch (err) {
      return false;
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.logout();
        this.client = null;
        this.connectedCharacter = null;
      }
    } catch (err) {
      // ignore
    }
  }
}

export { CharacterAI };

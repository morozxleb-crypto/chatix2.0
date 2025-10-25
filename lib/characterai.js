import { CAINode } from 'cainode';

export class CharacterAIClient {
  constructor(token) {
    this.token = token;
    this.client = null;
    this.connectedCharacter = null;
  }

  async initialize() {
    if (this.client) {
      return this.client;
    }

    try {
      this.client = new CAINode();
      await this.client.login(this.token);
      return this.client;
    } catch (error) {
      throw new Error(`CharacterAI initialization error: ${error.message}`);
    }
  }

  async ensureConnected(characterId) {
    try {
      await this.initialize();

      if (this.connectedCharacter !== characterId) {
        await this.client.character.connect(characterId);
        this.connectedCharacter = characterId;
      }
    } catch (error) {
      throw new Error(`CharacterAI connection error: ${error.message}`);
    }
  }

  async sendMessage(characterId, message, historyId = null) {
    try {
      await this.ensureConnected(characterId);

      const response = await this.client.character.send_message(message);

      const text = response.turn?.candidates?.[0]?.raw_content || '';
      const turnId = response.turn?.turn_key?.turn_id || null;

      return {
        text: text,
        historyId: turnId,
        turn: response
      };
    } catch (error) {
      throw new Error(`CharacterAI sendMessage error: ${error.message}`);
    }
  }

  async getCharacterInfo(characterId) {
    try {
      await this.initialize();
      
      const info = await this.client.character.info(characterId);
      return {
        name: info.name || characterId,
        title: info.title || '',
        description: info.description || ''
      };
    } catch (error) {
      console.log('Could not fetch character info:', error.message);
      return {
        name: characterId,
        title: '',
        description: ''
      };
    }
  }

  async healthCheck() {
    try {
      await this.initialize();
      return true;
    } catch (error) {
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
    } catch (error) {
      console.error('Disconnect error:', error);
    }
  }
}

export { CharacterAIClient as CharacterAI };

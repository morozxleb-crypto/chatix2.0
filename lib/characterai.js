import fetch from 'node-fetch';

const CAI_API_URL = 'https://plus.character.ai';

export class CharacterAI {
  constructor(token) {
    this.token = token;
    this.headers = {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
  }

  async createChat(characterId) {
    try {
      const response = await fetch(`${CAI_API_URL}/chat/history/create/`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          character_external_id: characterId,
          history_external_id: null
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to create chat: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.external_id;
    } catch (error) {
      throw new Error(`CharacterAI createChat error: ${error.message}`);
    }
  }

  async continueChat(characterId, historyId) {
    try {
      const response = await fetch(`${CAI_API_URL}/chat/history/continue/`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          character_external_id: characterId,
          history_external_id: historyId
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to continue chat: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      throw new Error(`CharacterAI continueChat error: ${error.message}`);
    }
  }

  async getHistory(characterId, historyId) {
    try {
      const response = await fetch(
        `${CAI_API_URL}/chat/history/msgs/user/?history_external_id=${historyId}`,
        {
          method: 'GET',
          headers: this.headers
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get history: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.messages || [];
    } catch (error) {
      throw new Error(`CharacterAI getHistory error: ${error.message}`);
    }
  }

  async sendMessage(characterId, historyId, message, tgt = null) {
    try {
      const body = {
        character_external_id: characterId,
        history_external_id: historyId,
        text: message,
        tgt: tgt,
        ranking_method: 'random',
        staging: false,
        model_server_address: null,
        override_prefix: null,
        override_rank: null,
        rank_candidates: null,
        filter_candidates: null,
        enable_tti: true,
        stream_params: null,
        voice_enabled: false,
        selected_language: '',
        is_proactive: false
      };

      const response = await fetch(`${CAI_API_URL}/chat/streaming/`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status} ${response.statusText}`);
      }

      let fullText = '';
      let lastTurn = null;
      const text = await response.text();
      
      const lines = text.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          
          if (json.turn) {
            lastTurn = json.turn;
          }
          
          if (json.replies && json.replies.length > 0) {
            fullText = json.replies[0].text || '';
          }
        } catch (e) {
        }
      }

      return {
        text: fullText,
        turn: lastTurn
      };
    } catch (error) {
      throw new Error(`CharacterAI sendMessage error: ${error.message}`);
    }
  }

  async getCharacterInfo(characterId) {
    try {
      const response = await fetch(`${CAI_API_URL}/chat/character/info/`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({
          external_id: characterId
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to get character info: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.character;
    } catch (error) {
      throw new Error(`CharacterAI getCharacterInfo error: ${error.message}`);
    }
  }

  async healthCheck() {
    try {
      const response = await fetch(`${CAI_API_URL}/chat/user/`, {
        method: 'GET',
        headers: this.headers
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

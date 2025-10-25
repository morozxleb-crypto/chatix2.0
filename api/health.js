import { CharacterAI } from '../lib/characterai.js';
import { ConversationStorage } from '../lib/storage.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method not allowed. Use GET.'
    });
  }

  try {
    const storage = new ConversationStorage();
    const conversations = storage.listConversations();

    const authHeader = req.headers.authorization || req.headers.Authorization;
    let characterAIStatus = 'no_token_provided';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const client = new CharacterAI(token);
      const isHealthy = await client.healthCheck();
      characterAIStatus = isHealthy ? 'connected' : 'connection_failed';
    }

    return res.status(200).json({
      status: 'ok',
      service: 'Character.AI OpenAI Proxy',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      characterai_status: characterAIStatus,
      storage: {
        type: 'local_json',
        conversations_count: conversations.length
      },
      endpoints: {
        chat: '/v1/chat/completions',
        health: '/api/health'
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

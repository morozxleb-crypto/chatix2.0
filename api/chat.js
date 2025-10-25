import { CharacterAI } from '../lib/characterai.js';
import { ConversationStorage } from '../lib/storage.js';

const storage = new ConversationStorage();

function generateConversationId(characterId, userId = 'default') {
  return `${userId}_${characterId}`;
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
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };
}

async function handleChatCompletion(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    
    const {
      model: characterId,
      messages,
      stream = false
    } = body;

    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          message: 'Missing or invalid authorization header. Use: Authorization: Bearer YOUR_CHARACTER_AI_TOKEN',
          type: 'invalid_request_error',
          code: 'invalid_api_key'
        }
      });
    }

    const token = authHeader.replace('Bearer ', '');

    if (!characterId) {
      return res.status(400).json({
        error: {
          message: 'Missing model parameter. Use character ID as model.',
          type: 'invalid_request_error',
          code: 'invalid_model'
        }
      });
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: {
          message: 'Messages array is required and must not be empty',
          type: 'invalid_request_error',
          code: 'invalid_messages'
        }
      });
    }

    const client = new CharacterAI(token);
    
    const conversationId = generateConversationId(characterId);
    let conversation = storage.loadConversation(conversationId);
    let historyId = conversation?.historyId || null;
    let characterName = conversation?.characterName || characterId;

    if (!historyId) {
      try {
        const characterInfo = await client.getCharacterInfo(characterId);
        characterName = characterInfo.name || characterId;
        
        historyId = await client.createChat(characterId);
        
        conversation = {
          conversationId,
          characterId,
          characterName,
          historyId,
          messages: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        storage.saveConversation(conversationId, conversation);
      } catch (error) {
        return res.status(500).json({
          error: {
            message: `Failed to initialize chat: ${error.message}`,
            type: 'character_ai_error',
            code: 'initialization_failed'
          }
        });
      }
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'user') {
      return res.status(400).json({
        error: {
          message: 'Last message must be from user',
          type: 'invalid_request_error',
          code: 'invalid_last_message'
        }
      });
    }

    const userMessage = lastMessage.content;

    try {
      const response = await client.sendMessage(
        characterId,
        historyId,
        userMessage
      );

      conversation.messages.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      });

      conversation.messages.push({
        role: 'assistant',
        content: response.text,
        timestamp: new Date().toISOString(),
        turn: response.turn
      });

      conversation.updatedAt = new Date().toISOString();
      storage.saveConversation(conversationId, conversation);

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const streamResponse = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: characterName,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              content: response.text
            },
            finish_reason: null
          }]
        };

        res.write(`data: ${JSON.stringify(streamResponse)}\n\n`);

        const endResponse = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: characterName,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }]
        };

        res.write(`data: ${JSON.stringify(endResponse)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        const openAIResponse = convertToOpenAIFormat(response.text, characterName);
        res.status(200).json(openAIResponse);
      }
    } catch (error) {
      return res.status(500).json({
        error: {
          message: `Character.AI API error: ${error.message}`,
          type: 'character_ai_error',
          code: 'api_error'
        }
      });
    }
  } catch (error) {
    console.error('Chat completion error:', error);
    return res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'internal_error',
        code: 'server_error'
      }
    });
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: {
        message: 'Method not allowed. Use POST.',
        type: 'invalid_request_error',
        code: 'method_not_allowed'
      }
    });
  }

  return handleChatCompletion(req, res);
}

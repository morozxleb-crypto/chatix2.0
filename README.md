# Character.AI OpenAI Proxy

OpenAI-compatible API proxy for Character.AI with conversation persistence and one-click Vercel deployment.

## Features

- **OpenAI-Compatible API**: Use Character.AI through the standard OpenAI API format
- **Conversation Persistence**: Dialogues are stored locally and continue automatically
- **Dialogue Continuation**: Automatically continues existing Character.AI conversations
- **Streaming Support**: Supports both streaming and non-streaming responses
- **One-Click Deployment**: Ready for instant Vercel deployment
- **Error Handling**: Comprehensive error handling and validation
- **Health Monitoring**: Built-in health check endpoint

## Quick Start

### Local Development

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

3. The server will run on `http://localhost:5000`

### Vercel Deployment

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/morozxleb-crypto/chatix2.0)

1. Click the "Deploy with Vercel" button above
2. Configure your project settings
3. Deploy!

Your API will be available at: `https://your-project.vercel.app/v1/chat/completions`

## API Usage

### Authentication

Use your Character.AI token as the API key:

```bash
Authorization: Bearer YOUR_CHARACTER_AI_TOKEN
```

### Endpoint

```
POST /v1/chat/completions
```

### Request Format

The API follows OpenAI's chat completion format. Use the **Character ID** as the `model` parameter:

```json
{
  "model": "CHARACTER_ID_HERE",
  "messages": [
    {
      "role": "user",
      "content": "Hello! How are you?"
    }
  ],
  "stream": false
}
```

### Example with curl

```bash
curl -X POST http://localhost:5000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_CHARACTER_AI_TOKEN" \
  -d '{
    "model": "CHARACTER_ID",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

### Example with Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR_CHARACTER_AI_TOKEN",
    base_url="http://localhost:5000/v1"
)

response = client.chat.completions.create(
    model="CHARACTER_ID",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

### Example with JavaScript

```javascript
const response = await fetch('http://localhost:5000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_CHARACTER_AI_TOKEN'
  },
  body: JSON.stringify({
    model: 'CHARACTER_ID',
    messages: [
      { role: 'user', content: 'Hello!' }
    ]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

## Conversation Persistence

Conversations are automatically saved to JSON files for persistence:

- **Local Development**: Stored in `conversations/` directory in your project
- **Vercel Deployment**: Stored in `/tmp` directory (ephemeral, resets between deployments)

Each conversation is identified by a combination of user ID and character ID. When you send a new message to the same character, the conversation will continue from where it left off.

**Note**: On Vercel, conversations persist only within the same serverless function instance. For permanent persistence on Vercel, consider integrating a database solution like Vercel KV, Supabase, or MongoDB.

## Health Check

Check the API status:

```bash
curl http://localhost:5000/health \
  -H "Authorization: Bearer YOUR_CHARACTER_AI_TOKEN"
```

Response:
```json
{
  "status": "ok",
  "service": "Character.AI OpenAI Proxy",
  "version": "1.0.0",
  "characterai_status": "connected",
  "storage": {
    "type": "local_json",
    "conversations_count": 5
  }
}
```

## How to Get Your Credentials

### Character.AI Token

1. Go to [Character.AI](https://character.ai)
2. Log in to your account
3. Open browser DevTools (F12)
4. Go to Application/Storage → Cookies
5. Find the cookie named `char_token`
6. Copy its value

### Character ID

1. Go to the character's page on Character.AI
2. The character ID is in the URL:
   ```
   https://character.ai/chat/CHARACTER_ID_HERE
   ```
3. Or open DevTools → Network tab, start a chat, and look for the `character_external_id` in API requests

## Testing

Run the test suite:

```bash
npm test
```

This will test:
- Health check endpoint
- Chat completion
- Conversation continuity

## Environment Variables

For production deployment, you can set these optional environment variables:

- `PORT`: Server port (default: 5000)
- `VERCEL`: Automatically set by Vercel (used to detect deployment environment)
- `VERCEL_ENV`: Automatically set by Vercel to `production`, `preview`, or `development`

## Storage Behavior

The proxy automatically detects its environment and adjusts storage accordingly:

| Environment | Storage Location | Persistence |
|-------------|-----------------|-------------|
| Local Dev | `./conversations/` | Permanent |
| Vercel | `/tmp/conversations/` | Ephemeral (per instance) |

**Vercel Note**: Conversations stored in `/tmp` are ephemeral and will reset when:
- Your deployment updates
- The serverless function scales down and back up
- Vercel rotates instances

For production use on Vercel, we recommend adding a persistent storage layer (KV, database, etc.).

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat completion |
| `/health` | GET | Health check and status |
| `/` | GET | API information |

## Error Handling

The API provides detailed error messages in OpenAI format:

```json
{
  "error": {
    "message": "Detailed error description",
    "type": "error_type",
    "code": "error_code"
  }
}
```

Common error codes:
- `invalid_api_key`: Invalid or missing Character.AI token
- `invalid_model`: Missing or invalid character ID
- `invalid_messages`: Malformed messages array
- `character_ai_error`: Error from Character.AI API
- `internal_error`: Server error

## Project Structure

```
├── api/
│   ├── chat.js          # Main chat completion endpoint
│   └── health.js        # Health check endpoint
├── lib/
│   ├── characterai.js   # Character.AI client
│   └── storage.js       # Conversation storage manager
├── conversations/       # Stored conversations (created automatically)
├── server.js           # Local development server
├── test.js             # Test suite
├── vercel.json         # Vercel configuration
└── package.json        # Dependencies
```

## License

MIT

## Support

For issues or questions, please open an issue on the repository.

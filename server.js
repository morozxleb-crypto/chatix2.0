import http from 'http';
import { URL } from 'url';
import chatHandler from './api/chat.js';
import healthHandler from './api/health.js';

const PORT = process.env.PORT || 5000;

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve(body);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsedUrl.pathname;

  req.body = await parseBody(req);

  if (pathname === '/v1/chat/completions') {
    return chatHandler(req, res);
  } else if (pathname === '/api/health' || pathname === '/health') {
    return healthHandler(req, res);
  } else if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      service: 'Character.AI OpenAI Proxy',
      version: '1.0.0',
      status: 'running',
      endpoints: {
        chat: '/v1/chat/completions (POST)',
        health: '/health (GET)'
      },
      documentation: 'See README.md for usage instructions'
    }, null, 2));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Not found',
      available_endpoints: ['/v1/chat/completions', '/health']
    }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✓ Character.AI OpenAI Proxy Server running on http://0.0.0.0:${PORT}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  POST http://0.0.0.0:${PORT}/v1/chat/completions`);
  console.log(`  GET  http://0.0.0.0:${PORT}/health`);
  console.log(`\nReady to accept requests!\n`);
});

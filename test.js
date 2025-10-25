import fetch from 'node-fetch';

const API_URL = 'http://localhost:5000';
const CHARACTER_AI_TOKEN = '4dc521360661063088e29f4fcbf46350db470923';
const CHARACTER_ID = '3mMpgx1TwWjQJK9QNaMZMfy1ekaABliiKG6tb2kfRi0';

async function testHealthCheck() {
  console.log('\n=== Testing Health Check ===');
  try {
    const response = await fetch(`${API_URL}/health`, {
      headers: {
        'Authorization': `Bearer ${CHARACTER_AI_TOKEN}`
      }
    });
    const data = await response.json();
    console.log('✓ Health check passed');
    console.log('Response:', JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('✗ Health check failed:', error.message);
    return false;
  }
}

async function testChatCompletion() {
  console.log('\n=== Testing Chat Completion ===');
  try {
    const response = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHARACTER_AI_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CHARACTER_ID,
        messages: [
          {
            role: 'user',
            content: 'Hello! Can you introduce yourself?'
          }
        ],
        stream: false
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✓ Chat completion successful');
      console.log('Character response:', data.choices[0].message.content);
      return true;
    } else {
      console.error('✗ Chat completion failed');
      console.error('Error:', JSON.stringify(data, null, 2));
      return false;
    }
  } catch (error) {
    console.error('✗ Chat completion failed:', error.message);
    return false;
  }
}

async function testConversationContinuity() {
  console.log('\n=== Testing Conversation Continuity ===');
  try {
    console.log('Sending first message...');
    const response1 = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHARACTER_AI_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CHARACTER_ID,
        messages: [
          {
            role: 'user',
            content: 'Remember this number: 42'
          }
        ]
      })
    });

    const data1 = await response1.json();
    console.log('First response:', data1.choices[0].message.content);

    console.log('\nSending follow-up message...');
    const response2 = await fetch(`${API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CHARACTER_AI_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CHARACTER_ID,
        messages: [
          {
            role: 'user',
            content: 'What number did I just tell you to remember?'
          }
        ]
      })
    });

    const data2 = await response2.json();
    console.log('Second response:', data2.choices[0].message.content);
    
    console.log('✓ Conversation continuity test completed');
    return true;
  } catch (error) {
    console.error('✗ Conversation continuity test failed:', error.message);
    return false;
  }
}

async function runTests() {
  console.log('Starting Character.AI OpenAI Proxy Tests...');
  console.log('Using token:', CHARACTER_AI_TOKEN.substring(0, 10) + '...');
  console.log('Using character ID:', CHARACTER_ID.substring(0, 20) + '...');

  const healthOk = await testHealthCheck();
  
  if (!healthOk) {
    console.log('\n⚠ Health check failed. Make sure the server is running on', API_URL);
    process.exit(1);
  }

  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await testChatCompletion();
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  await testConversationContinuity();

  console.log('\n=== All tests completed ===\n');
}

runTests().catch(console.error);

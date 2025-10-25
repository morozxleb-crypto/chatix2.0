import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;
const STORAGE_DIR = isVercel ? path.join(os.tmpdir(), 'conversations') : path.join(__dirname, '..', 'conversations');

export class ConversationStorage {
  constructor() {
    this.ensureStorageDir();
  }

  ensureStorageDir() {
    try {
      if (!fs.existsSync(STORAGE_DIR)) {
        fs.mkdirSync(STORAGE_DIR, { recursive: true });
      }
    } catch (error) {
      console.warn(`Could not create storage directory: ${error.message}`);
    }
  }

  getConversationPath(conversationId) {
    return path.join(STORAGE_DIR, `${conversationId}.json`);
  }

  saveConversation(conversationId, data) {
    try {
      this.ensureStorageDir();
      const filePath = this.getConversationPath(conversationId);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.warn(`Failed to save conversation ${conversationId}:`, error.message);
      return false;
    }
  }

  loadConversation(conversationId) {
    try {
      const filePath = this.getConversationPath(conversationId);
      if (!fs.existsSync(filePath)) {
        return null;
      }
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.warn(`Failed to load conversation ${conversationId}:`, error.message);
      return null;
    }
  }

  conversationExists(conversationId) {
    const filePath = this.getConversationPath(conversationId);
    return fs.existsSync(filePath);
  }

  deleteConversation(conversationId) {
    try {
      const filePath = this.getConversationPath(conversationId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.warn(`Failed to delete conversation ${conversationId}:`, error.message);
      return false;
    }
  }

  listConversations() {
    try {
      if (!fs.existsSync(STORAGE_DIR)) {
        return [];
      }
      const files = fs.readdirSync(STORAGE_DIR);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      console.warn('Failed to list conversations:', error.message);
      return [];
    }
  }
  
  getStorageInfo() {
    return {
      type: isVercel ? 'tmp_ephemeral' : 'local_json',
      directory: STORAGE_DIR,
      writable: this.testWritability()
    };
  }
  
  testWritability() {
    try {
      this.ensureStorageDir();
      const testFile = path.join(STORAGE_DIR, '.write_test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      return true;
    } catch (error) {
      return false;
    }
  }
}

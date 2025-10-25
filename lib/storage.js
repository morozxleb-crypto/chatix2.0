import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.join(__dirname, '..', 'conversations');

export class ConversationStorage {
  constructor() {
    this.ensureStorageDir();
  }

  ensureStorageDir() {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
  }

  getConversationPath(conversationId) {
    return path.join(STORAGE_DIR, `${conversationId}.json`);
  }

  saveConversation(conversationId, data) {
    try {
      const filePath = this.getConversationPath(conversationId);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error(`Failed to save conversation ${conversationId}:`, error);
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
      console.error(`Failed to load conversation ${conversationId}:`, error);
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
      console.error(`Failed to delete conversation ${conversationId}:`, error);
      return false;
    }
  }

  listConversations() {
    try {
      const files = fs.readdirSync(STORAGE_DIR);
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => file.replace('.json', ''));
    } catch (error) {
      console.error('Failed to list conversations:', error);
      return [];
    }
  }
}

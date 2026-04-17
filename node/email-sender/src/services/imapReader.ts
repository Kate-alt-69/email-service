/**
 * IMAP Email Reader - Reads emails from Dovecot/IMAP
 */

import { ImapFlow } from 'imapflow';
import { getGlobalLogger } from '../logger';
const logger = getGlobalLogger();
import { simpleParser } from 'mailparser';

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface InboxEmail {
  uid: number;
  messageId: string;
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string | undefined;
  receivedAt: Date;
  flags: string[];
}

export class ImapEmailReader {
  private client: ImapFlow | null = null;
  private config: ImapConfig;

  constructor(config: ImapConfig) {
    this.config = config;
  }

  /**
   * Connect to IMAP server
   */
  async connect(): Promise<void> {
    try {
      this.client = new ImapFlow(this.config);

      // Listen for updates
      this.client.on('exists', (data: any) => {
        logger.info(`New emails in inbox: ${data.count}`);
      });

      this.client.on('expunge', (data: any) => {
        logger.info(`Email deleted: ${data.seq}`);
      });

      await this.client.connect();
      logger.info('✓ Connected to IMAP server');
    } catch (error) {
      logger.error('IMAP connection error:', error);
      throw error;
    }
  }

  /**
   * Disconnect from IMAP server
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.logout();
        logger.info('✓ Disconnected from IMAP server');
      } catch (error) {
        logger.error('Error closing IMAP connection:', error);
      }
    }
  }

  /**
   * List available mailboxes
   */
  async listMailboxes(): Promise<any[]> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    try {
      const mailboxes = await this.client.list();
      return mailboxes;
    } catch (error) {
      logger.error('Error listing mailboxes:', error);
      throw error;
    }
  }

  /**
   * Check for new emails in inbox
   */
  async checkInbox(limit: number = 25): Promise<InboxEmail[]> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    try {
      // Open INBOX
      const mailbox = await this.client.mailboxOpen('INBOX');
      logger.info(`Inbox has ${mailbox.exists} messages`);

      // Get last N emails
      const messages: InboxEmail[] = [];

      // Get message list (newest first)
      for await (const message of this.client.fetch(
        { 
          uid: Math.max(1, (mailbox.exists || 0) - limit) + ':*'
        },
        { source: true }
      )) {
        try {
          // Parse email
          const parsed = await simpleParser(message.source as Buffer);

          // Handle addresses safely
          let toAddresses: string[] = [];
          if (parsed.to) {
            if (Array.isArray(parsed.to)) {
              toAddresses = parsed.to.map((a: any) => a.address).filter(Boolean);
            } else if (typeof parsed.to === 'object' && 'address' in parsed.to) {
              toAddresses = [(parsed.to as any).address];
            }
          }

          const inboxEmail: InboxEmail = {
            uid: message.uid as number,
            messageId: parsed.messageId || `<${message.uid}@imap>`,
            from: (parsed.from?.text as string) || 'unknown@unknown.com',
            to: toAddresses,
            subject: parsed.subject || '(no subject)',
            text: parsed.text as string | undefined,
            html: (parsed.html as string) || undefined,
            receivedAt: parsed.date || new Date(),
            flags: Array.from((message.flags as any) || []),
          };

          messages.push(inboxEmail);
        } catch (parseError) {
          logger.error(`Error parsing message ${message.uid}:`, parseError);
        }
      }

      return messages;
    } catch (error) {
      logger.error('Error checking inbox:', error);
      throw error;
    }
  }

  /**
   * Get specific email by UID
   */
  async getEmail(uid: number): Promise<InboxEmail | null> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    try {
      const mailbox = await this.client.mailboxOpen('INBOX');

      for await (const message of this.client.fetch({ uid }, { source: true })) {
        try {
          const parsed = await simpleParser(message.source as Buffer);

          // Handle addresses safely
          let toAddresses: string[] = [];
          if (parsed.to) {
            if (Array.isArray(parsed.to)) {
              toAddresses = parsed.to.map((a: any) => a.address).filter(Boolean);
            } else if (typeof parsed.to === 'object' && 'address' in parsed.to) {
              toAddresses = [(parsed.to as any).address];
            }
          }

          return {
            uid: message.uid as number,
            messageId: parsed.messageId || `<${message.uid}@imap>`,
            from: (parsed.from?.text as string) || 'unknown@unknown.com',
            to: toAddresses,
            subject: parsed.subject || '(no subject)',
            text: parsed.text as string | undefined,
            html: (parsed.html as string) || undefined,
            receivedAt: parsed.date || new Date(),
            flags: Array.from((message.flags as any) || []),
          };
        } catch (parseError) {
          logger.error(`Error parsing message ${message.uid}:`, parseError);
          return null;
        }
      }

      return null;
    } catch (error) {
      logger.error('Error fetching email:', error);
      throw error;
    }
  }

  /**
   * Mark email as read
   */
  async markAsRead(uid: number): Promise<void> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    try {
      await this.client.mailboxOpen('INBOX');
      await (this.client as any).setFlagAdd({ uid }, ['\\Seen']);
      logger.info(`Marked email ${uid} as read`);
    } catch (error) {
      logger.error('Error marking email as read:', error);
      throw error;
    }
  }

  /**
   * Delete email
   */
  async deleteEmail(uid: number): Promise<void> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    try {
      await this.client.mailboxOpen('INBOX');
      await (this.client as any).setFlagAdd({ uid }, ['\\Deleted']);
      await (this.client as any).expungeDeleted();
      logger.info(`Deleted email ${uid}`);
    } catch (error) {
      logger.error('Error deleting email:', error);
      throw error;
    }
  }

  /**
   * Search emails by criteria
   */
  async search(criteria: any): Promise<number[]> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    try {
      await this.client.mailboxOpen('INBOX');
      const result = await (this.client as any).search(criteria);
      return (result as any) || [];
    } catch (error) {
      logger.error('Error searching emails:', error);
      throw error;
    }
  }

  /**
   * Get unread messages count
   */
  async getUnreadCount(): Promise<number> {
    if (!this.client) {
      throw new Error('IMAP client not connected');
    }

    try {
      const mailbox = await this.client.mailboxOpen('INBOX');
      return (mailbox as any).unseen || 0;
    } catch (error) {
      logger.error('Error getting unread count:', error);
      throw error;
    }
  }
}

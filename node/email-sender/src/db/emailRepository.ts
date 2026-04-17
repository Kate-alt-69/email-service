/**
 * Email Repository - Database operations
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { getGlobalLogger } from '../logger';
const logger = getGlobalLogger();

export interface Email {
  id: string;
  message_id: string;
  from_address: string;
  to_addresses: string[];
  subject?: string;
  html_body?: string;
  text_body?: string;
  email_type?: string;
  status: 'pending' | 'sent' | 'failed' | 'received' | 'processing';
  direction: 'inbound' | 'outbound';
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
  error_message?: string;
}

export interface EmailAttachment {
  id: string;
  email_id: string;
  filename: string;
  content_type?: string;
  size: number;
  data: Buffer;
  created_at: Date;
}

export interface EmailLogEntry {
  id: string;
  email_id: string;
  event: string;
  details?: string;
  created_at: Date;
}

export interface EmailRepositoryLike {
  saveIncomingEmail(
    messageId: string,
    from: string,
    to: string[],
    subject: string | undefined,
    htmlBody: string | undefined,
    textBody: string | undefined,
    metadata?: Record<string, any>
  ): Promise<Email>;
  saveOutgoingEmail(
    messageId: string,
    from: string,
    to: string[],
    subject: string,
    htmlBody: string,
    textBody: string | undefined,
    emailType?: string
  ): Promise<Email>;
  updateEmailStatus(
    emailId: string,
    status: 'pending' | 'sent' | 'failed' | 'received' | 'processing',
    errorMessage?: string
  ): Promise<void>;
  getEmailById(emailId: string): Promise<Email | null>;
  getEmailsByStatus(status: string, limit?: number): Promise<Email[]>;
  getEmailsForAddress(address: string, limit?: number, offset?: number): Promise<Email[]>;
  addAttachment(
    emailId: string,
    filename: string,
    contentType: string | undefined,
    data: Buffer
  ): Promise<EmailAttachment>;
  getAttachments(emailId: string): Promise<EmailAttachment[]>;
  addLog(emailId: string, event: string, details?: string): Promise<void>;
  cleanOldEmails(daysOld?: number): Promise<number>;
}

export class EmailRepository implements EmailRepositoryLike {
  constructor(private pool: Pool) {}

  /**
   * Save incoming email to database
   */
  async saveIncomingEmail(
    messageId: string,
    from: string,
    to: string[],
    subject: string | undefined,
    htmlBody: string | undefined,
    textBody: string | undefined,
    metadata?: Record<string, any>
  ): Promise<Email> {
    const query = `
      INSERT INTO emails (
        id, message_id, from_address, to_addresses, subject, 
        html_body, text_body, status, direction, metadata, email_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;

    try {
      const result = await this.pool.query(query, [
        uuidv4(),
        messageId,
        from,
        to,
        subject,
        htmlBody,
        textBody,
        'received',
        'inbound',
        metadata ? JSON.stringify(metadata) : null,
        'incoming',
      ]);

      return result.rows[0];
    } catch (error) {
      logger.error('Error saving incoming email:', error);
      throw error;
    }
  }

  /**
   * Save outgoing email to database
   */
  async saveOutgoingEmail(
    messageId: string,
    from: string,
    to: string[],
    subject: string,
    htmlBody: string,
    textBody: string | undefined,
    emailType: string = 'transactional'
  ): Promise<Email> {
    const query = `
      INSERT INTO emails (
        id, message_id, from_address, to_addresses, subject,
        html_body, text_body, status, direction, email_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;

    try {
      const result = await this.pool.query(query, [
        uuidv4(),
        messageId,
        from,
        to,
        subject,
        htmlBody,
        textBody,
        'pending',
        'outbound',
        emailType,
      ]);

      return result.rows[0];
    } catch (error) {
      logger.error('Error saving outgoing email:', error);
      throw error;
    }
  }

  /**
   * Update email status
   */
  async updateEmailStatus(
    emailId: string,
    status: 'pending' | 'sent' | 'failed' | 'received' | 'processing',
    errorMessage?: string
  ): Promise<void> {
    const query = `
      UPDATE emails
      SET status = $1, updated_at = CURRENT_TIMESTAMP, error_message = $2
      WHERE id = $3;
    `;

    try {
      await this.pool.query(query, [status, errorMessage || null, emailId]);
    } catch (error) {
      logger.error('Error updating email status:', error);
      throw error;
    }
  }

  /**
   * Get email by ID
   */
  async getEmailById(emailId: string): Promise<Email | null> {
    const query = `SELECT * FROM emails WHERE id = $1;`;

    try {
      const result = await this.pool.query(query, [emailId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error('Error fetching email:', error);
      throw error;
    }
  }

  /**
   * Get emails by status
   */
  async getEmailsByStatus(
    status: string,
    limit: number = 100
  ): Promise<Email[]> {
    const query = `
      SELECT * FROM emails WHERE status = $1
      ORDER BY created_at DESC
      LIMIT $2;
    `;

    try {
      const result = await this.pool.query(query, [status, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching emails by status:', error);
      throw error;
    }
  }

  /**
   * Get all emails for an address (pagination)
   */
  async getEmailsForAddress(
    address: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<Email[]> {
    const query = `
      SELECT * FROM emails 
      WHERE from_address = $1 OR $1 = ANY(to_addresses)
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    try {
      const result = await this.pool.query(query, [address, limit, offset]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching emails for address:', error);
      throw error;
    }
  }

  /**
   * Add email attachment
   */
  async addAttachment(
    emailId: string,
    filename: string,
    contentType: string | undefined,
    data: Buffer
  ): Promise<EmailAttachment> {
    const query = `
      INSERT INTO email_attachments (
        id, email_id, filename, content_type, size, data
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    try {
      const result = await this.pool.query(query, [
        uuidv4(),
        emailId,
        filename,
        contentType,
        data.length,
        data,
      ]);

      return result.rows[0];
    } catch (error) {
      logger.error('Error adding attachment:', error);
      throw error;
    }
  }

  /**
   * Get email attachments
   */
  async getAttachments(emailId: string): Promise<EmailAttachment[]> {
    const query = `SELECT * FROM email_attachments WHERE email_id = $1;`;

    try {
      const result = await this.pool.query(query, [emailId]);
      return result.rows;
    } catch (error) {
      logger.error('Error fetching attachments:', error);
      throw error;
    }
  }

  /**
   * Add email log entry
   */
  async addLog(emailId: string, event: string, details?: string): Promise<void> {
    const query = `
      INSERT INTO email_logs (id, email_id, event, details)
      VALUES ($1, $2, $3, $4);
    `;

    try {
      await this.pool.query(query, [uuidv4(), emailId, event, details]);
    } catch (error) {
      logger.error('Error adding email log:', error);
      throw error;
    }
  }

  /**
   * Clean old emails (for archival/cleanup)
   */
  async cleanOldEmails(daysOld: number = 90): Promise<number> {
    const query = `
      DELETE FROM emails 
      WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '${daysOld} days'
      AND status IN ('sent', 'received');
    `;

    try {
      const result = await this.pool.query(query);
      return result.rowCount || 0;
    } catch (error) {
      logger.error('Error cleaning old emails:', error);
      throw error;
    }
  }
}

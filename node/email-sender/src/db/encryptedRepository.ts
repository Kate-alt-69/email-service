/**
 * Encrypted Email Repository Wrapper
 * Automatically encrypts/decrypts email data using OS-level encryption
 */

import {
  Email,
  EmailAttachment,
  EmailLogEntry,
  EmailRepositoryLike,
} from './emailRepository';
import { encryptData, decryptData, encryptObject, decryptObject } from '../services/osEncryption';
import { getGlobalLogger } from '../logger';

const logger = getGlobalLogger();

export class EncryptedEmailRepository implements EmailRepositoryLike {
  private enableEncryption: boolean;

  constructor(
    private innerRepository: EmailRepositoryLike,
    enableEncryption: boolean = true
  ) {
    this.enableEncryption = enableEncryption;
    if (!enableEncryption) {
      logger.warn('Email encryption is disabled');
    } else {
      logger.info('Email encryption is enabled');
    }
  }

  async saveIncomingEmail(
    messageId: string,
    from: string,
    to: string[],
    subject: string | undefined,
    htmlBody: string | undefined,
    textBody: string | undefined,
    metadata?: Record<string, any>
  ): Promise<Email> {
    if (!this.enableEncryption) {
      return this.innerRepository.saveIncomingEmail(
        messageId,
        from,
        to,
        subject,
        htmlBody,
        textBody,
        metadata
      );
    }

    try {
      const encryptedHtml = htmlBody ? await encryptData(htmlBody) : undefined;
      const encryptedText = textBody ? await encryptData(textBody) : undefined;
      const encryptedMeta = metadata ? await encryptObject(metadata) : undefined;

      // Store encrypted data using custom method on innerRepository
      const email = await this.innerRepository.saveIncomingEmail(
        messageId,
        from,
        to,
        subject,
        encryptedHtml,
        encryptedText,
        {
          isEncrypted: true,
          encryptionTimestamp: new Date().toISOString(),
          ...(encryptedMeta ? { encryptedMetadata: encryptedMeta } : {}),
        }
      );

      logger.debug(`Saved encrypted incoming email: ${messageId}`);
      return email;
    } catch (error) {
      logger.error('Failed to save encrypted email:', error);
      throw error;
    }
  }

  async saveOutgoingEmail(
    messageId: string,
    from: string,
    to: string[],
    subject: string,
    htmlBody: string,
    textBody: string | undefined,
    emailType?: string
  ): Promise<Email> {
    if (!this.enableEncryption) {
      return this.innerRepository.saveOutgoingEmail(
        messageId,
        from,
        to,
        subject,
        htmlBody,
        textBody,
        emailType
      );
    }

    try {
      const encryptedHtml = await encryptData(htmlBody);
      const encryptedText = textBody ? await encryptData(textBody) : undefined;

      const email = await this.innerRepository.saveOutgoingEmail(
        messageId,
        from,
        to,
        subject,
        encryptedHtml,
        encryptedText,
        emailType
      );

      logger.debug(`Saved encrypted outgoing email: ${messageId}`);
      return email;
    } catch (error) {
      logger.error('Failed to save encrypted outgoing email:', error);
      throw error;
    }
  }

  async updateEmailStatus(
    emailId: string,
    status: 'pending' | 'sent' | 'failed' | 'received' | 'processing',
    errorMessage?: string
  ): Promise<void> {
    return this.innerRepository.updateEmailStatus(emailId, status, errorMessage);
  }

  async getEmailById(emailId: string): Promise<Email | null> {
    if (!this.enableEncryption) {
      return this.innerRepository.getEmailById(emailId);
    }

    try {
      const email = await this.innerRepository.getEmailById(emailId);
      if (!email) return null;

      // Decrypt sensitive fields if they exist
      if (email.html_body && typeof email.html_body === 'string') {
        try {
          email.html_body = await decryptData(email.html_body);
        } catch (error) {
          logger.warn(`Could not decrypt HTML body for email ${emailId}:`, error);
        }
      }

      if (email.text_body && typeof email.text_body === 'string') {
        try {
          email.text_body = await decryptData(email.text_body);
        } catch (error) {
          logger.warn(`Could not decrypt text body for email ${emailId}:`, error);
        }
      }

      if (email.metadata) {
        try {
          if (
            email.metadata!.isEncrypted &&
            email.metadata!.encryptedMetadata
          ) {
            const decrypted = await decryptObject<Record<string, any>>(email.metadata!.encryptedMetadata);
            email.metadata = {
              ...(email.metadata! as any),
              ...decrypted,
            };
            delete email.metadata!.encryptedMetadata;
          }
        } catch (error) {
          logger.warn(`Could not decrypt metadata for email ${emailId}:`, error);
        }
      }

      return email;
    } catch (error) {
      logger.error('Failed to retrieve encrypted email:', error);
      throw error;
    }
  }

  async getEmailsByStatus(
    status: string,
    limit?: number
  ): Promise<Email[]> {
    if (!this.enableEncryption) {
      return this.innerRepository.getEmailsByStatus(status, limit);
    }

    try {
      const emails = await this.innerRepository.getEmailsByStatus(status, limit);
      
      // Decrypt all emails
      const decrypted = await Promise.all(
        emails.map(async (email) => {
          try {
            if (email.html_body && typeof email.html_body === 'string') {
              email.html_body = await decryptData(email.html_body);
            }
            if (email.text_body && typeof email.text_body === 'string') {
              email.text_body = await decryptData(email.text_body);
            }
            return email;
          } catch (error) {
            logger.warn(`Could not decrypt email ${email.id}:`, error);
            return email;
          }
        })
      );

      return decrypted;
    } catch (error) {
      logger.error('Failed to retrieve encrypted emails by status:', error);
      throw error;
    }
  }

  async getEmailsForAddress(
    address: string,
    limit?: number,
    offset?: number
  ): Promise<Email[]> {
    if (!this.enableEncryption) {
      return this.innerRepository.getEmailsForAddress(address, limit, offset);
    }

    try {
      const emails = await this.innerRepository.getEmailsForAddress(
        address,
        limit,
        offset
      );
      
      // Decrypt all emails
      const decrypted = await Promise.all(
        emails.map(async (email) => {
          try {
            if (email.html_body && typeof email.html_body === 'string') {
              email.html_body = await decryptData(email.html_body);
            }
            if (email.text_body && typeof email.text_body === 'string') {
              email.text_body = await decryptData(email.text_body);
            }
            return email;
          } catch (error) {
            logger.warn(`Could not decrypt email ${email.id}:`, error);
            return email;
          }
        })
      );

      return decrypted;
    } catch (error) {
      logger.error('Failed to retrieve encrypted emails for address:', error);
      throw error;
    }
  }

  async addAttachment(
    emailId: string,
    filename: string,
    contentType: string | undefined,
    data: Buffer
  ): Promise<EmailAttachment> {
    if (!this.enableEncryption) {
      return this.innerRepository.addAttachment(
        emailId,
        filename,
        contentType,
        data
      );
    }

    try {
      const encryptedData = await encryptData(data.toString('base64'));
      const attachment = await this.innerRepository.addAttachment(
        emailId,
        filename,
        contentType,
        Buffer.from(encryptedData)
      );

      logger.debug(`Added encrypted attachment: ${filename} to email ${emailId}`);
      return attachment;
    } catch (error) {
      logger.error('Failed to add encrypted attachment:', error);
      throw error;
    }
  }

  async getAttachments(emailId: string): Promise<EmailAttachment[]> {
    if (!this.enableEncryption) {
      return this.innerRepository.getAttachments(emailId);
    }

    try {
      const attachments = await this.innerRepository.getAttachments(emailId);
      
      // Decrypt all attachments
      const decrypted = await Promise.all(
        attachments.map(async (att) => {
          try {
            const decryptedData = await decryptData(att.data.toString('utf-8'));
            att.data = Buffer.from(decryptedData, 'base64');
            return att;
          } catch (error) {
            logger.warn(`Could not decrypt attachment ${att.id}:`, error);
            return att;
          }
        })
      );

      return decrypted;
    } catch (error) {
      logger.error('Failed to retrieve encrypted attachments:', error);
      throw error;
    }
  }

  async addLog(
    emailId: string,
    event: string,
    details?: string
  ): Promise<void> {
    return this.innerRepository.addLog(emailId, event, details);
  }

  async cleanOldEmails(daysOld?: number): Promise<number> {
    return this.innerRepository.cleanOldEmails(daysOld);
  }
}
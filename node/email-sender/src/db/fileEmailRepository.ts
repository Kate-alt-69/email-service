import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getGlobalLogger } from '../logger';
import {
  Email,
  EmailAttachment,
  EmailLogEntry,
  EmailRepositoryLike,
} from './emailRepository';

const logger = getGlobalLogger();

type SerializedEmail = Omit<Email, 'created_at' | 'updated_at'> & {
  created_at: string;
  updated_at: string;
};

type SerializedAttachment = Omit<EmailAttachment, 'created_at' | 'data'> & {
  created_at: string;
  data_base64: string;
};

type SerializedLogEntry = Omit<EmailLogEntry, 'created_at'> & {
  created_at: string;
};

type SerializedThread = {
  id: string;
  subject?: string;
  email_ids: string[];
  participant_addresses: string[];
  latest_email_id: string;
  created_at: string;
  updated_at: string;
};

type FileDatabaseSnapshot = {
  version: 1;
  updated_at: string;
  emails: SerializedEmail[];
  attachments: SerializedAttachment[];
  logs: SerializedLogEntry[];
  threads: SerializedThread[];
};

type JournalOperation =
  | {
      op_id: string;
      type: 'upsert_email';
      created_at: string;
      email: SerializedEmail;
    }
  | {
      op_id: string;
      type: 'upsert_attachment';
      created_at: string;
      attachment: SerializedAttachment;
    }
  | {
      op_id: string;
      type: 'append_log';
      created_at: string;
      log: SerializedLogEntry;
    }
  | {
      op_id: string;
      type: 'delete_emails';
      created_at: string;
      email_ids: string[];
    };

type FileDatabaseJournal = {
  version: 1;
  updated_at: string;
  operations: JournalOperation[];
};

export type FileEmailRepositoryInfo = {
  driver: 'file';
  dbPath: string;
  lockPath: string;
};

const JOURNAL_RETENTION_MS = 12 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDirectoryFor(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function encodeAttachmentData(data: Buffer): string {
  return data.toString('base64');
}

function decodeAttachmentData(data: string): Buffer {
  return Buffer.from(data, 'base64');
}

function serializeEmail(email: Email): SerializedEmail {
  return {
    ...email,
    created_at: email.created_at instanceof Date ? email.created_at.toISOString() : new Date(email.created_at).toISOString(),
    updated_at: email.updated_at instanceof Date ? email.updated_at.toISOString() : new Date(email.updated_at).toISOString(),
  };
}

function deserializeEmail(email: SerializedEmail): Email {
  return {
    ...email,
    created_at: new Date(email.created_at),
    updated_at: new Date(email.updated_at),
  };
}

function serializeAttachment(attachment: EmailAttachment): SerializedAttachment {
  return {
    ...attachment,
    created_at:
      attachment.created_at instanceof Date
        ? attachment.created_at.toISOString()
        : new Date(attachment.created_at).toISOString(),
    data_base64: encodeAttachmentData(attachment.data),
  };
}

function deserializeAttachment(attachment: SerializedAttachment): EmailAttachment {
  return {
    id: attachment.id,
    email_id: attachment.email_id,
    filename: attachment.filename,
    content_type: attachment.content_type,
    size: attachment.size,
    data: decodeAttachmentData(attachment.data_base64),
    created_at: new Date(attachment.created_at),
  };
}

function serializeLogEntry(entry: EmailLogEntry): SerializedLogEntry {
  return {
    ...entry,
    created_at: entry.created_at instanceof Date ? entry.created_at.toISOString() : new Date(entry.created_at).toISOString(),
  };
}

function deserializeLogEntry(entry: SerializedLogEntry): EmailLogEntry {
  return {
    ...entry,
    created_at: new Date(entry.created_at),
  };
}

function createEmptySnapshot(): FileDatabaseSnapshot {
  return {
    version: 1,
    updated_at: nowIso(),
    emails: [],
    attachments: [],
    logs: [],
    threads: [],
  };
}

function createEmptyJournal(): FileDatabaseJournal {
  return {
    version: 1,
    updated_at: nowIso(),
    operations: [],
  };
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    return parsed;
  } catch (error) {
    logger.warn(`Failed to parse JSON file at ${filePath}: ${error}`);
    return fallback;
  }
}

function atomicWriteJson(filePath: string, data: unknown) {
  ensureDirectoryFor(filePath);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function pruneJournalOperations(operations: JournalOperation[]): JournalOperation[] {
  const cutoff = Date.now() - JOURNAL_RETENTION_MS;
  return operations.filter((operation) => {
    const createdAt = new Date(operation.created_at).getTime();
    return Number.isFinite(createdAt) && createdAt >= cutoff;
  });
}

function upsertEmail(snapshot: FileDatabaseSnapshot, email: SerializedEmail) {
  const emailIndex = snapshot.emails.findIndex(
    (existing) => existing.id === email.id || existing.message_id === email.message_id
  );

  if (emailIndex >= 0) {
    snapshot.emails[emailIndex] = {
      ...snapshot.emails[emailIndex],
      ...email,
    };
    return;
  }

  snapshot.emails.push(email);
}

function upsertAttachment(snapshot: FileDatabaseSnapshot, attachment: SerializedAttachment) {
  const attachmentIndex = snapshot.attachments.findIndex((existing) => existing.id === attachment.id);
  if (attachmentIndex >= 0) {
    snapshot.attachments[attachmentIndex] = attachment;
    return;
  }

  snapshot.attachments.push(attachment);
}

function appendLog(snapshot: FileDatabaseSnapshot, entry: SerializedLogEntry) {
  if (snapshot.logs.some((existing) => existing.id === entry.id)) {
    return;
  }

  snapshot.logs.push(entry);
}

function applyOperation(snapshot: FileDatabaseSnapshot, operation: JournalOperation) {
  switch (operation.type) {
    case 'upsert_email':
      upsertEmail(snapshot, operation.email);
      break;
    case 'upsert_attachment':
      upsertAttachment(snapshot, operation.attachment);
      break;
    case 'append_log':
      appendLog(snapshot, operation.log);
      break;
    case 'delete_emails':
      if (operation.email_ids.length === 0) {
        break;
      }
      snapshot.emails = snapshot.emails.filter((email) => !operation.email_ids.includes(email.id));
      snapshot.attachments = snapshot.attachments.filter(
        (attachment) => !operation.email_ids.includes(attachment.email_id)
      );
      snapshot.logs = snapshot.logs.filter((entry) => !operation.email_ids.includes(entry.email_id));
      break;
  }

  snapshot.updated_at = nowIso();
  snapshot.threads = rebuildThreads(snapshot.emails);
}

function resolveThreadId(email: SerializedEmail): string {
  const metadata = isObject(email.metadata) ? email.metadata : undefined;
  const metadataThreadId = typeof metadata?.thread_id === 'string' ? metadata.thread_id : '';
  const inReplyTo = typeof metadata?.in_reply_to === 'string' ? metadata.in_reply_to : '';
  const references = Array.isArray(metadata?.references)
    ? metadata.references.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : [];

  return metadataThreadId || inReplyTo || references[references.length - 1] || email.message_id;
}

function rebuildThreads(emails: SerializedEmail[]): SerializedThread[] {
  const threadMap = new Map<string, SerializedThread>();

  const sortedEmails = [...emails].sort((left, right) => {
    return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  });

  for (const email of sortedEmails) {
    const threadId = resolveThreadId(email);
    const participants = Array.from(
      new Set(
        [email.from_address, ...email.to_addresses]
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const current = threadMap.get(threadId);

    if (!current) {
      threadMap.set(threadId, {
        id: threadId,
        subject: email.subject,
        email_ids: [email.id],
        participant_addresses: participants,
        latest_email_id: email.id,
        created_at: email.created_at,
        updated_at: email.updated_at,
      });
      continue;
    }

    current.email_ids = Array.from(new Set([...current.email_ids, email.id]));
    current.participant_addresses = Array.from(
      new Set([...current.participant_addresses, ...participants])
    );
    current.latest_email_id = email.id;
    current.updated_at = email.updated_at;
    current.subject = current.subject || email.subject;
  }

  return Array.from(threadMap.values()).sort((left, right) => {
    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  });
}

export class FileEmailRepository implements EmailRepositoryLike {
  private snapshot: FileDatabaseSnapshot = createEmptySnapshot();
  private journal: FileDatabaseJournal = createEmptyJournal();
  private writeChain: Promise<unknown> = Promise.resolve();

  readonly info: FileEmailRepositoryInfo;

  constructor(
    private readonly dbPath = path.resolve(process.cwd(), './data/email-service.db'),
    private readonly lockPath = `${path.resolve(process.cwd(), './data/email-service.db')}.lock`
  ) {
    this.info = {
      driver: 'file',
      dbPath: this.dbPath,
      lockPath: this.lockPath,
    };

    this.loadFromDisk();
  }

  private loadFromDisk() {
    ensureDirectoryFor(this.dbPath);
    this.snapshot = readJsonFile<FileDatabaseSnapshot>(this.dbPath, createEmptySnapshot());
    this.journal = readJsonFile<FileDatabaseJournal>(this.lockPath, createEmptyJournal());
    this.journal.operations = pruneJournalOperations(this.journal.operations || []);

    const recoverySnapshot = JSON.parse(JSON.stringify(this.snapshot)) as FileDatabaseSnapshot;
    const recoverableOps = this.journal.operations.length;

    for (const operation of this.journal.operations) {
      applyOperation(recoverySnapshot, operation);
    }

    this.snapshot = recoverySnapshot;
    this.snapshot.updated_at = nowIso();
    this.snapshot.threads = rebuildThreads(this.snapshot.emails);

    atomicWriteJson(this.dbPath, this.snapshot);
    atomicWriteJson(this.lockPath, {
      ...this.journal,
      updated_at: nowIso(),
      operations: this.journal.operations,
    });

    if (recoverableOps > 0) {
      logger.info('Recovered file-backed email database from lock journal', {
        dbPath: this.dbPath,
        lockPath: this.lockPath,
        recoveredOperations: recoverableOps,
      });
    } else {
      logger.info('Initialized file-backed email database', {
        dbPath: this.dbPath,
        lockPath: this.lockPath,
      });
    }
  }

  private queueWrite<T>(work: () => T | Promise<T>): Promise<T> {
    const next = this.writeChain.then(work, work);
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async persistOperation(operation: JournalOperation) {
    this.journal.operations = pruneJournalOperations([...this.journal.operations, operation]);
    this.journal.updated_at = nowIso();

    atomicWriteJson(this.lockPath, this.journal);
    applyOperation(this.snapshot, operation);
    atomicWriteJson(this.dbPath, this.snapshot);
  }

  private cloneEmail(email: Email): Email {
    return deserializeEmail(serializeEmail(email));
  }

  private cloneAttachment(attachment: EmailAttachment): EmailAttachment {
    return deserializeAttachment(serializeAttachment(attachment));
  }

  private sortedEmails(): Email[] {
    return this.snapshot.emails
      .map(deserializeEmail)
      .sort((left, right) => right.created_at.getTime() - left.created_at.getTime());
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
    return this.queueWrite(async () => {
      const email: Email = {
        id: uuidv4(),
        message_id: messageId,
        from_address: from,
        to_addresses: to,
        subject,
        html_body: htmlBody,
        text_body: textBody,
        status: 'received',
        direction: 'inbound',
        created_at: new Date(),
        updated_at: new Date(),
        metadata,
        email_type: 'incoming',
      };

      await this.persistOperation({
        op_id: uuidv4(),
        type: 'upsert_email',
        created_at: nowIso(),
        email: serializeEmail(email),
      });

      return this.cloneEmail(email);
    });
  }

  async saveOutgoingEmail(
    messageId: string,
    from: string,
    to: string[],
    subject: string,
    htmlBody: string,
    textBody: string | undefined,
    emailType = 'transactional'
  ): Promise<Email> {
    return this.queueWrite(async () => {
      const email: Email = {
        id: uuidv4(),
        message_id: messageId,
        from_address: from,
        to_addresses: to,
        subject,
        html_body: htmlBody,
        text_body: textBody,
        status: 'pending',
        direction: 'outbound',
        created_at: new Date(),
        updated_at: new Date(),
        email_type: emailType,
      };

      await this.persistOperation({
        op_id: uuidv4(),
        type: 'upsert_email',
        created_at: nowIso(),
        email: serializeEmail(email),
      });

      return this.cloneEmail(email);
    });
  }

  async updateEmailStatus(
    emailId: string,
    status: 'pending' | 'sent' | 'failed' | 'received' | 'processing',
    errorMessage?: string
  ): Promise<void> {
    return this.queueWrite(async () => {
      const current = await this.getEmailById(emailId);
      if (!current) {
        throw new Error(`Email ${emailId} not found`);
      }

      const updated: Email = {
        ...current,
        status,
        error_message: errorMessage,
        updated_at: new Date(),
      };

      await this.persistOperation({
        op_id: uuidv4(),
        type: 'upsert_email',
        created_at: nowIso(),
        email: serializeEmail(updated),
      });
    });
  }

  async getEmailById(emailId: string): Promise<Email | null> {
    const email = this.snapshot.emails.find((entry) => entry.id === emailId);
    return email ? deserializeEmail(email) : null;
  }

  async getEmailsByStatus(status: string, limit = 100): Promise<Email[]> {
    return this.sortedEmails().filter((email) => email.status === status).slice(0, limit);
  }

  async getEmailsForAddress(address: string, limit = 50, offset = 0): Promise<Email[]> {
    const normalized = address.trim().toLowerCase();
    return this.sortedEmails()
      .filter((email) => {
        return (
          email.from_address.trim().toLowerCase() === normalized ||
          email.to_addresses.some((recipient) => recipient.trim().toLowerCase() === normalized)
        );
      })
      .slice(offset, offset + limit);
  }

  async addAttachment(
    emailId: string,
    filename: string,
    contentType: string | undefined,
    data: Buffer
  ): Promise<EmailAttachment> {
    return this.queueWrite(async () => {
      const attachment: EmailAttachment = {
        id: uuidv4(),
        email_id: emailId,
        filename,
        content_type: contentType,
        size: data.length,
        data,
        created_at: new Date(),
      };

      await this.persistOperation({
        op_id: uuidv4(),
        type: 'upsert_attachment',
        created_at: nowIso(),
        attachment: serializeAttachment(attachment),
      });

      return this.cloneAttachment(attachment);
    });
  }

  async getAttachments(emailId: string): Promise<EmailAttachment[]> {
    return this.snapshot.attachments
      .filter((attachment) => attachment.email_id === emailId)
      .map(deserializeAttachment);
  }

  async addLog(emailId: string, event: string, details?: string): Promise<void> {
    return this.queueWrite(async () => {
      const logEntry: EmailLogEntry = {
        id: uuidv4(),
        email_id: emailId,
        event,
        details,
        created_at: new Date(),
      };

      await this.persistOperation({
        op_id: uuidv4(),
        type: 'append_log',
        created_at: nowIso(),
        log: serializeLogEntry(logEntry),
      });
    });
  }

  async cleanOldEmails(daysOld = 90): Promise<number> {
    return this.queueWrite(async () => {
      const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
      const emailIds = this.snapshot.emails
        .filter((email) => {
          const createdAt = new Date(email.created_at).getTime();
          return createdAt < cutoff && ['sent', 'received'].includes(email.status);
        })
        .map((email) => email.id);

      if (emailIds.length === 0) {
        return 0;
      }

      await this.persistOperation({
        op_id: uuidv4(),
        type: 'delete_emails',
        created_at: nowIso(),
        email_ids: emailIds,
      });

      return emailIds.length;
    });
  }

  async close(): Promise<void> {
    await this.writeChain;
  }
}

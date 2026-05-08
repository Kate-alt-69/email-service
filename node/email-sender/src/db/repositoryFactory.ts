import path from 'path';
import { getGlobalLogger } from '../logger';
import { closeDatabase, getPool, initializeDatabase } from './database';
import { FileEmailRepository } from './fileEmailRepository';
import { EmailRepository, EmailRepositoryLike } from './emailRepository';
import { EncryptedEmailRepository } from './encryptedRepository';

const logger = getGlobalLogger();

type StorageContext =
  | {
      driver: 'file';
      repository: EmailRepositoryLike;
      details: {
        dbPath: string;
        lockPath: string;
      };
    }
  | {
      driver: 'postgres';
      repository: EmailRepositoryLike;
      details: {
        database: string;
        host: string;
        port: number;
      };
    };

let currentStorage: StorageContext | null = null;

function resolveStorageDriver(): 'file' | 'postgres' {
  const configured = String(process.env.EMAIL_STORAGE_DRIVER || 'file').trim().toLowerCase();
  return configured === 'postgres' ? 'postgres' : 'file';
}

export async function createEmailRepository(): Promise<StorageContext> {
  if (currentStorage) {
    return currentStorage;
  }

  const driver = resolveStorageDriver();
  const enableEncryption = process.env.EMAIL_ENCRYPTION_ENABLED !== 'false';

  if (driver === 'postgres') {
    await initializeDatabase();
    let repository: EmailRepositoryLike = new EmailRepository(getPool());
    
    // Wrap with encryption if enabled
    if (enableEncryption) {
      repository = new EncryptedEmailRepository(repository, true);
    }

    currentStorage = {
      driver: 'postgres',
      repository,
      details: {
        database: process.env.DB_NAME || 'email_service',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
      },
    };
    logger.info('Email storage initialized with PostgreSQL backend', {
      ...currentStorage.details,
      encryption: enableEncryption ? 'enabled' : 'disabled',
    });
    return currentStorage;
  }

  const dbPath = path.resolve(
    process.cwd(),
    process.env.EMAIL_DB_PATH || './data/email-service.db'
  );
  let fileRepository: EmailRepositoryLike = new FileEmailRepository(dbPath, `${dbPath}.lock`);
  
  // Wrap with encryption if enabled
  if (enableEncryption) {
    fileRepository = new EncryptedEmailRepository(fileRepository, true);
  }

  currentStorage = {
    driver: 'file',
    repository: fileRepository,
    details: {
      dbPath,
      lockPath: `${dbPath}.lock`,
    },
  };
  logger.info('Email storage initialized with file backend', {
    ...currentStorage.details,
    encryption: enableEncryption ? 'enabled' : 'disabled',
  });
  return currentStorage;
}

export async function closeEmailRepository(): Promise<void> {
  if (!currentStorage) {
    return;
  }

  if (currentStorage.driver === 'postgres') {
    await closeDatabase();
  } else if ('close' in currentStorage.repository && typeof currentStorage.repository.close === 'function') {
    await currentStorage.repository.close();
  }

  currentStorage = null;
}

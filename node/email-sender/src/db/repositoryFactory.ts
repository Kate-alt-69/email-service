import path from 'path';
import { getGlobalLogger } from '../logger';
import { closeDatabase, getPool, initializeDatabase } from './database';
import { FileEmailRepository } from './fileEmailRepository';
import { EmailRepository, EmailRepositoryLike } from './emailRepository';

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

  if (driver === 'postgres') {
    await initializeDatabase();
    currentStorage = {
      driver: 'postgres',
      repository: new EmailRepository(getPool()),
      details: {
        database: process.env.DB_NAME || 'email_service',
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
      },
    };
    logger.info('Email storage initialized with PostgreSQL backend', currentStorage.details);
    return currentStorage;
  }

  const dbPath = path.resolve(
    process.cwd(),
    process.env.EMAIL_DB_PATH || './data/email-service.db'
  );
  const fileRepository = new FileEmailRepository(dbPath, `${dbPath}.lock`);
  currentStorage = {
    driver: 'file',
    repository: fileRepository,
    details: {
      dbPath,
      lockPath: `${dbPath}.lock`,
    },
  };
  logger.info('Email storage initialized with file backend', currentStorage.details);
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

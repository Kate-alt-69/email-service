/**
 * PostgreSQL Database Connection & Initialization
 */

import { Pool, Client } from 'pg';
import { getGlobalLogger } from '../logger';
const logger = getGlobalLogger();

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'email_service',
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

/**
 * Initialize database schema
 */
export async function initializeDatabase() {
  const client = new Client({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
  });

  try {
    await client.connect();
    logger.info('Connected to PostgreSQL server');

    // Create database if not exists
    const dbName = process.env.DB_NAME || 'email_service';
    const dbCheckResult = await client.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName]
    );

    if (dbCheckResult.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      logger.info(`✓ Created database: ${dbName}`);
    }

    await client.end();

    // Now connect to the actual database and create tables
    const mainPool = new Pool({
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: dbName,
    });

    const dbClient = await mainPool.connect();

    try {
      // Create emails table
      await dbClient.query(`
        CREATE TABLE IF NOT EXISTS emails (
          id UUID PRIMARY KEY,
          message_id VARCHAR(255) UNIQUE NOT NULL,
          from_address VARCHAR(255) NOT NULL,
          to_addresses TEXT[] NOT NULL,
          subject TEXT,
          html_body TEXT,
          text_body TEXT,
          email_type VARCHAR(50) DEFAULT 'unknown',
          status VARCHAR(50) DEFAULT 'received',
          direction VARCHAR(20) DEFAULT 'inbound',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB,
          error_message TEXT
        );
      `);

      // Create indexes for performance
      await dbClient.query(`
        CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_address);
        CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
        CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails(direction);
        CREATE INDEX IF NOT EXISTS idx_emails_created_at ON emails(created_at);
      `);

      // Create email attachments table
      await dbClient.query(`
        CREATE TABLE IF NOT EXISTS email_attachments (
          id UUID PRIMARY KEY,
          email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
          filename VARCHAR(255) NOT NULL,
          content_type VARCHAR(100),
          size INTEGER,
          data BYTEA NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      // Create email logs table
      await dbClient.query(`
        CREATE TABLE IF NOT EXISTS email_logs (
          id UUID PRIMARY KEY,
          email_id UUID NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
          event VARCHAR(50) NOT NULL,
          details TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);

      logger.info('✓ Database schema initialized');
    } finally {
      dbClient.release();
      await mainPool.end();
    }
  } catch (error) {
    logger.error('Database initialization error:', error);
    throw error;
  }
}

/**
 * Get database pool
 */
export function getPool(): Pool {
  return pool;
}

/**
 * Close database connections
 */
export async function closeDatabase() {
  await pool.end();
  logger.info('Database connections closed');
}

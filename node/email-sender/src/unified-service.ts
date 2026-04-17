/**
 * Unified Email Service
 * Runs both SMTP Server and HTTP API Server in a single process
 * 
 * Metadata:
 *   - Name: emailService (unified)
 *   - HTTP Port: 3430
 *   - SMTP Port: 3425
 *   - Platforms: Windows, Linux, macOS, FreeBSD, Docker
 * 
 * Usage: node unified-service.js
 * 
 * Environment Variables:
 *   - PORT: HTTP API port (default: 3430)
 *   - SMTP_PORT or SMTP_SERVER_PORT: SMTP port (default: 3425)
 *   - HOST: HTTP API host (default: localhost)
 *   - NODE_ENV: production/development (default: production)
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import SMTPServer from 'smtp-server';
import { simpleParser } from 'mailparser';
import { getGlobalLogger } from './logger';
const logger = getGlobalLogger();
import { initializeEmailTransporter, resolveRelaySettings, verifyTransporter } from './config/nodemailerConfig';
import { loadServiceEnv } from './config/loadEnv';
import { emailService } from './services/emailService';
import { handleServiceRequest } from './handlers/serviceComHandler';
import { createEmailRepository, closeEmailRepository } from './db/repositoryFactory';
import { EmailRepositoryLike } from './db/emailRepository';

// Load environment variables
loadServiceEnv();

const HTTP_PORT = parseInt(process.env.PORT || '3430');
const HTTP_HOST = process.env.HOST || 'localhost';
const SMTP_SERVER_PORT = parseInt(
  process.env.SMTP_SERVER_PORT || process.env.EMAIL_SERVICE_SMTP_PORT || process.env.SMTP_PORT || '3425'
);
const relaySettings = resolveRelaySettings();
const SMTP_RELAY_HOST = relaySettings.relayHost;
const SMTP_RELAY_PORT = parseInt(relaySettings.relayPort, 10);

let emailRepository: EmailRepositoryLike;
let smtpServer: any;
let smtpServerListening = false;

function normalizeParsedMetadata(parsed: any) {
  return {
    message_id: parsed.messageId || null,
    in_reply_to: parsed.inReplyTo || null,
    references: Array.isArray(parsed.references)
      ? parsed.references
      : parsed.references
        ? [parsed.references]
        : [],
    headers: Array.isArray(parsed.headerLines)
      ? parsed.headerLines.map((entry: any) => ({
          key: entry.key,
          line: entry.line,
        }))
      : [],
    received_at: new Date().toISOString(),
  };
}

// ============================================================================
// HTTP API SERVER SETUP
// ============================================================================

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

/**
 * Health check endpoint
 */
app.get('/health', async (req: Request, res: Response) => {
  try {
    const verified = await verifyTransporter();
    const smtpHealthy = smtpServerListening;
    res.status(verified && smtpHealthy ? 200 : 503).json({
      status: verified && smtpHealthy ? 'healthy' : 'degraded',
      services: {
        http: 'running',
        smtp: smtpHealthy ? 'running' : 'error',
      },
      smtp: {
        relayHost: SMTP_RELAY_HOST,
        relayPort: SMTP_RELAY_PORT,
        serverHost: '0.0.0.0',
        serverPort: SMTP_SERVER_PORT,
      },
      storage: {
        configured: !!emailRepository,
        driver: process.env.EMAIL_STORAGE_DRIVER || 'file',
      },
      domains: (process.env.EMAIL_DOMAINS || '').split(',').map((entry) => entry.trim()).filter(Boolean),
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: String(error),
    });
  }
});

/**
 * Service Communication Endpoint
 * POST /service/request
 */
app.post('/service/request', async (req: Request, res: Response) => {
  try {
    await handleServiceRequest(req, res);
  } catch (error: any) {
    logger.error(`Service request error: ${error.message}`);
    res.status(400).json({
      error: error.message,
    });
  }
});

/**
 * Send Email Endpoint
 * POST /send
 */
app.post('/send', async (req: Request, res: Response) => {
  try {
    const { to, subject, text, html, from } = req.body;

    if (!to || !subject || (!text && !html)) {
      return res.status(400).json({
        error: 'Missing required fields: to, subject, text or html',
      });
    }

    const result = await emailService.sendSimpleEmail(
      to,
      subject,
      html || text,
      text,
      from
    );

    res.status(200).json(result);
  } catch (error: any) {
    logger.error(`Send email error: ${error.message}`);
    res.status(500).json({
      error: error.message,
    });
  }
});

/**
 * Get Email Status Endpoint
 * GET /email/:id
 */
app.get('/email/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const email = await emailRepository.getEmailById(id);

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.status(200).json(email);
  } catch (error: any) {
    logger.error(`Get email error: ${error.message}`);
    res.status(500).json({
      error: error.message,
    });
  }
});

app.get('/emails', async (req: Request, res: Response) => {
  try {
    const { status = 'received', limit = 50 } = req.query;
    const emails = await emailRepository.getEmailsByStatus(String(status), parseInt(String(limit), 10));
    res.status(200).json({
      count: emails.length,
      emails,
    });
  } catch (error: any) {
    logger.error(`List emails error: ${error.message}`);
    res.status(500).json({
      error: error.message,
    });
  }
});

app.get('/emails/by-address/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    const emails = await emailRepository.getEmailsForAddress(
      address,
      parseInt(String(limit), 10),
      parseInt(String(offset), 10)
    );
    res.status(200).json({
      count: emails.length,
      emails,
    });
  } catch (error: any) {
    logger.error(`List emails by address error: ${error.message}`);
    res.status(500).json({
      error: error.message,
    });
  }
});

// ============================================================================
// SMTP SERVER SETUP
// ============================================================================

/**
 * Handle incoming SMTP email stream
 */
async function handleSmtpData(stream: any, session: any, callback: Function) {
  try {
    const parsed = await simpleParser(stream);

    const emailFrom = (parsed.from?.text as string) || 'unknown@unknown.com';

    let emailTo: string[] = [];
    if (parsed.to) {
      if (Array.isArray(parsed.to)) {
        emailTo = parsed.to.map((t: any) => (typeof t === 'string' ? t : t.address || t.mail)).filter(Boolean);
      } else if (typeof parsed.to === 'object' && 'address' in parsed.to) {
        emailTo = [(parsed.to as any).address].filter(Boolean);
      } else if (typeof parsed.to === 'string') {
        emailTo = [parsed.to];
      }
    }

    logger.info(
      `✉️  Received email from ${emailFrom} to ${emailTo.join(', ')}`,
    );

    // Store in the configured mail repository
    if (emailRepository) {
      const messageId = parsed.messageId || `<${Date.now()}@email-service>`;
      const savedEmail = await emailRepository.saveIncomingEmail(
        messageId,
        emailFrom,
        emailTo,
        parsed.subject || '(no subject)',
        parsed.html || '',
        parsed.text || '',
        normalizeParsedMetadata(parsed),
      );
      logger.info(`📧 Email stored in mail repository with ID: ${savedEmail.id}`);
    }

    callback();
  } catch (error: any) {
    logger.error(`SMTP processing error: ${error.message}`, error);
    callback(new Error(error.message));
  }
}

/**
 * Initialize SMTP Server
 */
function initializeSMTPServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      smtpServer = new SMTPServer.SMTPServer({
        secure: false,
        allowInsecureAuth: true,
        authOptional: true,
        onConnect: (session: any, callback: Function) => {
          logger.info(`🔌 SMTP connection from ${session.remoteAddress}`);
          callback();
        },
        onMailFrom: (address: any, session: any, callback: Function) => {
          logger.info(`📤 Mail from: ${address.address}`);
          callback();
        },
        onRcptTo: (address: any, session: any, callback: Function) => {
          logger.info(`📥 Mail to: ${address.address}`);
          callback();
        },
        onData: handleSmtpData,
      });

      smtpServer.listen(SMTP_SERVER_PORT, '0.0.0.0', () => {
        smtpServerListening = true;
        logger.info(`🌐 SMTP Server listening on port ${SMTP_SERVER_PORT}`);
        resolve();
      });

      smtpServer.on('error', (err: Error) => {
        logger.error(`SMTP Server error: ${err.message}`);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// ============================================================================
// APPLICATION STARTUP
// ============================================================================

async function start() {
  try {
    logger.info(`
${'═'.repeat(60)}
  🚀 EMAIL SERVICE - Unified (HTTP + SMTP)
  Starting both services in a single process...
${'═'.repeat(60)}
    `);

    const testMode = process.env.TEST_MODE === '1' || process.env.TEST_MODE === 'true';
    if (testMode) {
      logger.warn(`
${'═'.repeat(60)}
  🧪 TEST MODE ENABLED
  Running with file-backed storage and local dependencies only
${'═'.repeat(60)}
      `);
    }

    logger.info(`📚 Initializing email storage...`);
    const storage = await createEmailRepository();
    emailRepository = storage.repository;
    logger.info(`✅ Email storage initialized`, {
      driver: storage.driver,
      details: storage.details,
    });

    // Initialize email transporter
    logger.info(`📧 Initializing email transporter...`);
    await initializeEmailTransporter();
    logger.info(`✅ Email transporter ready`);

    // Start SMTP Server
    logger.info(`🔧 Starting SMTP Server on port ${SMTP_SERVER_PORT}...`);
    await initializeSMTPServer();
    logger.info(`✅ SMTP Server started`);

    // Start HTTP Server
    const httpServer = app.listen(HTTP_PORT, HTTP_HOST, () => {
      logger.info(`
${'═'.repeat(60)}
  ✨ UNIFIED EMAIL SERVICE READY
${'═'.repeat(60)}
  🌐 HTTP API:  http://${HTTP_HOST}:${HTTP_PORT}
  💬 SMTP:      localhost:${SMTP_SERVER_PORT}
  📤 Relay:     ${SMTP_RELAY_HOST}:${SMTP_RELAY_PORT}
  
  Endpoints:
    GET  /health              - Health check
    POST /send                - Send email via HTTP
    POST /service/request     - Service communication
    GET  /email/:id           - Get email status
    GET  /emails              - List emails by status
    GET  /emails/by-address/:address - Query mailbox view
${'═'.repeat(60)}
      `);
    });

    // Graceful shutdown
    const handleShutdown = async (signal: string) => {
      logger.info(`🛑 Received ${signal}, shutting down gracefully...`);

      if (smtpServer) {
        smtpServerListening = false;
        smtpServer.close(() => {
          logger.info(`SMTP Server closed`);
        });
      }

      httpServer.close(async () => {
        await closeEmailRepository();
        logger.info(`✅ Shutdown complete`);
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.warn(`⚠️  Force closing after timeout...`);
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

  } catch (error: any) {
    logger.error(`❌ Failed to start service: ${error.message}`, error);
    process.exit(1);
  }
}

start();

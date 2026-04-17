/**
 * SMTP Server Executable
 * Standalone binary entry point
 * 
 * Metadata:
 *   - Name: emailSMTP
 *   - Port: 25
 *   - Dependencies: none
 *   - Health Check: TCP port 25 open
 */

import SMTPServer from 'smtp-server';
import { simpleParser } from 'mailparser';
import { createLogger, LogLevel } from './logger';
import { checkAllSenderDomains } from './config/domainChecker';
import { loadCloudflareConfig, validateTunnelConfig, formatTunnelConfig } from './config/cloudflareConfig';
import { createTunnelClient, CloudflareTunnelClient } from './config/tunnelClient';
import { createEmailRepository, closeEmailRepository } from './db/repositoryFactory';
import { EmailRepositoryLike } from './db/emailRepository';
import { loadServiceEnv } from './config/loadEnv';

loadServiceEnv();

// Initialize logger
const logger = createLogger({
  serviceName: 'emailSMTP',
  threadId: process.env.THREAD_ID || 'main',
  level: LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO,
  colorize: true,
  format: process.env.LOG_FORMAT === 'json' ? 'json' : 'text',
  logFile: './log.log',
});

const SMTP_PORT = parseInt(process.env.SMTP_SERVER_PORT || '3425');
let emailRepository: EmailRepositoryLike;
let tunnelClient: CloudflareTunnelClient | undefined;

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

/**
 * Metadata exported for Go binary
 * Go reads this to understand service dependencies and configuration
 */
export const SERVICE_METADATA = {
  name: 'emailSMTP',
  version: '1.0.0',
  type: 'smtp-server',
  port: SMTP_PORT,
  dependencies: [] as string[],
  description: 'Email SMTP Server - Receives and stores incoming emails',
};

/**
 * Handle incoming email stream
 */
async function handleSession(session: any) {
  logger.info(`New SMTP connection from ${session.remoteAddress}`);

  session.on('mail', (from: Buffer, callback: Function) => {
    logger.info(`Mail from: ${from.toString()}`);
    callback();
  });

  session.on('rcpt', (to: Buffer, callback: Function) => {
    logger.info(`Mail recipient: ${to.toString()}`);
    callback();
  });

  session.on('data', async (stream: any, session: any, callback: Function) => {
    try {
      const parsed = await simpleParser(stream);

      const emailFrom = (parsed.from?.text as string) || 'unknown@unknown.com';

      let emailTo: string[] = [];
      if (parsed.to) {
        if (Array.isArray(parsed.to)) {
          emailTo = parsed.to.map((a: any) => a.address).filter(Boolean);
        } else if (typeof parsed.to === 'object' && 'address' in parsed.to) {
          emailTo = [(parsed.to as any).address];
        }
      }

      const subject = parsed.subject || '(no subject)';
      const htmlBody = (parsed.html as string) || undefined;
      const textBody = parsed.text as string | undefined;

      logger.info(`Processing incoming email from ${emailFrom} to ${emailTo.join(', ')}`);

      const messageId = parsed.messageId || `<${Date.now()}@email-service>`;

      // Only store in the configured mail repository if it is initialized
      if (emailRepository) {
        const savedEmail = await emailRepository.saveIncomingEmail(
          messageId,
          emailFrom,
          emailTo,
          subject,
          htmlBody,
          textBody,
          normalizeParsedMetadata(parsed)
        );

        if (parsed.attachments && parsed.attachments.length > 0) {
          for (const attachment of parsed.attachments) {
            await emailRepository.addAttachment(
              savedEmail.id,
              attachment.filename || 'unknown',
              attachment.contentType,
              attachment.content
            );
            logger.info(`Stored attachment: ${attachment.filename}`);
          }
        }

        await emailRepository.addLog(
          savedEmail.id,
          'received',
          `Email received from ${emailFrom}`
        );

        logger.info(`✓ Email stored in mail repository with ID: ${savedEmail.id}`);
      } else {
        logger.info(`✓ [TEST MODE] Email received from ${emailFrom} (not stored)`);
      }

      callback(null, `OK: received and queued for delivery`);
    } catch (error) {
      logger.error('Error processing incoming email:', error);
      callback(new Error(`Failed to process email: ${error}`));
    }
  });

  session.on('error', (err: Error) => {
    logger.error('SMTP session error:', err);
  });
}

/**
 * Start SMTP Server
 */
async function startSmtpServer() {
  try {
    logger.info('╔════════════════════════════════════════════════════╗');
    logger.info('║         🚀 SMTP SERVER - Initializing              ║');
    logger.info('╚════════════════════════════════════════════════════╝');

    const storage = await createEmailRepository();
    emailRepository = storage.repository;
    logger.info('✓ Email storage initialized', {
      driver: storage.driver,
      details: storage.details,
    });

    const server = new SMTPServer.SMTPServer({
      secure: false,
      allowInsecureAuth: true,
      onConnect: (session: any, callback: Function) => {
        logger.info(`Connection from ${session.remoteAddress}`);
        callback();
      },
      onAuth: (auth: any, session: any, callback: Function) => {
        if (process.env.SMTP_AUTH_REQUIRED === 'true') {
          const validUser = process.env.SMTP_USER;
          const validPass = process.env.SMTP_PASSWORD;

          if (auth.username === validUser && auth.password === validPass) {
            logger.info(`Authenticated: ${auth.username}`);
            callback(null, { user: auth.username });
          } else {
            callback(new Error('Invalid credentials'));
          }
        } else {
          callback(null, { user: 'anonymous' });
        }
      },
      onMailFrom: (address: any, session: any, callback: Function) => {
        if (process.env.SMTP_WHITELIST_DOMAINS) {
          const whitelistDomains = process.env.SMTP_WHITELIST_DOMAINS.split(',');
          const domain = address.address.split('@')[1];

          if (!whitelistDomains.includes(domain)) {
            return callback(new Error(`Sender domain ${domain} not allowed`));
          }
        }
        callback();
      },
      onRcptTo: (address: any, session: any, callback: Function) => {
        logger.info(`Recipient check: ${address.address}`);
        callback();
      },
      onData: handleSession,
    });

    server.listen(SMTP_PORT, '0.0.0.0', () => {
      logger.info('╔════════════════════════════════════════════════════╗');
      logger.info(`║  ✓ SMTP Server listening on PORT ${SMTP_PORT}              ║`);
      logger.info('║  📧 Ready to receive emails                        ║');
      logger.info('╚════════════════════════════════════════════════════╝');
    });

    // Check domain configuration for receiving emails
    logger.info('📋 Validating receiving domain configuration...');
    try {
      await checkAllSenderDomains();
    } catch (error) {
      logger.warn('Domain configuration check failed:', error);
      logger.info('⚠️  Continuing with SMTP server startup despite domain check warnings...');
    }

    // Load and initialize Cloudflare Tunnel
    logger.info('☁️  Loading Cloudflare Tunnel configuration...');
    try {
      const cfConfig = loadCloudflareConfig();
      
      if (cfConfig.enabled) {
        const validated = validateTunnelConfig(cfConfig);
        if (!validated.valid) {
          logger.warn('⚠️  Cloudflare Tunnel configuration incomplete:', {
            errors: validated.errors,
          });
          logger.warn('☁️  Tunnel disabled - using direct connection');
        } else {
          logger.info(formatTunnelConfig(cfConfig));
          tunnelClient = await createTunnelClient(cfConfig);
        }
      } else {
        logger.info('ℹ️  Cloudflare Tunnel is disabled');
      }
    } catch (error) {
      logger.warn('Failed to initialize Cloudflare Tunnel:', error);
      logger.info('Continuing with direct connection...');
    }

    process.on('SIGINT', async () => {
      logger.info('Shutting down SMTP server...');
      
      // Disconnect tunnel if connected
      if (tunnelClient) {
        try {
          tunnelClient.disconnect();
          logger.info('Cloudflare Tunnel disconnected');
        } catch (err) {
          logger.warn('Error disconnecting tunnel:', err);
        }
      }
      
      server.close(() => {
        logger.info('SMTP server closed');
        closeEmailRepository().then(() => {
          process.exit(0);
        });
      });

      setTimeout(() => {
        logger.warn('Force closing...');
        process.exit(1);
      }, 10000);
    });

    return server;
  } catch (error) {
    logger.error('Failed to start SMTP server:', error);
    process.exit(1);
  }
}

startSmtpServer();

/**
 * Email Service Executable
 * Standalone binary entry point
 * 
 * Metadata:
 *   - Name: emailService
 *   - Port: 3001
 *   - Dependencies: [emailSMTP]
 *   - Health Check: GET /health
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { createLogger, LogLevel } from './logger';
import { initializeEmailTransporter, verifyTransporter } from './config/nodemailerConfig';
import { checkAllSenderDomains } from './config/domainChecker';
import { loadCloudflareConfig, validateTunnelConfig, formatTunnelConfig } from './config/cloudflareConfig';
import { createTunnelClient, CloudflareTunnelClient } from './config/tunnelClient';
import { loadServiceEnv } from './config/loadEnv';
import { emailService } from './services/emailService';
import { handleServiceRequest } from './handlers/serviceComHandler';
import { createEmailRepository, closeEmailRepository } from './db/repositoryFactory';
import { EmailRepositoryLike } from './db/emailRepository';
import { getDefaultFromAddress } from './config/emailDefaults';
import { getSendPulseClient } from './config/sendpulseClient';
import { initializeEncryption } from './services/osEncryption';
import { getAvailableTemplates, loadAndRenderTemplate, TemplateName } from './services/templateEngine';
import * as net from 'net';

loadServiceEnv();

// Initialize logger
const logger = createLogger({
  serviceName: 'emailService',
  threadId: process.env.THREAD_ID || 'main',
  level: LogLevel[process.env.LOG_LEVEL as keyof typeof LogLevel] ?? LogLevel.INFO,
  colorize: true,
  format: process.env.LOG_FORMAT === 'json' ? 'json' : 'text',
  logFile: './log.log',
});

const app = express();
const PORT = parseInt(process.env.PORT || '3430');
const HOST = process.env.HOST || 'localhost';

let emailRepository: EmailRepositoryLike;
let tunnelClient: CloudflareTunnelClient | undefined;

/**
 * Metadata exported for Go binary
 * Go reads this to understand service dependencies and configuration
 */
export const SERVICE_METADATA = {
  name: 'emailService',
  version: '1.0.0',
  type: 'email-api',
  port: PORT,
  dependencies: ['emailSMTP'],
  description: 'Email Service API - Sends, receives, and manages emails',
};

/**
 * Check if a service is running on a port
 */
async function isServiceRunning(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(port, host);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Verify dependencies before starting
 */
async function verifyDependencies(): Promise<boolean> {
  logger.info('Checking dependencies...');

  const smtpHost = process.env.SMTP_HOST || 'localhost';
  const smtpPort = parseInt(process.env.SMTP_PORT || '3425');

  logger.info(`Checking SMTP Server (${smtpHost}:${smtpPort})...`);

  const smtpRunning = await isServiceRunning(smtpHost, smtpPort);

  if (!smtpRunning) {
    logger.error(`❌ SMTP Server not running on ${smtpHost}:${smtpPort}`);
    logger.error('emailService depends on emailSMTP!');
    logger.error('Please start emailSMTP.exe first (or via bootstrap-manager)');
    return false;
  }

  logger.info('✓ SMTP Server is running');
  return true;
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    res.status(verified ? 200 : 503).json({
      status: verified ? 'healthy' : 'smtp_connection_failed',
      service: 'emailService',
      dependencies: {
        smtp: {
          host: process.env.SMTP_HOST || 'localhost',
          port: process.env.SMTP_PORT || '3425',
        },
      },
    });
  } catch (error) {
    res.status(503).json({ status: 'error', error: String(error) });
  }
});

/**
 * SendPulse verification endpoint
 * Tests the SendPulse API connection and retrieves user info
 */
app.get('/api/sendpulse/verify', async (req: Request, res: Response) => {
  try {
    const sendPulse = getSendPulseClient();
    
    if (!process.env.SENDPULSE_API_KEY || !process.env.SENDPULSE_API_SECRET) {
      return res.status(400).json({
        error: 'SendPulse API credentials not configured',
        message: 'Set SENDPULSE_API_KEY and SENDPULSE_API_SECRET environment variables',
      });
    }

    logger.info('🔌 Testing SendPulse connection...');
    
    // Test authentication
    await sendPulse.authenticate();
    
    // Get user info
    const userInfo = await sendPulse.getUserInfo();
    
    res.status(200).json({
      status: 'connected',
      provider: 'sendpulse',
      smtp: {
        host: process.env.SENDPULSE_SMTP_HOST || 'smtp-pulse.com',
        port: process.env.SENDPULSE_SMTP_PORT || '2525',
        user: process.env.SENDPULSE_SMTP_USER,
      },
      account: userInfo,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('SendPulse verification failed:', error);
    res.status(503).json({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get available domains for sending emails from SendPulse
 * Returns all domains configured in SendPulse account
 */
app.get('/api/sendpulse/domains', async (req: Request, res: Response) => {
  try {
    const sendPulse = getSendPulseClient();
    
    if (!process.env.SENDPULSE_API_KEY || !process.env.SENDPULSE_API_SECRET) {
      return res.status(400).json({
        error: 'SendPulse API credentials not configured',
        message: 'Set SENDPULSE_API_KEY and SENDPULSE_API_SECRET environment variables',
      });
    }

    logger.info('📧 Fetching SendPulse domains...');
    const domains = await sendPulse.getDomains();

    res.json({
      provider: 'sendpulse',
      total: domains.length,
      domains: domains.map((d) => ({
        id: d.id,
        name: d.name,
        status: d.status,
        isDefault: d.isDefault,
        createdAt: d.createdAt,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to fetch SendPulse domains:', error);
    res.status(503).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get verified domains only (ready for sending)
 * Returns only verified domains that can be used as sender
 */
app.get('/api/sendpulse/domains/verified', async (req: Request, res: Response) => {
  try {
    const sendPulse = getSendPulseClient();
    
    if (!process.env.SENDPULSE_API_KEY || !process.env.SENDPULSE_API_SECRET) {
      return res.status(400).json({
        error: 'SendPulse API credentials not configured',
        message: 'Set SENDPULSE_API_KEY and SENDPULSE_API_SECRET environment variables',
      });
    }

    logger.info('✓ Fetching verified SendPulse domains...');
    const verifiedDomains = await sendPulse.getVerifiedDomains();
    const defaultDomain = await sendPulse.getDefaultDomain();

    res.json({
      provider: 'sendpulse',
      total: verifiedDomains.length,
      default: defaultDomain ? defaultDomain.name : null,
      domains: verifiedDomains.map((d) => ({
        name: d.name,
        status: d.status,
        isDefault: d.isDefault,
        id: d.id,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('Failed to fetch verified SendPulse domains:', error);
    res.status(503).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Check if a specific domain can send emails via SendPulse
 * Query params: domain=example.com
 */
app.get('/api/sendpulse/domains/check', async (req: Request, res: Response) => {
  try {
    const { domain } = req.query;
    
    if (!domain || typeof domain !== 'string') {
      return res.status(400).json({
        error: 'Missing required query parameter: domain',
      });
    }

    if (!process.env.SENDPULSE_API_KEY || !process.env.SENDPULSE_API_SECRET) {
      return res.status(400).json({
        error: 'SendPulse API credentials not configured',
      });
    }

    const sendPulse = getSendPulseClient();
    const canSend = await sendPulse.isMailableFromDomain(domain);

    res.json({
      domain,
      canSend,
      provider: 'sendpulse',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error(`Failed to check domain ${req.query.domain}:`, error);
    res.status(503).json({
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Send email endpoint
 */
app.post('/api/send', async (req: Request, res: Response) => {
  try {
    const { to, subject, html, text, from } = req.body;

    if (!to || !subject || !html) {
      return res
        .status(400)
        .json({ error: 'Missing required fields: to, subject, html' });
    }

    const result = await emailService.sendSimpleEmail(
      to,
      subject,
      html,
      text,
      from
    );

    // Save to storage
    const savedEmail = await emailRepository.saveOutgoingEmail(
      result.messageId,
      from || getDefaultFromAddress(),
      Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
      'api-send'
    );

    await emailRepository.updateEmailStatus(savedEmail.id, 'sent');

    res.json({
      success: true,
      messageId: result.messageId,
      emailId: savedEmail.id,
    });
  } catch (error) {
    logger.error('Error sending email:', error);
    res.status(500).json({ error: `Failed to send email: ${error}` });
  }
});

/**
 * Get email by ID
 */
app.get('/api/emails/:emailId', async (req: Request, res: Response) => {
  try {
    const { emailId } = req.params;
    const email = await emailRepository.getEmailById(emailId);

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    res.json(email);
  } catch (error) {
    logger.error('Error fetching email:', error);
    res.status(500).json({ error: 'Failed to fetch email' });
  }
});

/**
 * Get emails by status
 */
app.get('/api/emails', async (req: Request, res: Response) => {
  try {
    const { status = 'sent', limit = 50 } = req.query;

    const emails = await emailRepository.getEmailsByStatus(
      String(status),
      parseInt(String(limit))
    );

    res.json({ count: emails.length, emails });
  } catch (error) {
    logger.error('Error fetching emails:', error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

/**
 * Get emails for address
 */
app.get('/api/emails/by-address/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const emails = await emailRepository.getEmailsForAddress(
      address,
      parseInt(String(limit)),
      parseInt(String(offset))
    );

    res.json({ count: emails.length, emails });
  } catch (error) {
    logger.error('Error fetching emails for address:', error);
    res.status(500).json({ error: 'Failed to fetch emails' });
  }
});

/**
 * Service communication endpoint
 */
app.post('/service/request', async (req: Request, res: Response) => {
  try {
    const response = await (handleServiceRequest as any)(req, res);
    if (res.headersSent === false) {
      res.json(response);
    }
  } catch (error) {
    logger.error('Service request error:', error);
    if (res.headersSent === false) {
      res.status(500).json({
        requestId: req.body.requestId,
        success: false,
        error: String(error),
      });
    }
  }
});

/**
 * API Services list
 */
app.get('/api/services', (req: Request, res: Response) => {
  res.json({
    services: ['email-service'],
    status: 'running',
    port: PORT,
    dependencies: SERVICE_METADATA.dependencies,
  });
});

/**
 * List available templates
 */
app.get('/api/templates', (req: Request, res: Response) => {
  try {
    const templates = getAvailableTemplates();
    res.json({
      templates,
      count: templates.length,
    });
  } catch (error) {
    logger.error('Failed to list templates:', error);
    res.status(500).json({
      error: String(error),
    });
  }
});

/**
 * Render a template with variables
 */
app.post('/api/templates/:name/render', (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const variables = req.body.variables || req.body;

    const rendered = loadAndRenderTemplate(name as TemplateName, variables);
    res.json(rendered);
  } catch (error) {
    logger.error('Template rendering failed:', error);
    res.status(400).json({
      error: String(error),
    });
  }
});

/**
 * Initialize and start server
 */
async function startEmailService() {
  try {
    logger.info('╔════════════════════════════════════════════════════╗');
    logger.info('║       🚀 EMAIL SERVICE - Initializing              ║');
    logger.info('╚════════════════════════════════════════════════════╝');

    // Initialize OS-level encryption first
    try {
      initializeEncryption();
    } catch (encryptError) {
      logger.error('Failed to initialize encryption:', encryptError);
      logger.warn('Continuing without encryption - data will not be encrypted');
    }

    // Log available templates
    const templates = getAvailableTemplates();
    logger.info(`✓ Loaded ${templates.length} email templates:`, templates);

    const depsOk = await verifyDependencies();
    if (!depsOk) {
      logger.error('Dependencies check failed, exiting...');
      process.exit(1);
    }

    // Initialize storage backend
    try {
      const storage = await createEmailRepository();
      emailRepository = storage.repository;
      logger.info('✓ Email storage initialized', {
        driver: storage.driver,
        details: storage.details,
      });
    } catch (storageError) {
      logger.error('Failed to initialize email storage:', storageError);
      process.exit(1);
    }

    logger.info('Initializing email transporter...');
    await initializeEmailTransporter();

    logger.info('✓ Email transporter ready');

    // Check domain configuration
    logger.info('📋 Validating sender domain configuration...');
    try {
      await checkAllSenderDomains();
    } catch (error) {
      logger.warn('Domain configuration check failed:', error);
      logger.info('⚠️  Continuing with email service startup despite domain check warnings...');
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

    app.listen(PORT, HOST, () => {
      logger.info('╔════════════════════════════════════════════════════╗');
      logger.info(`║  ✓ Email Service listening on PORT ${PORT}          ║`);
      logger.info('║  📧 REST API running                              ║');
      logger.info('║  Dependencies: emailSMTP ✓                        ║');
      logger.info('╚════════════════════════════════════════════════════╝');
    });
  } catch (error) {
    logger.error('Failed to start email service:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  logger.info('Shutting down email service...');
  
  // Disconnect tunnel if connected
  if (tunnelClient) {
    try {
      tunnelClient.disconnect();
      logger.info('Cloudflare Tunnel disconnected');
    } catch (error) {
      logger.warn('Error disconnecting tunnel:', error);
    }
  }
  
  closeEmailRepository().finally(() => {
    process.exit(0);
  });
});

startEmailService();

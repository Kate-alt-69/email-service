import express, { Request, Response } from 'express';
import cors from 'cors';
import { getGlobalLogger } from './logger';
const logger = getGlobalLogger();
import { initializeEmailTransporter, verifyTransporter } from './config/nodemailerConfig';
import { loadServiceEnv } from './config/loadEnv';
import { emailService } from './services/emailService';
import { handleServiceRequest } from './handlers/serviceComHandler';

// Load environment variables
loadServiceEnv();

const app = express();
const PORT = process.env.PORT || 3430;
const HOST = process.env.HOST || 'localhost';

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
    res.status(verified ? 200 : 503).json({
      status: verified ? 'healthy' : 'smtp_connection_failed',
      smtp: {
        host: process.env.SMTP_HOST || 'localhost',
        port: process.env.SMTP_PORT || '25',
      },
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
 * This endpoint receives requests from Bootstrap Manager or other services
 */
app.post('/service/request', async (req: Request, res: Response) => {
  await handleServiceRequest(req, res);
});

/**
 * Send simple email
 * POST /email/send
 * Body: {
 *   to: string | string[]
 *   subject: string
 *   html: string
 *   text?: string
 *   from?: string
 * }
 */
app.post('/email/send', async (req: Request, res: Response) => {
  try {
    const { to, subject, html, text, from } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({
        error: 'Missing required fields: to, subject, html',
      });
    }

    const result = await emailService.sendSimpleEmail(to, subject, html, text, from);

    res.json({
      success: true,
      messageId: result.messageId,
      response: result.response,
    });
  } catch (error) {
    logger.error('Error sending email:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * Send template-based email
 * POST /email/send-template
 * Body: {
 *   to: string | string[]
 *   subject: string
 *   template: string (HTML template with {{variables}})
 *   data: object (template variables)
 *   from?: string
 * }
 */
app.post('/email/send-template', async (req: Request, res: Response) => {
  try {
    const { to, subject, template, data, from } = req.body;

    if (!to || !subject || !template || !data) {
      return res.status(400).json({
        error: 'Missing required fields: to, subject, template, data',
      });
    }

    const result = await emailService.sendTemplateEmail(to, subject, template, data, from);

    res.json({
      success: true,
      messageId: result.messageId,
      response: result.response,
    });
  } catch (error) {
    logger.error('Error sending template email:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * Send verification email
 * POST /email/verification
 * Body: {
 *   email: string
 *   token: string
 * }
 */
app.post('/email/verification', async (req: Request, res: Response) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({
        error: 'Missing required fields: email, token',
      });
    }

    const result = await emailService.sendVerificationEmail(email, token);

    res.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    logger.error('Error sending verification email:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * Send password reset email
 * POST /email/password-reset
 * Body: {
 *   email: string
 *   token: string
 * }
 */
app.post('/email/password-reset', async (req: Request, res: Response) => {
  try {
    const { email, token } = req.body;

    if (!email || !token) {
      return res.status(400).json({
        error: 'Missing required fields: email, token',
      });
    }

    const result = await emailService.sendPasswordResetEmail(email, token);

    res.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    logger.error('Error sending password reset email:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * Send welcome email
 * POST /email/welcome
 * Body: {
 *   email: string
 *   name: string
 * }
 */
app.post('/email/welcome', async (req: Request, res: Response) => {
  try {
    const { email, name } = req.body;

    if (!email || !name) {
      return res.status(400).json({
        error: 'Missing required fields: email, name',
      });
    }

    const result = await emailService.sendWelcomeEmail(email, name);

    res.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    logger.error('Error sending welcome email:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * Send order confirmation email
 * POST /email/order-confirmation
 * Body: {
 *   email: string
 *   orderData: object
 * }
 */
app.post('/email/order-confirmation', async (req: Request, res: Response) => {
  try {
    const { email, orderData } = req.body;

    if (!email || !orderData) {
      return res.status(400).json({
        error: 'Missing required fields: email, orderData',
      });
    }

    const result = await emailService.sendOrderConfirmationEmail(email, orderData);

    res.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    logger.error('Error sending order confirmation email:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * Send notification email
 * POST /email/notify
 * Body: {
 *   to: string | string[]
 *   title: string
 *   message: string
 *   actionUrl?: string
 *   actionText?: string
 * }
 */
app.post('/email/notify', async (req: Request, res: Response) => {
  try {
    const { to, title, message, actionUrl, actionText } = req.body;

    if (!to || !title || !message) {
      return res.status(400).json({
        error: 'Missing required fields: to, title, message',
      });
    }

    const result = await emailService.sendNotificationEmail(to, title, message, actionUrl, actionText);

    res.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    logger.error('Error sending notification email:', error);
    res.status(500).json({
      success: false,
      error: String(error),
    });
  }
});

/**
 * Error handling middleware
 */
app.use((err: any, req: Request, res: Response, next: any) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

/**
 * 404 handler
 */
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
  });
});

/**
 * Initialize and start server
 */
async function start() {
  try {
    logger.info('═══════════════════════════════════════════════════');
    logger.info('  📬 EMAIL SENDER SERVICE');
    logger.info('═══════════════════════════════════════════════════');

    // Initialize email transporter
    logger.info('Initializing email transporter...');
    initializeEmailTransporter();

    // Verify SMTP connection
    const verified = await verifyTransporter();
    if (!verified) {
      logger.warn('⚠️  SMTP connection verification failed - service may not work');
    } else {
      logger.info('✓ SMTP connection verified');
    }

    // Start server
    app.listen(PORT, () => {
      logger.info(`✓ Server running on http://${HOST}:${PORT}`);
      logger.info('═══════════════════════════════════════════════════\n');
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received - shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received - shutting down gracefully');
  process.exit(0);
});

start();

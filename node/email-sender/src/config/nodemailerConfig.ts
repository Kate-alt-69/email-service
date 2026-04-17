import nodemailer from 'nodemailer';
import { getGlobalLogger } from '../logger';
const logger = getGlobalLogger();

/**
 * Nodemailer Transporter Configuration
 * Connects to local Postfix SMTP server (localhost:25)
 */

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  ignoreTLS: boolean;
  auth?: {
    user: string;
    pass: string;
  };
}

export interface EmailOptions {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  attachments?: any[];
}

let transporter: nodemailer.Transporter | null = null;

export function resolveRelaySettings(env: NodeJS.ProcessEnv = process.env) {
  const provider = String(env.EMAIL_RELAY_PROVIDER || env.EMAIL_PROVIDER || '').trim().toLowerCase();
  const useSendPulse =
    provider === 'sendpulse' ||
    Boolean(env.SENDPULSE_SMTP_USER || env.SENDPULSE_SMTP_PASSWORD || env.SENDPULSE_SMTP_PASS);

  const sendPulseHost = env.SENDPULSE_SMTP_HOST || 'smtp-pulse.com';
  const sendPulsePort = env.SENDPULSE_SMTP_PORT || '2525';
  const sendPulseSecure = env.SENDPULSE_SMTP_SECURE;
  const sendPulseIgnoreTls = env.SENDPULSE_SMTP_IGNORE_TLS;
  const sendPulseUser = env.SENDPULSE_SMTP_USER || '';
  const sendPulsePassword = env.SENDPULSE_SMTP_PASSWORD || env.SENDPULSE_SMTP_PASS || '';

  const relayHost =
    env.SMTP_RELAY_HOST ||
    env.SMTP_HOST ||
    (useSendPulse ? sendPulseHost : 'localhost');
  const relayPort =
    env.SMTP_RELAY_PORT ||
    env.SMTP_PORT ||
    (useSendPulse ? sendPulsePort : '25');
  const relayPassword =
    env.SMTP_RELAY_PASSWORD ||
    env.SMTP_PASSWORD ||
    env.SMTP_PASS ||
    (useSendPulse ? sendPulsePassword : '');
  const relayUser =
    env.SMTP_RELAY_USER ||
    env.SMTP_USER ||
    (useSendPulse ? sendPulseUser : '');

  const explicitSecure =
    env.SMTP_RELAY_SECURE ||
    env.SMTP_SECURE ||
    (useSendPulse ? sendPulseSecure : undefined);
  const explicitIgnoreTls =
    env.SMTP_RELAY_IGNORE_TLS ||
    env.SMTP_IGNORE_TLS ||
    (useSendPulse ? sendPulseIgnoreTls : undefined);

  return {
    provider: useSendPulse ? 'sendpulse' : provider || 'generic-smtp',
    relayHost,
    relayPort,
    relayPassword,
    relayUser,
    explicitSecure,
    explicitIgnoreTls,
  };
}

/**
 * Initialize the email transporter
 */
export function initializeEmailTransporter(): nodemailer.Transporter {
  if (transporter) {
    return transporter;
  }

  const relaySettings = resolveRelaySettings();
  const relayHost = relaySettings.relayHost;
  const relayPort = relaySettings.relayPort;
  const relayPassword = relaySettings.relayPassword;
  const parsedRelayPort = parseInt(relayPort, 10);
  const explicitSecure = relaySettings.explicitSecure;
  const relaySecure =
    typeof explicitSecure === 'string' && explicitSecure.trim() !== ''
      ? explicitSecure === 'true'
      : parsedRelayPort === 465;
  const explicitIgnoreTls = relaySettings.explicitIgnoreTls;
  const relayIgnoreTls =
    typeof explicitIgnoreTls === 'string' && explicitIgnoreTls.trim() !== ''
      ? explicitIgnoreTls !== 'false'
      : !relaySecure;

  const config: EmailConfig = {
    host: relayHost,
    port: parsedRelayPort,
    secure: relaySecure,
    ignoreTLS: relayIgnoreTls,
  };

  // Only add auth if credentials are provided
  if (relaySettings.relayUser) {
    config.auth = {
      user: relaySettings.relayUser,
      pass: relayPassword || '',
    };
  }

  logger.info('Initializing Nodemailer transporter with config:', {
    provider: relaySettings.provider,
    host: config.host,
    port: config.port,
    secure: config.secure,
    ignoreTLS: config.ignoreTLS,
    hasAuth: !!config.auth,
  });

  transporter = nodemailer.createTransport(config);

  return transporter;
}

/**
 * Send an email with comprehensive tracking logging
 */
export async function sendEmail(options: EmailOptions): Promise<any> {
  if (!transporter) {
    initializeEmailTransporter();
  }

  const startTime = Date.now();
  const emailId = `email-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  // Extract domain from sender email
  const fromDomain = options.from.split('@')[1] || 'unknown-domain';
  
  // Normalize recipients to array
  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  const recipientDomains = recipients.map(r => r.split('@')[1] || 'unknown-domain');

  // Log email pipeline start
  logger.info(`[${emailId}] Email pipeline started`, {
    from: options.from,
    fromDomain,
    to: recipients,
    recipientDomains,
    subject: options.subject.substring(0, 50) + (options.subject.length > 50 ? '...' : ''),
  });

  try {
    const relaySettings = resolveRelaySettings();
    // Log before sending
    logger.debug(`[${emailId}] Sending email to SMTP server`, {
      provider: relaySettings.provider,
      smtpServer: `${relaySettings.relayHost}:${relaySettings.relayPort}`,
      recipientCount: recipients.length,
    });

    const info = await transporter!.sendMail({
      from: options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      attachments: options.attachments,
    });

    const duration = Date.now() - startTime;

    // Log successful send with full tracking
    logger.info(`[${emailId}] Email sent successfully`, {
      from: options.from,
      fromDomain,
      to: recipients,
      recipientDomains,
      messageId: info.messageId,
      status: 'SENT',
      durationMs: duration,
      responseCode: info.response?.split('\n')[0],
    });

    // Log per-recipient success
    recipients.forEach(recipient => {
      logger.info(`[${emailId}] Email delivered to recipient`, {
        from: options.from,
        fromDomain,
        to: recipient,
        recipientDomain: recipient.split('@')[1] || 'unknown-domain',
        messageId: info.messageId,
        status: 'DELIVERED',
      });
    });

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
      emailId,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log pipeline failure with full context
    logger.error(`[${emailId}] Email send failed`, {
      from: options.from,
      fromDomain,
      to: recipients,
      recipientDomains,
      subject: options.subject.substring(0, 50),
      status: 'FAILED',
      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      errorMessage,
      durationMs: duration,
      smtpServer: `${resolveRelaySettings().relayHost}:${resolveRelaySettings().relayPort}`,
    });

    // Log per-recipient failure
    recipients.forEach(recipient => {
      logger.dependencyIssue(
        `SMTP delivery to ${recipient}`,
        new Error(`Failed to send email from ${options.from}: ${errorMessage}`)
      );
    });

    throw error;
  }
}

/**
 * Verify transporter connection
 */
export async function verifyTransporter(): Promise<boolean> {
  if (!transporter) {
    initializeEmailTransporter();
  }

  try {
    await transporter!.verify();
    logger.info('SMTP connection verified successfully');
    return true;
  } catch (error) {
    logger.error('SMTP connection verification failed:', error);
    return false;
  }
}

/**
 * Get the transporter instance
 */
export function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    initializeEmailTransporter();
  }
  return transporter!;
}

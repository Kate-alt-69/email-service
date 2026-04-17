/**
 * Service Communication Handler for Email Service
 * Receives requests from Bootstrap Manager and routes to appropriate handlers
 */

import { Request, Response } from 'express';
import { getGlobalLogger } from '../logger';
const logger = getGlobalLogger();
import { 
  ServiceRequest, 
  ServiceResponse, 
  PROTOCOL_VERSION,
  STATUS_CODES,
  ERROR_CODES,
  EMAIL_ACTIONS,
  SERVICES
} from '../communication/serviceComTypes';
import { sendEmail, EmailOptions } from '../config/nodemailerConfig';
import { emailService } from '../services/emailService';
import { getDefaultFromAddress } from '../config/emailDefaults';

/**
 * Validate incoming service request
 */
function validateRequest(request: any): { valid: boolean; error?: string } {
  if (!request.requestId) return { valid: false, error: 'Missing requestId' };
  if (!request.version) return { valid: false, error: 'Missing version' };
  if (!request.sourceService) return { valid: false, error: 'Missing sourceService' };
  if (!request.targetService) return { valid: false, error: 'Missing targetService' };
  if (!request.action) return { valid: false, error: 'Missing action' };
  if (!request.payload) return { valid: false, error: 'Missing payload' };

  // Check version compatibility (allow patch version differences)
  const [reqMajor, reqMinor] = request.version.split('.').map(Number);
  const [ourMajor, ourMinor] = PROTOCOL_VERSION.split('.').map(Number);

  if (reqMajor !== ourMajor || reqMinor !== ourMinor) {
    return { valid: false, error: `Version mismatch: expected ${PROTOCOL_VERSION}, got ${request.version}` };
  }

  if (request.targetService !== SERVICES.EMAIL_SERVICE) {
    return { valid: false, error: `This is email service, cannot handle ${request.targetService}` };
  }

  return { valid: true };
}

/**
 * Create success response
 */
function createSuccessResponse(
  requestId: string,
  data: Record<string, any> = {}
): ServiceResponse {
  return {
    requestId,
    version: PROTOCOL_VERSION,
    timestamp: Date.now(),
    success: true,
    statusCode: STATUS_CODES.OK,
    data,
  };
}

/**
 * Create error response
 */
function createErrorResponse(
  requestId: string,
  statusCode: number,
  code: string,
  message: string,
  details?: Record<string, any>
): ServiceResponse {
  return {
    requestId,
    version: PROTOCOL_VERSION,
    timestamp: Date.now(),
    success: false,
    statusCode,
    error: { code, message, details },
  };
}

/**
 * Handler for service requests
 */
export async function handleServiceRequest(req: Request, res: Response) {
  const request = req.body as ServiceRequest;

  // Validate request format
  const validation = validateRequest(request);
  if (!validation.valid) {
    logger.error(`Invalid service request: ${validation.error}`);
    return res.status(400).json(
      createErrorResponse(
        request?.requestId || 'unknown',
        STATUS_CODES.BAD_REQUEST,
        ERROR_CODES.INVALID_REQUEST,
        validation.error!
      )
    );
  }

  logger.info(`Service request from ${request.sourceService}: ${request.action}`);

  try {
    switch (request.action) {
      case EMAIL_ACTIONS.SEND:
        return await handleSendEmail(request, res);

      case EMAIL_ACTIONS.VERIFY:
        return await handleSendVerificationEmail(request, res);

      case EMAIL_ACTIONS.PASSWORD_RESET:
        return await handleSendPasswordResetEmail(request, res);

      case EMAIL_ACTIONS.WELCOME:
        return await handleSendWelcomeEmail(request, res);

      case EMAIL_ACTIONS.ORDER_CONFIRMATION:
        return await handleSendOrderConfirmationEmail(request, res);

      case EMAIL_ACTIONS.NOTIFY:
        return await handleSendNotificationEmail(request, res);

      default:
        logger.warn(`Unknown action: ${request.action}`);
        return res.status(400).json(
          createErrorResponse(
            request.requestId,
            STATUS_CODES.BAD_REQUEST,
            ERROR_CODES.INVALID_REQUEST,
            `Unknown action: ${request.action}`
          )
        );
    }
  } catch (error) {
    logger.error(`Service request error: ${error}`);
    return res.status(500).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.INTERNAL_ERROR,
        ERROR_CODES.INTERNAL_ERROR,
        `Internal server error: ${String(error)}`,
        { error: String(error) }
      )
    );
  }
}

async function handleSendEmail(request: ServiceRequest, res: Response) {
  const { to, subject, html, text, from, cc, bcc, replyTo, attachments } = request.payload;

  if (!to || !subject || !html) {
    return res.status(400).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.BAD_REQUEST,
        ERROR_CODES.INVALID_PAYLOAD,
        'Missing required fields: to, subject, html'
      )
    );
  }

  try {
    const messageFrom = from || getDefaultFromAddress();
    const result = await sendEmail({
      from: messageFrom,
      to,
      subject,
      html,
      text,
      cc,
      bcc,
      replyTo,
      attachments,
    });

    logger.info(`Email sent via service request: ${result.messageId}`);

    return res.json(
      createSuccessResponse(request.requestId, {
        messageId: result.messageId,
        response: result.response,
        sentFrom: messageFrom,
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    logger.error(`Failed to send email: ${error}`);
    return res.status(500).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.INTERNAL_ERROR,
        ERROR_CODES.SEND_FAILED,
        `Failed to send email: ${String(error)}`,
        { error: String(error) }
      )
    );
  }
}

async function handleSendVerificationEmail(request: ServiceRequest, res: Response) {
  const { email, token } = request.payload;

  if (!email || !token) {
    return res.status(400).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.BAD_REQUEST,
        ERROR_CODES.INVALID_PAYLOAD,
        'Missing required fields: email, token'
      )
    );
  }

  try {
    const result = await emailService.sendVerificationEmail(email, token);
    return res.json(
      createSuccessResponse(request.requestId, {
        messageId: result.messageId,
        sentFrom: getDefaultFromAddress(),
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    logger.error(`Failed to send verification email: ${error}`);
    return res.status(500).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.INTERNAL_ERROR,
        ERROR_CODES.SEND_FAILED,
        `Failed to send verification email: ${String(error)}`
      )
    );
  }
}

async function handleSendPasswordResetEmail(request: ServiceRequest, res: Response) {
  const { email, token } = request.payload;

  if (!email || !token) {
    return res.status(400).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.BAD_REQUEST,
        ERROR_CODES.INVALID_PAYLOAD,
        'Missing required fields: email, token'
      )
    );
  }

  try {
    const result = await emailService.sendPasswordResetEmail(email, token);
    return res.json(
      createSuccessResponse(request.requestId, {
        messageId: result.messageId,
        sentFrom: getDefaultFromAddress(),
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    logger.error(`Failed to send password reset email: ${error}`);
    return res.status(500).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.INTERNAL_ERROR,
        ERROR_CODES.SEND_FAILED,
        `Failed to send password reset email: ${String(error)}`
      )
    );
  }
}

async function handleSendWelcomeEmail(request: ServiceRequest, res: Response) {
  const { email, name } = request.payload;

  if (!email || !name) {
    return res.status(400).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.BAD_REQUEST,
        ERROR_CODES.INVALID_PAYLOAD,
        'Missing required fields: email, name'
      )
    );
  }

  try {
    const result = await emailService.sendWelcomeEmail(email, name);
    return res.json(
      createSuccessResponse(request.requestId, {
        messageId: result.messageId,
        sentFrom: getDefaultFromAddress(),
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    logger.error(`Failed to send welcome email: ${error}`);
    return res.status(500).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.INTERNAL_ERROR,
        ERROR_CODES.SEND_FAILED,
        `Failed to send welcome email: ${String(error)}`
      )
    );
  }
}

async function handleSendOrderConfirmationEmail(request: ServiceRequest, res: Response) {
  const { email, orderId, total } = request.payload;

  if (!email || !orderId) {
    return res.status(400).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.BAD_REQUEST,
        ERROR_CODES.INVALID_PAYLOAD,
        'Missing required fields: email, orderId'
      )
    );
  }

  try {
    const result = await emailService.sendOrderConfirmationEmail(email, {
      orderId,
      total,
    });
    return res.json(
      createSuccessResponse(request.requestId, {
        messageId: result.messageId,
        sentFrom: getDefaultFromAddress(),
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    logger.error(`Failed to send order confirmation email: ${error}`);
    return res.status(500).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.INTERNAL_ERROR,
        ERROR_CODES.SEND_FAILED,
        `Failed to send order confirmation email: ${String(error)}`
      )
    );
  }
}

async function handleSendNotificationEmail(request: ServiceRequest, res: Response) {
  const { to, title, message, actionUrl, actionText } = request.payload;

  if (!to || !title || !message) {
    return res.status(400).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.BAD_REQUEST,
        ERROR_CODES.INVALID_PAYLOAD,
        'Missing required fields: to, title, message'
      )
    );
  }

  try {
    const result = await emailService.sendNotificationEmail(to, title, message, actionUrl, actionText);
    return res.json(
      createSuccessResponse(request.requestId, {
        messageId: result.messageId,
        sentFrom: getDefaultFromAddress(),
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    logger.error(`Failed to send notification email: ${error}`);
    return res.status(500).json(
      createErrorResponse(
        request.requestId,
        STATUS_CODES.INTERNAL_ERROR,
        ERROR_CODES.SEND_FAILED,
        `Failed to send notification email: ${String(error)}`
      )
    );
  }
}

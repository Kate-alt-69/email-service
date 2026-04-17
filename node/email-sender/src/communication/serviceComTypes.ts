/**
 * Service Communication Protocol
 * Shared types for communication between Backend, Bootstrap Manager, and Services
 */

export interface ServiceRequest {
  requestId: string;                    // Unique request ID
  version: string;                      // Protocol version (e.g., "1.0.0")
  timestamp: number;                    // Request timestamp
  sourceService: string;                // "backend", "email-service", etc.
  targetService: string;                // "email-service", "cache-service", etc.
  action: string;                       // "send_email", "verify_email", etc.
  payload: Record<string, any>;         // Action-specific data
}

export interface ServiceResponse {
  requestId: string;                    // Echo request ID
  version: string;                      // Protocol version
  timestamp: number;                    // Response timestamp
  success: boolean;
  statusCode: number;                   // HTTP-like status
  data?: Record<string, any>;           // Response data
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
}

// Email-specific request/response types
export namespace EmailService {
  export interface SendEmailRequest {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    from?: string;                      // Can override EMAIL_FROM env var
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    attachments?: Array<{
      filename: string;
      content?: string;
      path?: string;
      contentType?: string;
    }>;
  }

  export interface SendEmailResponse {
    messageId: string;
    response: string;
    sentFrom: string;                   // The actual "from" address used
    timestamp: number;
  }

  export interface VerifyEmailRequest {
    email: string;
    token: string;
  }

  export interface PasswordResetRequest {
    email: string;
    token: string;
  }

  export interface WelcomeEmailRequest {
    email: string;
    name: string;
  }

  export interface OrderConfirmationRequest {
    email: string;
    orderId: string;
    total: number;
  }

  export interface NotificationRequest {
    to: string | string[];
    title: string;
    message: string;
    actionUrl?: string;
    actionText?: string;
  }
}

// Protocol version - increment when making breaking changes
export const PROTOCOL_VERSION = "1.0.0";

// Service IDs
export const SERVICES = {
  BACKEND: "backend",
  EMAIL_SERVICE: "email-service",
  BOOTSTRAP_MANAGER: "bootstrap-manager",
} as const;

// Email service actions
export const EMAIL_ACTIONS = {
  SEND: "send_email",
  VERIFY: "send_verification_email",
  PASSWORD_RESET: "send_password_reset_email",
  WELCOME: "send_welcome_email",
  ORDER_CONFIRMATION: "send_order_confirmation_email",
  NOTIFY: "send_notification_email",
} as const;

// HTTP-like status codes
export const STATUS_CODES = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  SERVICE_NOT_FOUND: 404,
  PROTOCOL_ERROR: 426,                 // Upgrade Required (version mismatch)
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

// Error codes
export const ERROR_CODES = {
  INVALID_REQUEST: "INVALID_REQUEST",
  VERSION_MISMATCH: "VERSION_MISMATCH",
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  INVALID_PAYLOAD: "INVALID_PAYLOAD",
  SEND_FAILED: "SEND_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

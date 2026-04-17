import { sendEmail, EmailOptions, verifyTransporter } from '../config/nodemailerConfig';
import { getGlobalLogger } from '../logger';
import { getDefaultFromAddress } from '../config/emailDefaults';
const logger = getGlobalLogger();

export interface TemplateData {
  [key: string]: any;
}

/**
 * Simple template engine for email HTML
 */
function renderTemplate(template: string, data: TemplateData): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? String(data[key]) : match;
  });
}

/**
 * Email Service
 */
export class EmailService {
  /**
   * Send a simple email
   */
  async sendSimpleEmail(
    to: string | string[],
    subject: string,
    html: string,
    text?: string,
    from?: string
  ): Promise<any> {
    const fromAddress = from || getDefaultFromAddress();
    const fromDomain = fromAddress.split('@')[1] || 'unknown-domain';
    const recipients = Array.isArray(to) ? to : [to];
    
    logger.debug('Email service: preparing to send email', {
      from: fromAddress,
      fromDomain,
      to: recipients,
      subject: subject.substring(0, 50),
    });

    try {
      const result = await sendEmail({
        from: fromAddress,
        to,
        subject,
        html,
        text,
      });

      logger.info('Email service: email sent successfully', {
        from: fromAddress,
        fromDomain,
        to: recipients,
        status: 'SUCCESS',
        messageId: result.messageId,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Email service: email send failed', {
        from: fromAddress,
        fromDomain,
        to: recipients,
        subject,
        status: 'ERROR',
        error: errorMsg,
      });
      throw error;
    }
  }

  /**
   * Send email with template
   */
  async sendTemplateEmail(
    to: string | string[],
    subject: string,
    template: string,
    templateData: TemplateData,
    from?: string
  ): Promise<any> {
    const html = renderTemplate(template, templateData);
    return this.sendSimpleEmail(to, subject, html, undefined, from);
  }

  /**
   * Send verification email
   */
  async sendVerificationEmail(email: string, token: string): Promise<any> {
    const verificationLink = `${process.env.APP_URL}/verify?token=${token}`;

    const html = `
      <h2>Welcome! Verify Your Email</h2>
      <p>Click the link below to verify your email address:</p>
      <a href="${verificationLink}" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">
        Verify Email
      </a>
      <p>Or paste this link: ${verificationLink}</p>
      <p>Link expires in 24 hours.</p>
    `;

    const emailDomain = email.split('@')[1] || 'unknown-domain';
    logger.info('Sending verification email', {
      to: email,
      recipientDomain: emailDomain,
      type: 'VERIFICATION',
      tokenPrefix: token.substring(0, 10),
    });

    try {
      const result = await this.sendSimpleEmail(email, 'Verify Your Email', html);
      logger.info('Verification email sent successfully', {
        to: email,
        recipientDomain: emailDomain,
        messageId: result.messageId,
        type: 'VERIFICATION',
      });
      return result;
    } catch (error) {
      logger.dependencyIssue(
        `Verification email service (${emailDomain})`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, token: string): Promise<any> {
    const resetLink = `${process.env.APP_URL}/reset-password?token=${token}`;

    const html = `
      <h2>Reset Your Password</h2>
      <p>Click the link below to reset your password:</p>
      <a href="${resetLink}" style="padding: 10px 20px; background: #28a745; color: white; text-decoration: none; border-radius: 4px;">
        Reset Password
      </a>
      <p>Or paste this link: ${resetLink}</p>
      <p>This link expires in 1 hour.</p>
    `;

    const emailDomain = email.split('@')[1] || 'unknown-domain';
    logger.info('Sending password reset email', {
      to: email,
      recipientDomain: emailDomain,
      type: 'PASSWORD_RESET',
      tokenPrefix: token.substring(0, 10),
    });

    try {
      const result = await this.sendSimpleEmail(email, 'Reset Your Password', html);
      logger.info('Password reset email sent successfully', {
        to: email,
        recipientDomain: emailDomain,
        messageId: result.messageId,
        type: 'PASSWORD_RESET',
      });
      return result;
    } catch (error) {
      logger.dependencyIssue(
        `Password reset email service (${emailDomain})`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Send welcome email
   */
  async sendWelcomeEmail(email: string, name: string): Promise<any> {
    const html = `
      <h2>Welcome, ${name}!</h2>
      <p>Your account has been created successfully.</p>
      <p>You can now log in to your account and start using our service.</p>
      <a href="${process.env.APP_URL}/login" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">
        Go to Login
      </a>
    `;

    const emailDomain = email.split('@')[1] || 'unknown-domain';
    logger.info('Sending welcome email', {
      to: email,
      recipientDomain: emailDomain,
      type: 'WELCOME',
      userName: name,
    });

    try {
      const result = await this.sendSimpleEmail(email, 'Welcome!', html);
      logger.info('Welcome email sent successfully', {
        to: email,
        recipientDomain: emailDomain,
        messageId: result.messageId,
        type: 'WELCOME',
      });
      return result;
    } catch (error) {
      logger.dependencyIssue(
        `Welcome email service (${emailDomain})`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Send order confirmation email
   */
  async sendOrderConfirmationEmail(email: string, orderData: any): Promise<any> {
    const html = `
      <h2>Order Confirmation</h2>
      <p>Thank you for your order!</p>
      <p><strong>Order ID:</strong> ${orderData.orderId}</p>
      <p><strong>Total:</strong> $${orderData.total}</p>
      <p>Your order has been received and will be processed shortly.</p>
      <a href="${process.env.APP_URL}/orders/${orderData.orderId}" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">
        View Order
      </a>
    `;

    const emailDomain = email.split('@')[1] || 'unknown-domain';
    logger.info('Sending order confirmation email', {
      to: email,
      recipientDomain: emailDomain,
      type: 'ORDER_CONFIRMATION',
      orderId: orderData.orderId,
      orderTotal: orderData.total,
    });

    try {
      const result = await this.sendSimpleEmail(email, `Order Confirmation - #${orderData.orderId}`, html);
      logger.info('Order confirmation email sent successfully', {
        to: email,
        recipientDomain: emailDomain,
        messageId: result.messageId,
        type: 'ORDER_CONFIRMATION',
        orderId: orderData.orderId,
      });
      return result;
    } catch (error) {
      logger.dependencyIssue(
        `Order confirmation email service (${emailDomain})`,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Send notification email
   */
  async sendNotificationEmail(
    to: string | string[],
    title: string,
    message: string,
    actionUrl?: string,
    actionText?: string
  ): Promise<any> {
    let html = `
      <h2>${title}</h2>
      <p>${message}</p>
    `;

    if (actionUrl && actionText) {
      html += `
        <a href="${actionUrl}" style="padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">
          ${actionText}
        </a>
      `;
    }

    return this.sendSimpleEmail(to, title, html);
  }
}

export const emailService = new EmailService();

/**
 * Branding Service
 * Manages email branding, custom domains, and logos
 */

import * as fs from 'fs';
import * as path from 'path';
import { getGlobalLogger } from '../logger';
import {
  getDefaultFromAddress,
  getDefaultWebsiteUrl,
  getPrimaryDomain,
} from '../config/emailDefaults';
const logger = getGlobalLogger();

export interface BrandingConfig {
  companyName: string;
  logoPath?: string;
  logoBase64?: string;
  logoContentType?: string;
  primaryColor?: string;
  accentColor?: string;
  customDomain?: string;
  customDomainFromEmail?: string;
  tagline?: string;
  websiteUrl?: string;
}

export interface BrandedEmailTemplate {
  subject: string;
  htmlBody: string;
  textBody: string;
  logoUrl?: string;
  companyName: string;
  fromDomain: string;
}

class BrandingService {
  private brandingConfig: BrandingConfig;

  constructor() {
    this.brandingConfig = this.loadBrandingConfig();
  }

  /**
   * Load branding configuration from environment and file system
   */
  private loadBrandingConfig(): BrandingConfig {
    const primaryDomain = getPrimaryDomain();
    const config: BrandingConfig = {
      companyName: process.env.COMPANY_NAME || 'Email Service',
      customDomain: process.env.CUSTOM_DOMAIN || primaryDomain,
      customDomainFromEmail: process.env.CUSTOM_DOMAIN_FROM_EMAIL || getDefaultFromAddress(),
      primaryColor: process.env.PRIMARY_COLOR || '#007bff',
      accentColor: process.env.ACCENT_COLOR || '#0056b3',
      tagline: process.env.COMPANY_TAGLINE || 'Professional Email Service',
      websiteUrl: getDefaultWebsiteUrl(),
    };

    // Try to load logo from file system
    const logoPath = process.env.LOGO_PATH || './assets/logo.png';
    if (fs.existsSync(logoPath)) {
      config.logoPath = logoPath;
      config.logoBase64 = this.loadLogoAsBase64(logoPath);
      config.logoContentType = this.getLogoContentType(logoPath);
      logger.info(`✓ Loaded logo from: ${logoPath}`);
    } else {
      logger.warn(`Logo file not found at: ${logoPath}`);
    }

    logger.info('Branding config loaded:', {
      company: config.companyName,
      domain: config.customDomain,
      hasLogo: !!config.logoBase64,
      colors: {
        primary: config.primaryColor,
        accent: config.accentColor,
      },
    });

    return config;
  }

  /**
   * Load logo as base64 string
   */
  private loadLogoAsBase64(logoPath: string): string {
    try {
      const absolutePath = path.resolve(logoPath);
      const fileBuffer = fs.readFileSync(absolutePath);
      return fileBuffer.toString('base64');
    } catch (error) {
      logger.error(`Failed to load logo from ${logoPath}:`, error);
      return '';
    }
  }

  /**
   * Get MIME type based on file extension
   */
  private getLogoContentType(logoPath: string): string {
    const ext = path.extname(logoPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.svg': 'image/svg+xml',
    };
    return mimeTypes[ext] || 'image/png';
  }

  /**
   * Get branding configuration
   */
  getBrandingConfig(): BrandingConfig {
    return this.brandingConfig;
  }

  /**
   * Get logo as data URI for embedding in HTML emails
   */
  getLogoDataUri(): string {
    if (!this.brandingConfig.logoBase64 || !this.brandingConfig.logoContentType) {
      return '';
    }
    return `data:${this.brandingConfig.logoContentType};base64,${this.brandingConfig.logoBase64}`;
  }

  /**
   * Get custom domain sender email
   */
  getFromEmail(fallback?: string): string {
    return this.brandingConfig.customDomainFromEmail || fallback || getDefaultFromAddress();
  }

  /**
   * Get custom domain
   */
  getCustomDomain(): string {
    return this.brandingConfig.customDomain || getPrimaryDomain();
  }

  /**
   * Create branded email header HTML
   */
  createBrandedHeader(): string {
    const logoDataUri = this.getLogoDataUri();
    const logoHtml = logoDataUri
      ? `<img src="${logoDataUri}" alt="${this.brandingConfig.companyName}" style="height: 50px; margin: 20px 0;" />`
      : `<h1 style="color: ${this.brandingConfig.primaryColor}; margin: 20px 0;">${this.brandingConfig.companyName}</h1>`;

    return `
      <div style="text-align: center; border-bottom: 3px solid ${this.brandingConfig.primaryColor}; padding-bottom: 20px; margin-bottom: 30px;">
        ${logoHtml}
        <p style="color: #666; font-size: 12px; margin: 5px 0; font-style: italic;">
          ${this.brandingConfig.tagline}
        </p>
      </div>
    `;
  }

  /**
   * Create branded email footer HTML
   */
  createBrandedFooter(): string {
    return `
      <div style="background-color: #f8f9fa; border-top: 1px solid #ddd; padding: 20px; margin-top: 30px; text-align: center; font-size: 12px; color: #666;">
        <p style="margin: 5px 0;">
          <strong>${this.brandingConfig.companyName}</strong>
        </p>
        <p style="margin: 5px 0;">
          <a href="${this.brandingConfig.websiteUrl}" style="color: ${this.brandingConfig.primaryColor}; text-decoration: none;">
            Visit our website
          </a>
        </p>
        <p style="margin: 5px 0; font-size: 11px;">
          © ${new Date().getFullYear()} ${this.brandingConfig.companyName}. All rights reserved.
        </p>
        <p style="margin: 5px 0; font-size: 10px; color: #999;">
          This email was sent securely to protect your information.
        </p>
      </div>
    `;
  }

  /**
   * Wrap HTML content with branded header and footer
   */
  wrapWithBranding(htmlContent: string): string {
    const header = this.createBrandedHeader();
    const footer = this.createBrandedFooter();

    return `
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${this.brandingConfig.companyName}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #fff;">
        ${header}
        <div style="padding: 20px;">
          ${htmlContent}
        </div>
        ${footer}
      </body>
      </html>
    `;
  }

  /**
   * Create verification email template with branding
   */
  createVerificationEmailTemplate(verificationLink: string, recipientName?: string): BrandedEmailTemplate {
    const htmlContent = `
      <p>Hello${recipientName ? `, ${recipientName}` : ''},</p>
      <p>Thank you for signing up! Please verify your email address to get started.</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="${verificationLink}" style="background-color: ${this.brandingConfig.primaryColor}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
          Verify Email Address
        </a>
      </p>
      <p style="font-size: 12px; color: #666;">
        Or copy this link: <code style="background: #f0f0f0; padding: 5px 10px; border-radius: 3px;">${verificationLink}</code>
      </p>
      <p style="font-size: 12px; color: #999;">
        This link expires in 24 hours. If you didn't create this account, please ignore this email.
      </p>
    `;

    return {
      subject: `Verify Your Email - ${this.brandingConfig.companyName}`,
      htmlBody: this.wrapWithBranding(htmlContent),
      textBody: `Hello${recipientName ? `, ${recipientName}` : ''},\n\nPlease verify your email: ${verificationLink}\n\nThis link expires in 24 hours.`,
      companyName: this.brandingConfig.companyName,
      fromDomain: this.getCustomDomain(),
    };
  }

  /**
   * Create password reset email template with branding
   */
  createPasswordResetTemplate(resetLink: string, recipientName?: string): BrandedEmailTemplate {
    const htmlContent = `
      <p>Hello${recipientName ? `, ${recipientName}` : ''},</p>
      <p>We received a request to reset your password. Click the button below to create a new password.</p>
      <p style="text-align: center; margin: 30px 0;">
        <a href="${resetLink}" style="background-color: ${this.brandingConfig.accentColor}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
          Reset Password
        </a>
      </p>
      <p style="font-size: 12px; color: #666;">
        Or copy this link: <code style="background: #f0f0f0; padding: 5px 10px; border-radius: 3px;">${resetLink}</code>
      </p>
      <p style="font-size: 12px; color: #999;">
        This link expires in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
      </p>
    `;

    return {
      subject: `Reset Your Password - ${this.brandingConfig.companyName}`,
      htmlBody: this.wrapWithBranding(htmlContent),
      textBody: `Hello${recipientName ? `, ${recipientName}` : ''},\n\nReset your password: ${resetLink}\n\nThis link expires in 1 hour.`,
      companyName: this.brandingConfig.companyName,
      fromDomain: this.getCustomDomain(),
    };
  }

  /**
   * Reload branding configuration (for hot-reload support)
   */
  reloadConfig(): void {
    this.brandingConfig = this.loadBrandingConfig();
    logger.info('Branding configuration reloaded');
  }
}

// Export singleton instance
export const brandingService = new BrandingService();

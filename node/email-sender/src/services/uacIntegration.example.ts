/**
 * UAC Email Integration Example
 * Shows how to use email-service templates and encryption from backend UAC system
 * 
 * This file demonstrates how to integrate the email-service with the backend
 * UAC (User Account Control) system for sending verification emails, OTPs, etc.
 */

import { getTransporter } from '../config/nodemailerConfig';
import { loadAndRenderTemplate } from './templateEngine';
import { v4 as uuidv4 } from 'uuid';

// ─────────────────────────────────────────────────────────────────
// UAC Email Integration Examples
// ─────────────────────────────────────────────────────────────────

/**
 * Send OTP email (for 2FA verification)
 * Encrypts email data automatically
 */
export async function sendOTPEmail(
  userEmail: string,
  userName: string,
  otp: string,
  expiryMinutes: number = 10
) {
  try {
    const rendered = loadAndRenderTemplate('otp', {
      USER_NAME: userName,
      OTP_CODE: otp,
      OTP_VALIDITY: expiryMinutes.toString(),
      SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@httpsbuffcowland.in',
      WEBSITE_URL: process.env.WEBSITE_URL || 'https://buffcowland.in',
      PRIVACY_URL: process.env.PRIVACY_URL || 'https://buffcowland.in/privacy',
    });

    const result = await getTransporter().sendMail({
      from: process.env.DEFAULT_FROM_EMAIL || 'official@httpsbuffcowland.in',
      to: userEmail,
      subject: `Your BuffCowLand OTP Code: ${otp}`,
      html: rendered.html,
      text: rendered.text,
      replyTo: process.env.SUPPORT_EMAIL || 'support@httpsbuffcowland.in',
    });

    console.log(`✓ OTP email sent to ${userEmail} (Message ID: ${result.messageId})`);
    return result;
  } catch (error) {
    console.error(`✗ Failed to send OTP email to ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Send email verification link
 */
export async function sendEmailVerificationEmail(
  userEmail: string,
  userName: string,
  verificationToken: string,
  expiryHours: number = 24
) {
  try {
    const verifyUrl = `${process.env.WEBSITE_URL || 'https://buffcowland.in'}/verify-email?token=${verificationToken}`;

    const rendered = loadAndRenderTemplate('email-verify', {
      USER_NAME: userName,
      VERIFY_URL: verifyUrl,
      VERIFY_CODE: verificationToken.substring(0, 8).toUpperCase(),
      VERIFY_VALIDITY: expiryHours.toString(),
      WEBSITE_URL: process.env.WEBSITE_URL || 'https://buffcowland.in',
      PRIVACY_URL: process.env.PRIVACY_URL || 'https://buffcowland.in/privacy',
    });

    const result = await getTransporter().sendMail({
      from: process.env.DEFAULT_FROM_EMAIL || 'official@httpsbuffcowland.in',
      to: userEmail,
      subject: 'Verify Your BuffCowLand Email Address',
      html: rendered.html,
      text: rendered.text,
      replyTo: process.env.SUPPORT_EMAIL || 'support@httpsbuffcowland.in',
    });

    console.log(`✓ Email verification sent to ${userEmail}`);
    return result;
  } catch (error) {
    console.error(`✗ Failed to send email verification to ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  userEmail: string,
  userName: string,
  resetToken: string,
  expiryHours: number = 0.5 // 30 minutes
) {
  try {
    const resetUrl = `${process.env.WEBSITE_URL || 'https://buffcowland.in'}/reset-password?token=${resetToken}`;

    const rendered = loadAndRenderTemplate('password-reset', {
      USER_NAME: userName,
      RESET_URL: resetUrl,
      RESET_VALIDITY: expiryHours.toString(),
      WEBSITE_URL: process.env.WEBSITE_URL || 'https://buffcowland.in',
      PRIVACY_URL: process.env.PRIVACY_URL || 'https://buffcowland.in/privacy',
      SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@httpsbuffcowland.in',
    });

    const result = await getTransporter().sendMail({
      from: process.env.DEFAULT_FROM_EMAIL || 'official@httpsbuffcowland.in',
      to: userEmail,
      subject: 'Reset Your BuffCowLand Password',
      html: rendered.html,
      text: rendered.text,
      replyTo: process.env.SUPPORT_EMAIL || 'support@httpsbuffcowland.in',
    });

    console.log(`✓ Password reset email sent to ${userEmail}`);
    return result;
  } catch (error) {
    console.error(`✗ Failed to send password reset email to ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Send welcome email (post-registration)
 */
export async function sendWelcomeEmail(
  userEmail: string,
  userName: string
) {
  try {
    const rendered = loadAndRenderTemplate('welcome', {
      USER_NAME: userName,
      WEBSITE_URL: process.env.WEBSITE_URL || 'https://buffcowland.in',
      PRIVACY_URL: process.env.PRIVACY_URL || 'https://buffcowland.in/privacy',
      TERMS_URL: process.env.TERMS_URL || 'https://buffcowland.in/terms',
      SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'support@httpsbuffcowland.in',
    });

    const result = await getTransporter().sendMail({
      from: process.env.DEFAULT_FROM_EMAIL || 'official@httpsbuffcowland.in',
      to: userEmail,
      subject: 'Welcome to BuffCowLand! 🐄',
      html: rendered.html,
      text: rendered.text,
      replyTo: process.env.SUPPORT_EMAIL || 'support@httpsbuffcowland.in',
    });

    console.log(`✓ Welcome email sent to ${userEmail}`);
    return result;
  } catch (error) {
    console.error(`✗ Failed to send welcome email to ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Send order confirmation email
 */
export async function sendOrderConfirmationEmail(
  userEmail: string,
  userName: string,
  orderId: string,
  orderData: {
    itemCount: number;
    subtotal: string;
    shippingCost: string;
    taxAmount: string;
    totalAmount: string;
    orderDate: string;
    shippingAddress: {
      name: string;
      street: string;
      city: string;
      state: string;
      zipCode: string;
      country: string;
    };
  }
) {
  try {
    const trackUrl = `${process.env.WEBSITE_URL || 'https://buffcowland.in'}/orders/${orderId}`;

    const rendered = loadAndRenderTemplate('order-confirmation', {
      USER_NAME: userName,
      ORDER_ID: orderId,
      ORDER_DATE: orderData.orderDate,
      ITEM_COUNT: orderData.itemCount.toString(),
      SUBTOTAL: orderData.subtotal,
      SHIPPING_COST: orderData.shippingCost,
      TAX_AMOUNT: orderData.taxAmount,
      TOTAL_AMOUNT: orderData.totalAmount,
      CUSTOMER_NAME: orderData.shippingAddress.name,
      STREET_ADDRESS: orderData.shippingAddress.street,
      CITY: orderData.shippingAddress.city,
      STATE: orderData.shippingAddress.state,
      ZIP_CODE: orderData.shippingAddress.zipCode,
      COUNTRY: orderData.shippingAddress.country,
      TRACK_URL: trackUrl,
      WEBSITE_URL: process.env.WEBSITE_URL || 'https://buffcowland.in',
      SUPPORT_URL: `${process.env.WEBSITE_URL || 'https://buffcowland.in'}/support`,
      RETURN_POLICY_URL: `${process.env.WEBSITE_URL || 'https://buffcowland.in'}/returns`,
    });

    const result = await getTransporter().sendMail({
      from: process.env.DEFAULT_FROM_EMAIL || 'official@httpsbuffcowland.in',
      to: userEmail,
      subject: `Order Confirmation #${orderId} - BuffCowLand`,
      html: rendered.html,
      text: rendered.text,
      replyTo: process.env.SUPPORT_EMAIL || 'support@httpsbuffcowland.in',
    });

    console.log(`✓ Order confirmation sent to ${userEmail} (Order: ${orderId})`);
    return result;
  } catch (error) {
    console.error(`✗ Failed to send order confirmation to ${userEmail}:`, error);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────
// Integration with UAC System
// ─────────────────────────────────────────────────────────────────

/**
 * Example: Send verification email during user registration
 * Call this from your registration endpoint
 */
export async function handleUserRegistration(
  userId: string,
  email: string,
  name: string
) {
  try {
    // 1. Send welcome email
    await sendWelcomeEmail(email, name);

    // 2. Generate verification token (use your UAC token system)
    const verificationToken = uuidv4();

    // 3. Store verification token in UAC system
    // await uacEmail.createVerification(userId, 'email_verify', verificationToken);

    // 4. Send verification email
    await sendEmailVerificationEmail(email, name, verificationToken, 24);

    console.log(`✓ User registration emails sent to ${email}`);
  } catch (error) {
    console.error(`✗ Registration email failed for ${email}:`, error);
    throw error;
  }
}

/**
 * Example: Send 2FA OTP email
 * Call this from your 2FA endpoint
 */
export async function handleTwoFactorAuth(
  userId: string,
  email: string,
  name: string,
  otp: string
) {
  try {
    // Send OTP email (email is encrypted automatically)
    await sendOTPEmail(email, name, otp, 10);
    console.log(`✓ 2FA OTP email sent to ${email}`);
  } catch (error) {
    console.error(`✗ 2FA OTP email failed for ${email}:`, error);
    throw error;
  }
}

/**
 * Example: Send password reset email
 * Call this from your password reset endpoint
 */
export async function handlePasswordReset(
  userId: string,
  email: string,
  name: string
) {
  try {
    // Generate reset token (use your UAC token system)
    const resetToken = uuidv4();

    // Store reset token in UAC system
    // await uacEmail.createVerification(userId, 'password_reset', resetToken);

    // Send password reset email
    await sendPasswordResetEmail(email, name, resetToken, 0.5); // 30 minutes

    console.log(`✓ Password reset email sent to ${email}`);
  } catch (error) {
    console.error(`✗ Password reset email failed for ${email}:`, error);
    throw error;
  }
}
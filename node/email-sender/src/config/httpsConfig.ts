/**
 * HTTPS/TLS Configuration
 * Enables secure connections for the Express API server
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { getGlobalLogger } from '../logger';
const logger = getGlobalLogger();

export interface TLSConfig {
  enabled: boolean;
  certPath: string;
  keyPath: string;
  port: number;
  rejectUnauthorized?: boolean;
  minTLSVersion?: string;
}

export interface CertificateInfo {
  valid: boolean;
  issuer?: string;
  subject?: string;
  notBefore?: string;
  notAfter?: string;
  expiryDays?: number;
  isExpired?: boolean;
  error?: string;
}

/**
 * Load TLS configuration from environment
 */
export function loadTLSConfig(): TLSConfig {
  return {
    enabled: process.env.TLS_ENABLED === 'true' || process.env.HTTPS_ENABLED === 'true',
    certPath: process.env.TLS_CERT_PATH || process.env.SSL_CERT_PATH || './certs/server.crt',
    keyPath: process.env.TLS_KEY_PATH || process.env.SSL_KEY_PATH || './certs/server.key',
    port: parseInt(process.env.TLS_PORT || process.env.HTTPS_PORT || '3443', 10),
    rejectUnauthorized: process.env.TLS_REJECT_UNAUTHORIZED !== 'false',
    minTLSVersion: process.env.TLS_MIN_VERSION || 'TLSv1.2',
  };
}

/**
 * Validate TLS certificates exist
 */
export function validateCertificates(config: TLSConfig): boolean {
  if (!config.enabled) {
    return true;
  }

  const certExists = fs.existsSync(config.certPath);
  const keyExists = fs.existsSync(config.keyPath);

  if (!certExists) {
    logger.error(`✗ TLS Certificate not found at: ${config.certPath}`);
  }
  if (!keyExists) {
    logger.error(`✗ TLS Private Key not found at: ${config.keyPath}`);
  }

  if (certExists && keyExists) {
    logger.info(`✓ TLS certificates found at:`);
    logger.info(`  Certificate: ${config.certPath}`);
    logger.info(`  Private Key: ${config.keyPath}`);
    return true;
  }

  return false;
}

/**
 * Create HTTPS server with TLS configuration
 */
export function createHTTPSServer(
  app: any,
  config: TLSConfig
): https.Server | null {
  if (!config.enabled) {
    logger.info('TLS/HTTPS disabled (set TLS_ENABLED=true to enable)');
    return null;
  }

  if (!validateCertificates(config)) {
    logger.error('TLS/HTTPS certificates missing. Server will run on HTTP only.');
    logger.info('To enable HTTPS, provide certificate files or set TLS_ENABLED=false');
    return null;
  }

  try {
    const cert = fs.readFileSync(config.certPath, 'utf-8');
    const key = fs.readFileSync(config.keyPath, 'utf-8');

    const httpsOptions: https.ServerOptions = {
      cert,
      key,
      minVersion: config.minTLSVersion as any,
      rejectUnauthorized: config.rejectUnauthorized ?? true,
      // Modern TLS security settings
      ciphers: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
        'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
        'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
        'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305',
        'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305',
        'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
        'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
      ].join(':'),
      honorCipherOrder: true,
      ecdhCurve: 'auto',
    };

    const httpsServer = https.createServer(httpsOptions, app);
    logger.info('✓ HTTPS/TLS configured successfully');
    logger.info(`  TLS Version: ${config.minTLSVersion}`);
    logger.info(`  Server will listen on port ${config.port}`);

    return httpsServer;
  } catch (error) {
    logger.error('Failed to create HTTPS server:', error);
    return null;
  }
}

/**
 * Parse certificate information (requires openssl)
 */
export function getCertificateInfo(certPath: string): CertificateInfo {
  try {
    if (!fs.existsSync(certPath)) {
      return {
        valid: false,
        error: `Certificate not found at ${certPath}`,
      };
    }

    // For simplicity, we'll just check the file exists
    // In production, use node-openssl or similar package for full parsing
    const stats = fs.statSync(certPath);

    return {
      valid: true,
      subject: 'Certificate info available via openssl or node-x509 package',
      notBefore: 'Use openssl x509 -noout -dates -in ' + certPath,
    };
  } catch (error) {
    return {
      valid: false,
      error: String(error),
    };
  }
}

/**
 * Generate self-signed certificate (for development only)
 */
export function generateSelfSignedCert(
  certPath: string,
  keyPath: string,
  days: number = 365
): boolean {
  const { execSync } = require('child_process');

  try {
    // Create certs directory if it doesn't exist
    const certDir = path.dirname(certPath);
    if (!fs.existsSync(certDir)) {
      fs.mkdirSync(certDir, { recursive: true });
    }

    // Check if certificates already exist
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      logger.info('Self-signed certificates already exist');
      return true;
    }

    logger.info('Generating self-signed certificate...');
    logger.warn('⚠️  WARNING: Self-signed certificates are for development only!');

    // Generate self-signed certificate
    const command = `openssl req -x509 -newkey rsa:2048 -nodes -out "${certPath}" -keyout "${keyPath}" -days ${days} -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"`;

    execSync(command);

    logger.info('✓ Self-signed certificate generated at:');
    logger.info(`  Certificate: ${certPath}`);
    logger.info(`  Private Key: ${keyPath}`);

    return true;
  } catch (error) {
    logger.error('Failed to generate self-signed certificate:', error);
    logger.info('To generate manually, run:');
    logger.info(`  openssl req -x509 -newkey rsa:2048 -nodes -out ${certPath} -keyout ${keyPath} -days 365`);
    return false;
  }
}

/**
 * Check if TLS is properly configured
 */
export function isTLSConfigured(): boolean {
  const config = loadTLSConfig();
  return config.enabled && validateCertificates(config);
}

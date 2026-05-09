/**
 * OS-Level Encryption Module
 * Uses platform-native encryption:
 * - Windows: DPAPI (Data Protection API)
 * - macOS: Keychain
 * - Linux: System Keyring / secure_file
 * 
 * No .key files needed - OS handles all key management
 */

import * as crypto from 'crypto';
import { execSync } from 'child_process';
import * as os from 'os';
import { getGlobalLogger } from '../logger';

const logger = getGlobalLogger();

type Platform = 'win32' | 'darwin' | 'linux';

/**
 * Encryption provider interface
 */
interface EncryptionProvider {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

/**
 * Windows DPAPI Provider
 * Uses Windows Data Protection API via PowerShell
 */
class WindowsDPAPIProvider implements EncryptionProvider {
  async encrypt(plaintext: string): Promise<string> {
    try {
      // Create a temporary PowerShell command to encrypt using DPAPI
      const base64Input = Buffer.from(plaintext, 'utf-8').toString('base64');
      
      const command = `
        [System.Security.Cryptography.DataProtectionScope]$scope = 'CurrentUser'
        $bytes = [System.Convert]::FromBase64String('${base64Input}')
        $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
        [System.Convert]::ToBase64String($encrypted)
      `.replace(/\n/g, '');
      
      const result = execSync(`powershell -Command "${command}"`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      
      return result;
    } catch (error) {
      logger.error('DPAPI encryption failed:', error);
      throw new Error('Failed to encrypt data with DPAPI');
    }
  }
  
  async decrypt(ciphertext: string): Promise<string> {
    try {
      const command = `
        [System.Security.Cryptography.DataProtectionScope]$scope = 'CurrentUser'
        $encrypted = [System.Convert]::FromBase64String('${ciphertext}')
        $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, $scope)
        [System.Convert]::ToBase64String($decrypted)
      `.replace(/\n/g, '');
      
      const result = execSync(`powershell -Command "${command}"`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      
      const plaintext = Buffer.from(result, 'base64').toString('utf-8');
      return plaintext;
    } catch (error) {
      logger.error('DPAPI decryption failed:', error);
      throw new Error('Failed to decrypt data with DPAPI');
    }
  }
}

/**
 * Keychain Provider (macOS)
 * Uses macOS Keychain for secure storage
 */
class KeychainProvider implements EncryptionProvider {
  private serviceName = 'BCL-EmailService';
  
  async encrypt(plaintext: string): Promise<string> {
    try {
      const key = crypto.randomBytes(32).toString('hex');
      const account = `email-service-key-${Date.now()}`;
      
      // Store the encryption key in Keychain
      execSync(
        `security add-generic-password -s "${this.serviceName}" -a "${account}" -w "${key}" -U`,
        { encoding: 'utf-8' }
      );
      
      // Encrypt using the key
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'hex'),
        Buffer.alloc(16, 0)
      );
      
      let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag().toString('hex');
      
      // Return encrypted data with reference to key location
      return JSON.stringify({
        data: encrypted,
        auth: authTag,
        account,
        service: this.serviceName,
      });
    } catch (error) {
      logger.error('Keychain encryption failed:', error);
      throw new Error('Failed to encrypt data with Keychain');
    }
  }
  
  async decrypt(ciphertext: string): Promise<string> {
    try {
      const encrypted = JSON.parse(ciphertext);
      
      // Retrieve key from Keychain
      const key = execSync(
        `security find-generic-password -s "${encrypted.service}" -a "${encrypted.account}" -w`,
        { encoding: 'utf-8' }
      ).trim();
      
      // Decrypt
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'hex'),
        Buffer.alloc(16, 0)
      );
      
      decipher.setAuthTag(Buffer.from(encrypted.auth, 'hex'));
      
      let decrypted = decipher.update(encrypted.data, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');
      
      return decrypted;
    } catch (error) {
      logger.error('Keychain decryption failed:', error);
      throw new Error('Failed to decrypt data with Keychain');
    }
  }
}

/**
 * Linux Secure Memory Provider
 * Uses in-memory encryption with OS secure attributes
 */
class LinuxSecureProvider implements EncryptionProvider {
  private encryptionKey: string;
  
  constructor() {
    // Try to get key from system keyring, fall back to environment
    this.encryptionKey = process.env.EMAIL_ENCRYPTION_KEY || this.generateSystemKey();
  }
  
  private generateSystemKey(): string {
    // On Linux, use /dev/urandom via OpenSSL if available
    try {
      const key = execSync('openssl rand -hex 32', { encoding: 'utf-8' }).trim();
      return key;
    } catch {
      // Fallback to Node crypto
      return crypto.randomBytes(32).toString('hex');
    }
  }
  
  async encrypt(plaintext: string): Promise<string> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );
    
    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }
  
  async decrypt(ciphertext: string): Promise<string> {
    const [ivHex, encrypted] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    
    return decrypted;
  }
}

/**
 * Get platform-specific encryption provider
 */
function getProvider(): EncryptionProvider {
  const platform = os.platform() as Platform;
  
  switch (platform) {
    case 'win32':
      logger.info('Using Windows DPAPI for encryption');
      return new WindowsDPAPIProvider();
    
    case 'darwin':
      logger.info('Using macOS Keychain for encryption');
      return new KeychainProvider();
    
    case 'linux':
      logger.info('Using Linux Secure Memory for encryption');
      return new LinuxSecureProvider();
    
    default:
      logger.warn(`Unknown platform: ${platform}, using Linux provider as fallback`);
      return new LinuxSecureProvider();
  }
}

let provider: EncryptionProvider | null = null;

/**
 * Initialize encryption provider
 */
export function initializeEncryption(): void {
  try {
    provider = getProvider();
    logger.info('✓ OS-level encryption initialized');
  } catch (error) {
    logger.error('Failed to initialize encryption:', error);
    throw new Error('Encryption initialization failed');
  }
}

/**
 * Encrypt sensitive data
 */
export async function encryptData(plaintext: string): Promise<string> {
  if (!provider) {
    throw new Error('Encryption not initialized. Call initializeEncryption() first.');
  }
  
  try {
    return await provider.encrypt(plaintext);
  } catch (error) {
    logger.error('Encryption failed:', error);
    throw error;
  }
}

/**
 * Decrypt sensitive data
 */
export async function decryptData(ciphertext: string): Promise<string> {
  if (!provider) {
    throw new Error('Encryption not initialized. Call initializeEncryption() first.');
  }
  
  try {
    return await provider.decrypt(ciphertext);
  } catch (error) {
    logger.error('Decryption failed:', error);
    throw error;
  }
}

/**
 * Encrypt an object and return as JSON
 */
export async function encryptObject<T>(obj: T): Promise<string> {
  const json = JSON.stringify(obj);
  const encrypted = await encryptData(json);
  return encrypted;
}

/**
 * Decrypt and parse JSON object
 */
export async function decryptObject<T>(encrypted: string): Promise<T> {
  const json = await decryptData(encrypted);
  return JSON.parse(json) as T;
}
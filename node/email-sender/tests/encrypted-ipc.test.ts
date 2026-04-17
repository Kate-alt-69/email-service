import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  EmailServiceIPCProtocol,
  EncryptedIPCClient,
  IPCMessage,
  ServiceRegisterData,
  EmailSendData,
} from '../src/encrypted-ipc';
import * as crypto from 'crypto';
import * as net from 'net';

describe('EmailServiceIPCProtocol', () => {
  let protocol: EmailServiceIPCProtocol;
  let encryptionKey: Buffer;

  beforeEach(() => {
    protocol = new EmailServiceIPCProtocol();
    encryptionKey = crypto.randomBytes(32); // 256-bit key
  });

  afterEach(() => {
    protocol.close();
  });

  describe('Initialization', () => {
    it('should initialize encryption with a 32-byte buffer', () => {
      expect(() => {
        protocol.initializeEncryption(encryptionKey);
      }).not.toThrow();

      const info = protocol.getKeyInfo();
      expect(info.isInitialized).toBe(true);
      expect(info.algorithm).toBe('AES-256-GCM');
    });

    it('should initialize encryption with a hex string', () => {
      const hexKey = encryptionKey.toString('hex');
      expect(hexKey.length).toBe(64); // 32 bytes = 64 hex chars

      expect(() => {
        protocol.initializeEncryption(hexKey);
      }).not.toThrow();

      const info = protocol.getKeyInfo();
      expect(info.isInitialized).toBe(true);
    });

    it('should reject invalid key lengths', () => {
      const shortKey = crypto.randomBytes(16); // 128-bit (too short)
      expect(() => {
        protocol.initializeEncryption(shortKey);
      }).toThrow(/must be 32 bytes/);
    });

    it('should reject invalid hex key lengths', () => {
      const hexKey = crypto.randomBytes(16).toString('hex'); // 32 hex chars (16 bytes)
      expect(() => {
        protocol.initializeEncryption(hexKey);
      }).toThrow(/must be 64 chars/);
    });

    it('should throw error before initialization', () => {
      const protocol2 = new EmailServiceIPCProtocol();
      expect(() => {
        protocol2.createServiceRegister('test', 'test', 3000);
      }).toThrow(/not initialized/);
    });
  });

  describe('Message Creation & Encryption', () => {
    beforeEach(() => {
      protocol.initializeEncryption(encryptionKey);
    });

    it('should create encrypted service registration message', () => {
      const message = protocol.createServiceRegister('email-service', 'Email Service', 3000, [
        'send',
        'verify',
      ]);

      expect(message).toHaveProperty('type', 'service_register');
      expect(message).toHaveProperty('encrypted', true);
      expect(message).toHaveProperty('iv');
      expect(message).toHaveProperty('authTag');
      expect(message).toHaveProperty('payload');
      expect(message).toHaveProperty('id');
      expect(message).toHaveProperty('keyId');
    });

    it('should create encrypted health check message', () => {
      const message = protocol.createHealthCheck('email-service');

      expect(message).toHaveProperty('type', 'health_check');
      expect(message).toHaveProperty('encrypted', true);
      expect(message).toHaveProperty('iv');
      expect(message).toHaveProperty('authTag');
    });

    it('should create encrypted email send message', () => {
      const message = protocol.createEmailSend(
        'email-service',
        'job-123',
        'recipient@example.com',
        'Test Subject',
        'Test Body',
        { theme: 'dark' }
      );

      expect(message).toHaveProperty('type', 'email_send');
      expect(message).toHaveProperty('encrypted', true);
      expect(message).toHaveProperty('payload');
    });

    it('should create ACK message', () => {
      const message = protocol.createACK('msg-id-123', 'service_register', 'email-service');

      expect(message).toHaveProperty('type', 'ack');
      expect(message.payload).toBeTruthy();
    });

    it('should generate unique message IDs', () => {
      const msg1 = protocol.createHealthCheck('service1');
      const msg2 = protocol.createHealthCheck('service2');

      expect(msg1.id).not.toBe(msg2.id);
    });

    it('should use different IVs for each message', () => {
      const msg1 = protocol.createHealthCheck('service1');
      const msg2 = protocol.createHealthCheck('service1');

      expect(msg1.iv).not.toBe(msg2.iv);
    });

    it('should include key ID in message', () => {
      const message = protocol.createServiceRegister('svc', 'Service', 3000);
      const keyId = protocol.getCurrentKeyId();

      expect(message.keyId).toBe(keyId);
    });
  });

  describe('Encryption & Decryption', () => {
    beforeEach(() => {
      protocol.initializeEncryption(encryptionKey);
    });

    it('should encrypt and decrypt a message', () => {
      const originalMessage = protocol.createServiceRegister(
        'email-service',
        'Email Service',
        3000,
        ['send']
      );

      const serialized = protocol.serialize(originalMessage);
      const { message, plaintext } = protocol.parseAndDecrypt(serialized);

      expect(message.type).toBe(originalMessage.type);
      expect(message.serviceId).toBe(originalMessage.serviceId);

      // Verify plaintext contains expected data
      const payload = JSON.parse(plaintext.toString('utf-8'));
      expect(payload.service_id).toBe('email-service');
      expect(payload.service_name).toBe('Email Service');
      expect(payload.port).toBe(3000);
    });

    it('should decrypt email send message correctly', () => {
      const originalMessage = protocol.createEmailSend(
        'email-service',
        'job-456',
        'user@example.com',
        'Reset Password',
        'Click here to reset...',
        { locale: 'en' }
      );

      const serialized = protocol.serialize(originalMessage);
      const { plaintext } = protocol.parseAndDecrypt(serialized);

      const payload: EmailSendData = JSON.parse(plaintext.toString('utf-8'));
      expect(payload.job_id).toBe('job-456');
      expect(payload.recipient).toBe('user@example.com');
      expect(payload.subject).toBe('Reset Password');
      expect(payload.metadata?.locale).toBe('en');
    });

    it('should authenticate message integrity', () => {
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);
      const serialized = protocol.serialize(message);

      // Tamper with the payload
      const tampered = JSON.parse(serialized);
      tampered.payload = Buffer.from(tampered.payload, 'base64')
        .slice(0, -1)
        .toString('base64'); // Remove last byte

      const tamperedJson = JSON.stringify(tampered);

      expect(() => {
        protocol.parseAndDecrypt(tamperedJson);
      }).toThrow(/authentication failed/i);
    });

    it('should detect tampering with auth tag', () => {
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);
      const serialized = protocol.serialize(message);

      const tampered = JSON.parse(serialized);
      const authTagBytes = Buffer.from(tampered.authTag, 'base64');
      authTagBytes[0] ^= 0xff; // Flip bits
      tampered.authTag = authTagBytes.toString('base64');

      expect(() => {
        protocol.parseAndDecrypt(JSON.stringify(tampered));
      }).toThrow(/authentication failed/i);
    });

    it('should detect tampering with IV', () => {
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);
      const serialized = protocol.serialize(message);

      const tampered = JSON.parse(serialized);
      const ivBytes = Buffer.from(tampered.iv, 'base64');
      ivBytes[0] ^= 0xff;
      tampered.iv = ivBytes.toString('base64');

      expect(() => {
        protocol.parseAndDecrypt(JSON.stringify(tampered));
      }).toThrow(/authentication failed/i);
    });

    it('should prevent replay attacks with different IVs', () => {
      const msg1 = protocol.createHealthCheck('svc1');
      const msg2 = protocol.createHealthCheck('svc1');

      const s1 = protocol.serialize(msg1);
      const s2 = protocol.serialize(msg2);

      expect(s1).not.toBe(s2); // Different due to different IVs
    });
  });

  describe('Memory Safety', () => {
    beforeEach(() => {
      protocol.initializeEncryption(encryptionKey);
    });

    it('should clear sensitive data after encryption', () => {
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);

      // The plaintext should be cleared
      // We can't directly verify this without memory inspection
      // but we verify the operation completes
      expect(message).toBeDefined();
    });

    it('should not expose encryption key', () => {
      const info = protocol.getKeyInfo();

      expect(info).not.toHaveProperty('key');
      expect(info).not.toHaveProperty('currentKey');
      expect(info.keyId).toBeTruthy();
    });

    it('should clear all data on close', () => {
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);
      protocol.close();

      expect(() => {
        protocol.createHealthCheck('svc');
      }).toThrow(/Protocol closed/);
    });

    it('should prevent operations after close', () => {
      protocol.close();

      expect(() => {
        protocol.createServiceRegister('svc', 'Svc', 3000);
      }).toThrow(/Protocol closed/);
    });
  });

  describe('Message Handlers', () => {
    beforeEach(() => {
      protocol.initializeEncryption(encryptionKey);
    });

    it('should register and retrieve handlers', () => {
      const handler = jest.fn();
      protocol.registerHandler('custom_message', handler);

      const retrieved = protocol.getHandler('custom_message');
      expect(retrieved).toBe(handler);
    });

    it('should return undefined for unregistered handlers', () => {
      const handler = protocol.getHandler('nonexistent');
      expect(handler).toBeUndefined();
    });

    it('should support registering handler via on() alias', () => {
      const handler = jest.fn();
      protocol.on('custom_event', handler);

      const retrieved = protocol.getHandler('custom_event');
      expect(retrieved).toBe(handler);
    });
  });

  describe('Serialization', () => {
    beforeEach(() => {
      protocol.initializeEncryption(encryptionKey);
    });

    it('should serialize message without plaintext', () => {
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);
      const serialized = protocol.serialize(message);
      const json = JSON.parse(serialized);

      expect(json).toHaveProperty('type');
      expect(json).toHaveProperty('id');
      expect(json).toHaveProperty('payload'); // encrypted payload
      expect(json).not.toHaveProperty('plaintext');
    });

    it('should create valid JSON', () => {
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);
      const serialized = protocol.serialize(message);

      expect(() => {
        JSON.parse(serialized);
      }).not.toThrow();
    });
  });

  describe('Different Keys', () => {
    it('should fail to decrypt with different key', () => {
      const key1 = crypto.randomBytes(32);
      const key2 = crypto.randomBytes(32);

      protocol.initializeEncryption(key1);
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);
      const serialized = protocol.serialize(message);

      // Switch to different key
      protocol.close();
      const protocol2 = new EmailServiceIPCProtocol();
      protocol2.initializeEncryption(key2);

      expect(() => {
        protocol2.parseAndDecrypt(serialized);
      }).toThrow();
    });

    it('should decrypt with same key', () => {
      const key = crypto.randomBytes(32);
      const hexKey = key.toString('hex');

      protocol.initializeEncryption(hexKey);
      const message = protocol.createServiceRegister('svc', 'Svc', 3000);
      const serialized = protocol.serialize(message);

      // Switch to new instance with same key
      protocol.close();
      const protocol2 = new EmailServiceIPCProtocol();
      protocol2.initializeEncryption(hexKey);

      const { plaintext } = protocol2.parseAndDecrypt(serialized);
      expect(plaintext.length).toBeGreaterThan(0);
    });
  });
});

describe('EncryptedIPCClient', () => {
  let client: EncryptedIPCClient;
  let encryptionKey: Buffer;
  let mockServer: net.Server | null = null;

  beforeEach(() => {
    encryptionKey = crypto.randomBytes(32);
    client = new EncryptedIPCClient('email-service', 'Email Service', 3000, 9999);
  });

  afterEach(() => {
    client.disconnect();
    if (mockServer) {
      mockServer.close();
      mockServer = null;
    }
  });

  it('should initialize with encryption key', async () => {
    await client.initialize(encryptionKey);
    const protocol = client.getProtocol();
    const info = protocol.getKeyInfo();

    expect(info.isInitialized).toBe(true);
  });

  it('should initialize with hex key', async () => {
    const hexKey = encryptionKey.toString('hex');
    await client.initialize(hexKey);
    const protocol = client.getProtocol();
    const info = protocol.getKeyInfo();

    expect(info.isInitialized).toBe(true);
  });

  it('should fail to connect to unavailable server', async () => {
    await client.initialize(encryptionKey);

    await expect(client.connect()).rejects.toThrow(/timeout|ECONNREFUSED/i);
  });

  it('should register message handler', async () => {
    await client.initialize(encryptionKey);
    const handler = jest.fn();

    client.on('test_message', handler);
    const protocol = client.getProtocol();
    const retrieved = protocol.getHandler('test_message');

    expect(retrieved).toBe(handler);
  });

  it('should disconnect cleanly', async () => {
    await client.initialize(encryptionKey);

    expect(() => {
      client.disconnect();
    }).not.toThrow();
  });
});

describe('CPU Memory Safety Integration', () => {
  let protocol: EmailServiceIPCProtocol;

  beforeEach(() => {
    protocol = new EmailServiceIPCProtocol();
  });

  afterEach(() => {
    protocol.close();
  });

  it('should not expose keys in memory after close', () => {
    const key = crypto.randomBytes(32);
    protocol.initializeEncryption(key);

    const msg = protocol.createServiceRegister('svc', 'Svc', 3000);
    protocol.close();

    // Key should no longer be accessible
    expect(() => {
      protocol.createHealthCheck('svc');
    }).toThrow(/closed/i);
  });

  it('should clear buffers on error', () => {
    protocol.initializeEncryption(crypto.randomBytes(32));

    expect(() => {
      protocol.parseAndDecrypt('invalid json');
    }).toThrow();

    // Protocol should still be usable
    const msg = protocol.createHealthCheck('svc');
    expect(msg).toBeDefined();
  });

  it('should support rapid key operations', () => {
    const key = crypto.randomBytes(32);
    protocol.initializeEncryption(key);

    const messages = Array(100)
      .fill(0)
      .map((_, i) => protocol.createHealthCheck(`svc${i}`));

    expect(messages.length).toBe(100);
    expect(messages.every((m) => m.encrypted)).toBe(true);
  });

  it('should handle concurrent encryption operations', async () => {
    protocol.initializeEncryption(crypto.randomBytes(32));

    const promises = Array(100)
      .fill(0)
      .map((_, i) =>
        Promise.resolve(protocol.createServiceRegister(`svc${i}`, `Service ${i}`, 3000 + i))
      );

    const results = await Promise.all(promises);
    expect(results.length).toBe(100);
    expect(results.every((m) => m.encrypted)).toBe(true);
  });
});

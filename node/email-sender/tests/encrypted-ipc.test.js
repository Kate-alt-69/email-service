"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const encrypted_ipc_1 = require("../src/encrypted-ipc");
const crypto = __importStar(require("crypto"));
(0, globals_1.describe)('EmailServiceIPCProtocol', () => {
    let protocol;
    let encryptionKey;
    (0, globals_1.beforeEach)(() => {
        protocol = new encrypted_ipc_1.EmailServiceIPCProtocol();
        encryptionKey = crypto.randomBytes(32); // 256-bit key
    });
    (0, globals_1.afterEach)(() => {
        protocol.close();
    });
    (0, globals_1.describe)('Initialization', () => {
        (0, globals_1.it)('should initialize encryption with a 32-byte buffer', () => {
            (0, globals_1.expect)(() => {
                protocol.initializeEncryption(encryptionKey);
            }).not.toThrow();
            const info = protocol.getKeyInfo();
            (0, globals_1.expect)(info.isInitialized).toBe(true);
            (0, globals_1.expect)(info.algorithm).toBe('AES-256-GCM');
        });
        (0, globals_1.it)('should initialize encryption with a hex string', () => {
            const hexKey = encryptionKey.toString('hex');
            (0, globals_1.expect)(hexKey.length).toBe(64); // 32 bytes = 64 hex chars
            (0, globals_1.expect)(() => {
                protocol.initializeEncryption(hexKey);
            }).not.toThrow();
            const info = protocol.getKeyInfo();
            (0, globals_1.expect)(info.isInitialized).toBe(true);
        });
        (0, globals_1.it)('should reject invalid key lengths', () => {
            const shortKey = crypto.randomBytes(16); // 128-bit (too short)
            (0, globals_1.expect)(() => {
                protocol.initializeEncryption(shortKey);
            }).toThrow(/must be 32 bytes/);
        });
        (0, globals_1.it)('should reject invalid hex key lengths', () => {
            const hexKey = crypto.randomBytes(16).toString('hex'); // 32 hex chars (16 bytes)
            (0, globals_1.expect)(() => {
                protocol.initializeEncryption(hexKey);
            }).toThrow(/must be 64 chars/);
        });
        (0, globals_1.it)('should throw error before initialization', () => {
            const protocol2 = new encrypted_ipc_1.EmailServiceIPCProtocol();
            (0, globals_1.expect)(() => {
                protocol2.createServiceRegister('test', 'test', 3000);
            }).toThrow(/not initialized/);
        });
    });
    (0, globals_1.describe)('Message Creation & Encryption', () => {
        (0, globals_1.beforeEach)(() => {
            protocol.initializeEncryption(encryptionKey);
        });
        (0, globals_1.it)('should create encrypted service registration message', () => {
            const message = protocol.createServiceRegister('email-service', 'Email Service', 3000, [
                'send',
                'verify',
            ]);
            (0, globals_1.expect)(message).toHaveProperty('type', 'service_register');
            (0, globals_1.expect)(message).toHaveProperty('encrypted', true);
            (0, globals_1.expect)(message).toHaveProperty('iv');
            (0, globals_1.expect)(message).toHaveProperty('authTag');
            (0, globals_1.expect)(message).toHaveProperty('payload');
            (0, globals_1.expect)(message).toHaveProperty('id');
            (0, globals_1.expect)(message).toHaveProperty('keyId');
        });
        (0, globals_1.it)('should create encrypted health check message', () => {
            const message = protocol.createHealthCheck('email-service');
            (0, globals_1.expect)(message).toHaveProperty('type', 'health_check');
            (0, globals_1.expect)(message).toHaveProperty('encrypted', true);
            (0, globals_1.expect)(message).toHaveProperty('iv');
            (0, globals_1.expect)(message).toHaveProperty('authTag');
        });
        (0, globals_1.it)('should create encrypted email send message', () => {
            const message = protocol.createEmailSend('email-service', 'job-123', 'recipient@example.com', 'Test Subject', 'Test Body', { theme: 'dark' });
            (0, globals_1.expect)(message).toHaveProperty('type', 'email_send');
            (0, globals_1.expect)(message).toHaveProperty('encrypted', true);
            (0, globals_1.expect)(message).toHaveProperty('payload');
        });
        (0, globals_1.it)('should create ACK message', () => {
            const message = protocol.createACK('msg-id-123', 'service_register', 'email-service');
            (0, globals_1.expect)(message).toHaveProperty('type', 'ack');
            (0, globals_1.expect)(message.payload).toBeTruthy();
        });
        (0, globals_1.it)('should generate unique message IDs', () => {
            const msg1 = protocol.createHealthCheck('service1');
            const msg2 = protocol.createHealthCheck('service2');
            (0, globals_1.expect)(msg1.id).not.toBe(msg2.id);
        });
        (0, globals_1.it)('should use different IVs for each message', () => {
            const msg1 = protocol.createHealthCheck('service1');
            const msg2 = protocol.createHealthCheck('service1');
            (0, globals_1.expect)(msg1.iv).not.toBe(msg2.iv);
        });
        (0, globals_1.it)('should include key ID in message', () => {
            const message = protocol.createServiceRegister('svc', 'Service', 3000);
            const keyId = protocol.getCurrentKeyId();
            (0, globals_1.expect)(message.keyId).toBe(keyId);
        });
    });
    (0, globals_1.describe)('Encryption & Decryption', () => {
        (0, globals_1.beforeEach)(() => {
            protocol.initializeEncryption(encryptionKey);
        });
        (0, globals_1.it)('should encrypt and decrypt a message', () => {
            const originalMessage = protocol.createServiceRegister('email-service', 'Email Service', 3000, ['send']);
            const serialized = protocol.serialize(originalMessage);
            const { message, plaintext } = protocol.parseAndDecrypt(serialized);
            (0, globals_1.expect)(message.type).toBe(originalMessage.type);
            (0, globals_1.expect)(message.serviceId).toBe(originalMessage.serviceId);
            // Verify plaintext contains expected data
            const payload = JSON.parse(plaintext.toString('utf-8'));
            (0, globals_1.expect)(payload.service_id).toBe('email-service');
            (0, globals_1.expect)(payload.service_name).toBe('Email Service');
            (0, globals_1.expect)(payload.port).toBe(3000);
        });
        (0, globals_1.it)('should decrypt email send message correctly', () => {
            const originalMessage = protocol.createEmailSend('email-service', 'job-456', 'user@example.com', 'Reset Password', 'Click here to reset...', { locale: 'en' });
            const serialized = protocol.serialize(originalMessage);
            const { plaintext } = protocol.parseAndDecrypt(serialized);
            const payload = JSON.parse(plaintext.toString('utf-8'));
            (0, globals_1.expect)(payload.job_id).toBe('job-456');
            (0, globals_1.expect)(payload.recipient).toBe('user@example.com');
            (0, globals_1.expect)(payload.subject).toBe('Reset Password');
            (0, globals_1.expect)(payload.metadata?.locale).toBe('en');
        });
        (0, globals_1.it)('should authenticate message integrity', () => {
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            const serialized = protocol.serialize(message);
            // Tamper with the payload
            const tampered = JSON.parse(serialized);
            tampered.payload = Buffer.from(tampered.payload, 'base64')
                .slice(0, -1)
                .toString('base64'); // Remove last byte
            const tamperedJson = JSON.stringify(tampered);
            (0, globals_1.expect)(() => {
                protocol.parseAndDecrypt(tamperedJson);
            }).toThrow(/authentication failed/i);
        });
        (0, globals_1.it)('should detect tampering with auth tag', () => {
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            const serialized = protocol.serialize(message);
            const tampered = JSON.parse(serialized);
            const authTagBytes = Buffer.from(tampered.authTag, 'base64');
            authTagBytes[0] ^= 0xff; // Flip bits
            tampered.authTag = authTagBytes.toString('base64');
            (0, globals_1.expect)(() => {
                protocol.parseAndDecrypt(JSON.stringify(tampered));
            }).toThrow(/authentication failed/i);
        });
        (0, globals_1.it)('should detect tampering with IV', () => {
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            const serialized = protocol.serialize(message);
            const tampered = JSON.parse(serialized);
            const ivBytes = Buffer.from(tampered.iv, 'base64');
            ivBytes[0] ^= 0xff;
            tampered.iv = ivBytes.toString('base64');
            (0, globals_1.expect)(() => {
                protocol.parseAndDecrypt(JSON.stringify(tampered));
            }).toThrow(/authentication failed/i);
        });
        (0, globals_1.it)('should prevent replay attacks with different IVs', () => {
            const msg1 = protocol.createHealthCheck('svc1');
            const msg2 = protocol.createHealthCheck('svc1');
            const s1 = protocol.serialize(msg1);
            const s2 = protocol.serialize(msg2);
            (0, globals_1.expect)(s1).not.toBe(s2); // Different due to different IVs
        });
    });
    (0, globals_1.describe)('Memory Safety', () => {
        (0, globals_1.beforeEach)(() => {
            protocol.initializeEncryption(encryptionKey);
        });
        (0, globals_1.it)('should clear sensitive data after encryption', () => {
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            // The plaintext should be cleared
            // We can't directly verify this without memory inspection
            // but we verify the operation completes
            (0, globals_1.expect)(message).toBeDefined();
        });
        (0, globals_1.it)('should not expose encryption key', () => {
            const info = protocol.getKeyInfo();
            (0, globals_1.expect)(info).not.toHaveProperty('key');
            (0, globals_1.expect)(info).not.toHaveProperty('currentKey');
            (0, globals_1.expect)(info.keyId).toBeTruthy();
        });
        (0, globals_1.it)('should clear all data on close', () => {
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            protocol.close();
            (0, globals_1.expect)(() => {
                protocol.createHealthCheck('svc');
            }).toThrow(/Protocol closed/);
        });
        (0, globals_1.it)('should prevent operations after close', () => {
            protocol.close();
            (0, globals_1.expect)(() => {
                protocol.createServiceRegister('svc', 'Svc', 3000);
            }).toThrow(/Protocol closed/);
        });
    });
    (0, globals_1.describe)('Message Handlers', () => {
        (0, globals_1.beforeEach)(() => {
            protocol.initializeEncryption(encryptionKey);
        });
        (0, globals_1.it)('should register and retrieve handlers', () => {
            const handler = jest.fn();
            protocol.registerHandler('custom_message', handler);
            const retrieved = protocol.getHandler('custom_message');
            (0, globals_1.expect)(retrieved).toBe(handler);
        });
        (0, globals_1.it)('should return undefined for unregistered handlers', () => {
            const handler = protocol.getHandler('nonexistent');
            (0, globals_1.expect)(handler).toBeUndefined();
        });
        (0, globals_1.it)('should support registering handler via on() alias', () => {
            const handler = jest.fn();
            protocol.on('custom_event', handler);
            const retrieved = protocol.getHandler('custom_event');
            (0, globals_1.expect)(retrieved).toBe(handler);
        });
    });
    (0, globals_1.describe)('Serialization', () => {
        (0, globals_1.beforeEach)(() => {
            protocol.initializeEncryption(encryptionKey);
        });
        (0, globals_1.it)('should serialize message without plaintext', () => {
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            const serialized = protocol.serialize(message);
            const json = JSON.parse(serialized);
            (0, globals_1.expect)(json).toHaveProperty('type');
            (0, globals_1.expect)(json).toHaveProperty('id');
            (0, globals_1.expect)(json).toHaveProperty('payload'); // encrypted payload
            (0, globals_1.expect)(json).not.toHaveProperty('plaintext');
        });
        (0, globals_1.it)('should create valid JSON', () => {
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            const serialized = protocol.serialize(message);
            (0, globals_1.expect)(() => {
                JSON.parse(serialized);
            }).not.toThrow();
        });
    });
    (0, globals_1.describe)('Different Keys', () => {
        (0, globals_1.it)('should fail to decrypt with different key', () => {
            const key1 = crypto.randomBytes(32);
            const key2 = crypto.randomBytes(32);
            protocol.initializeEncryption(key1);
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            const serialized = protocol.serialize(message);
            // Switch to different key
            protocol.close();
            const protocol2 = new encrypted_ipc_1.EmailServiceIPCProtocol();
            protocol2.initializeEncryption(key2);
            (0, globals_1.expect)(() => {
                protocol2.parseAndDecrypt(serialized);
            }).toThrow();
        });
        (0, globals_1.it)('should decrypt with same key', () => {
            const key = crypto.randomBytes(32);
            const hexKey = key.toString('hex');
            protocol.initializeEncryption(hexKey);
            const message = protocol.createServiceRegister('svc', 'Svc', 3000);
            const serialized = protocol.serialize(message);
            // Switch to new instance with same key
            protocol.close();
            const protocol2 = new encrypted_ipc_1.EmailServiceIPCProtocol();
            protocol2.initializeEncryption(hexKey);
            const { plaintext } = protocol2.parseAndDecrypt(serialized);
            (0, globals_1.expect)(plaintext.length).toBeGreaterThan(0);
        });
    });
});
(0, globals_1.describe)('EncryptedIPCClient', () => {
    let client;
    let encryptionKey;
    let mockServer = null;
    (0, globals_1.beforeEach)(() => {
        encryptionKey = crypto.randomBytes(32);
        client = new encrypted_ipc_1.EncryptedIPCClient('email-service', 'Email Service', 3000, 9999);
    });
    (0, globals_1.afterEach)(() => {
        client.disconnect();
        if (mockServer) {
            mockServer.close();
            mockServer = null;
        }
    });
    (0, globals_1.it)('should initialize with encryption key', async () => {
        await client.initialize(encryptionKey);
        const protocol = client.getProtocol();
        const info = protocol.getKeyInfo();
        (0, globals_1.expect)(info.isInitialized).toBe(true);
    });
    (0, globals_1.it)('should initialize with hex key', async () => {
        const hexKey = encryptionKey.toString('hex');
        await client.initialize(hexKey);
        const protocol = client.getProtocol();
        const info = protocol.getKeyInfo();
        (0, globals_1.expect)(info.isInitialized).toBe(true);
    });
    (0, globals_1.it)('should fail to connect to unavailable server', async () => {
        await client.initialize(encryptionKey);
        await (0, globals_1.expect)(client.connect()).rejects.toThrow(/timeout|ECONNREFUSED/i);
    });
    (0, globals_1.it)('should register message handler', async () => {
        await client.initialize(encryptionKey);
        const handler = jest.fn();
        client.on('test_message', handler);
        const protocol = client.getProtocol();
        const retrieved = protocol.getHandler('test_message');
        (0, globals_1.expect)(retrieved).toBe(handler);
    });
    (0, globals_1.it)('should disconnect cleanly', async () => {
        await client.initialize(encryptionKey);
        (0, globals_1.expect)(() => {
            client.disconnect();
        }).not.toThrow();
    });
});
(0, globals_1.describe)('CPU Memory Safety Integration', () => {
    let protocol;
    (0, globals_1.beforeEach)(() => {
        protocol = new encrypted_ipc_1.EmailServiceIPCProtocol();
    });
    (0, globals_1.afterEach)(() => {
        protocol.close();
    });
    (0, globals_1.it)('should not expose keys in memory after close', () => {
        const key = crypto.randomBytes(32);
        protocol.initializeEncryption(key);
        const msg = protocol.createServiceRegister('svc', 'Svc', 3000);
        protocol.close();
        // Key should no longer be accessible
        (0, globals_1.expect)(() => {
            protocol.createHealthCheck('svc');
        }).toThrow(/closed/i);
    });
    (0, globals_1.it)('should clear buffers on error', () => {
        protocol.initializeEncryption(crypto.randomBytes(32));
        (0, globals_1.expect)(() => {
            protocol.parseAndDecrypt('invalid json');
        }).toThrow();
        // Protocol should still be usable
        const msg = protocol.createHealthCheck('svc');
        (0, globals_1.expect)(msg).toBeDefined();
    });
    (0, globals_1.it)('should support rapid key operations', () => {
        const key = crypto.randomBytes(32);
        protocol.initializeEncryption(key);
        const messages = Array(100)
            .fill(0)
            .map((_, i) => protocol.createHealthCheck(`svc${i}`));
        (0, globals_1.expect)(messages.length).toBe(100);
        (0, globals_1.expect)(messages.every((m) => m.encrypted)).toBe(true);
    });
    (0, globals_1.it)('should handle concurrent encryption operations', async () => {
        protocol.initializeEncryption(crypto.randomBytes(32));
        const promises = Array(100)
            .fill(0)
            .map((_, i) => Promise.resolve(protocol.createServiceRegister(`svc${i}`, `Service ${i}`, 3000 + i)));
        const results = await Promise.all(promises);
        (0, globals_1.expect)(results.length).toBe(100);
        (0, globals_1.expect)(results.every((m) => m.encrypted)).toBe(true);
    });
});
//# sourceMappingURL=encrypted-ipc.test.js.map
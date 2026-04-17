/**
 * Jest Setup File
 * Configuration for email-sender service tests
 */

// Ensure stderr and console output is visible during tests
process.stderr.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Mock timers if needed
jest.useFakeTimers();

// Restore real timers after each test
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.useFakeTimers(); // Reset for next test
});

// Optional: Set test environment variables
process.env.CT_ENCRYPTION_KEY = process.env.CT_ENCRYPTION_KEY || 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1';
process.env.CT_IPC_PORT = process.env.CT_IPC_PORT || '9876';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Suppress debug logging during tests
if (!process.env.DEBUG) {
  console.debug = jest.fn();
}

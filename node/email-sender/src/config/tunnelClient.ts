/**
 * Cloudflare Tunnel Client
 * Manages tunnel connections and domain routing
 * Embeds tunnel credentials and handles automated connection
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { getGlobalLogger } from '../logger';
import { CloudflareTunnelConfig } from './cloudflareConfig';

const logger = getGlobalLogger();

export interface TunnelConnection {
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  process?: any;
  url?: string;
  lastCheck?: Date;
  error?: string;
}

export class CloudflareTunnelClient {
  private config: CloudflareTunnelConfig;
  private connection: TunnelConnection = {
    status: 'DISCONNECTED',
  };
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000; // 5 seconds

  constructor(config: CloudflareTunnelConfig) {
    this.config = config;
  }

  /**
   * Connect to Cloudflare Tunnel
   */
  async connect(): Promise<boolean> {
    if (!this.config.enabled) {
      logger.info('ℹ️  Cloudflare Tunnel is disabled - using direct connection');
      return true;
    }

    logger.info('☁️  Connecting to Cloudflare Tunnel...');
    this.connection.status = 'CONNECTING';

    try {
      // Check for cloudflared binary
      const cloudflaredPath = await this.findCloudflared();
      if (!cloudflaredPath) {
        throw new Error('cloudflared binary not found - install cloudflare-cli or use CF_TUNNEL_DISABLED=true');
      }

      // Build tunnel arguments
      const tunnelArgs = this.buildTunnelArgs();

      logger.debug('Starting cloudflared with args:', { args: tunnelArgs });

      // Spawn cloudflared process
      const tunnelProcess = spawn(cloudflaredPath, tunnelArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this.connection.process = tunnelProcess;
      this.connection.status = 'CONNECTED';
      this.reconnectAttempts = 0;

      // Handle output
      tunnelProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Connected')) {
          logger.info('✓ Cloudflare Tunnel connected successfully', {
            domain: this.config.domain,
            tunnel: this.config.tunnelName,
          });

          // Extract tunnel URL if available
          const urlMatch = output.match(/https:\/\/(.*?)\//);
          if (urlMatch) {
            this.connection.url = urlMatch[1];
          }
        }

        logger.debug('Tunnel output:', { data: output.trim() });
      });

      tunnelProcess.stderr?.on('data', (data) => {
        const error = data.toString();
        logger.warn('Tunnel warning/error:', { message: error.trim() });
      });

      tunnelProcess.on('error', (err) => {
        this.handleTunnelError(err);
      });

      tunnelProcess.on('exit', (code) => {
        if (code !== 0) {
          logger.error('Tunnel process exited with code:', { code });
          this.connection.status = 'DISCONNECTED';
          this.attemptReconnect();
        }
      });

      logger.info('☁️  Cloudflare Tunnel client started', {
        status: this.connection.status,
        domain: this.config.domain,
        routes: this.config.routes.length,
      });

      return true;
    } catch (error) {
      return this.handleTunnelError(error);
    }
  }

  /**
   * Find cloudflared binary in system PATH
   */
  private async findCloudflared(): Promise<string | null> {
    const { execSync } = require('child_process');

    try {
      // Try common installation locations
      const paths = [
        'cloudflared',
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Cloudflare', 'cloudflared', 'cloudflared.exe'),
        path.join(process.env.LOCALAPPDATA || 'C:\\Users\\AppData\\Local', 'Programs', 'Cloudflare', 'cloudflared.exe'),
        '/usr/local/bin/cloudflared',
        '/usr/bin/cloudflared',
      ];

      for (const p of paths) {
        try {
          execSync(`${p} --version`, { stdio: 'ignore' });
          logger.debug('Found cloudflared at:', { path: p });
          return p;
        } catch {
          // Continue to next path
        }
      }

      return null;
    } catch (error) {
      logger.debug('Error finding cloudflared:', { error });
      return null;
    }
  }

  /**
   * Build cloudflared tunnel command arguments
   */
  private buildTunnelArgs(): string[] {
    const args = [
      'tunnel',
      'run',
      '--token',
      this.config.token || '',
      '--url',
      `http://localhost:${this.config.routes[0]?.localPort || 25}`,
    ];

    if (this.config.tunnelName) {
      args.unshift('tunnel', 'run', `--id=${this.config.tunnelName}`);
    }

    return args;
  }

  /**
   * Handle tunnel connection errors
   */
  private handleTunnelError(error: any): boolean {
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.warn('⚠️  Cloudflare Tunnel error:', {
      error: errorMsg,
      attempt: this.reconnectAttempts + 1,
      maxAttempts: this.maxReconnectAttempts,
    });

    this.connection.status = 'ERROR';
    this.connection.error = errorMsg;

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.attemptReconnect();
      return false;
    } else {
      logger.error('❌ Cloudflare Tunnel failed after multiple attempts', {
        attempts: this.reconnectAttempts,
        error: errorMsg,
      });
      logger.error('⚠️  Falling back to direct connection (non-tunneled)');
      this.connection.status = 'DISCONNECTED';
      return false;
    }
  }

  /**
   * Attempt to reconnect to tunnel
   */
  private attemptReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    logger.info(`🔄 Reconnecting to Cloudflare Tunnel in ${delay}ms...`, {
      attempt: this.reconnectAttempts,
      maxAttempts: this.maxReconnectAttempts,
    });

    setTimeout(() => {
      this.connect().catch((err) => {
        logger.error('Reconnect failed:', { error: err });
      });
    }, delay);
  }

  /**
   * Disconnect from tunnel
   */
  disconnect(): void {
    if (this.connection.process) {
      logger.info('☁️  Disconnecting from Cloudflare Tunnel...');
      this.connection.process.kill('SIGTERM');
      this.connection.status = 'DISCONNECTED';
    }
  }

  /**
   * Get tunnel connection status
   */
  getStatus(): TunnelConnection {
    return {
      ...this.connection,
      lastCheck: new Date(),
    };
  }

  /**
   * Log tunnel configuration and status
   */
  logTunnelStatus(): void {
    const status = this.getStatus();

    if (!this.config.enabled) {
      logger.info('🔌 Direct Connection (Cloudflare Tunnel disabled)');
      return;
    }

    logger.info('☁️  Cloudflare Tunnel Status:');
    logger.info(`   Status: ${status.status}`);
    logger.info(`   Domain: ${this.config.domain}`);

    if (status.url) {
      logger.info(`   Public URL: https://${status.url}`);
    }

    if (status.error) {
      logger.warn(`   Error: ${status.error}`);
    }

    logger.info('   Routes:');
    this.config.routes.forEach((route) => {
      logger.info(`     • ${route.service} → ${route.publicHostname}`);
      logger.info(`       (localhost:${route.localPort})`);
    });
  }
}

/**
 * Create and connect a tunnel client
 */
export async function createTunnelClient(config: CloudflareTunnelConfig): Promise<CloudflareTunnelClient> {
  const client = new CloudflareTunnelClient(config);

  if (config.enabled) {
    await client.connect();
  }

  return client;
}

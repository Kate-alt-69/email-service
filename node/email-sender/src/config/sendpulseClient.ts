/**
 * SendPulse REST API Client
 * Handles domain fetching and email provider operations
 * 
 * API Reference: https://sendpulse.com/api/rest-api
 */

import axios from 'axios';
import { getGlobalLogger } from '../logger';

const logger = getGlobalLogger();

export interface SendPulseDomain {
  id: number;
  name: string;
  status: 'verified' | 'pending' | 'rejected';
  createdAt: string;
  isDefault: boolean;
}

export interface SendPulseUser {
  id: number;
  email: string;
  emailFrom: string;
}

export interface SendPulseAuthTokenResponse {
  token: string;
  user: SendPulseUser;
}

export class SendPulseClient {
  private client: ReturnType<typeof axios.create>;
  private token: string | null = null;
  private apiKey: string;
  private apiSecret: string;
  private baseUrl: string = 'https://api.sendpulse.com';

  constructor(apiKey?: string, apiSecret?: string) {
    this.apiKey = apiKey || process.env.SENDPULSE_API_KEY || '';
    this.apiSecret = apiSecret || process.env.SENDPULSE_API_SECRET || '';

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 10000,
    });
  }

  /**
   * Authenticate and get access token
   */
  async authenticate(): Promise<string> {
    if (this.token) {
      return this.token as string;
    }

    try {
      if (!this.apiKey || !this.apiSecret) {
        throw new Error(
          'SendPulse API credentials not configured. Set SENDPULSE_API_KEY and SENDPULSE_API_SECRET'
        );
      }

      logger.debug('Authenticating with SendPulse API...');

      const response = await this.client.post<SendPulseAuthTokenResponse>(
        '/oauth/access_token',
        {
          grant_type: 'client_credentials',
          client_id: this.apiKey,
          client_secret: this.apiSecret,
        }
      );

      this.token = response.data.token;
      logger.debug('✓ SendPulse authentication successful');

      return this.token as string;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('SendPulse authentication failed:', errorMsg);
      throw new Error(`SendPulse authentication failed: ${errorMsg}`);
    }
  }

  /**
   * Fetch all verified domains from SendPulse
   */
  async getDomains(): Promise<SendPulseDomain[]> {
    try {
      const token = await this.authenticate();

      logger.debug('Fetching domains from SendPulse...');

      const response = await this.client.get<any>('/sender/domains', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const domains = (response.data?.domains || response.data || []) as SendPulseDomain[];

      logger.debug(`✓ Fetched ${domains.length} domains from SendPulse`, {
        domains: domains.map((d: SendPulseDomain) => ({
          name: d.name,
          status: d.status,
          isDefault: d.isDefault,
        })),
      });

      return domains;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch SendPulse domains:', errorMsg);
      throw new Error(`Failed to fetch SendPulse domains: ${errorMsg}`);
    }
  }

  /**
   * Fetch verified domains only
   */
  async getVerifiedDomains(): Promise<SendPulseDomain[]> {
    const allDomains = await this.getDomains();
    return allDomains.filter((domain) => domain.status === 'verified');
  }

  /**
   * Get the default/primary domain
   */
  async getDefaultDomain(): Promise<SendPulseDomain | null> {
    const domains = await this.getDomains();
    return domains.find((domain) => domain.isDefault) || null;
  }

  /**
   * Verify a domain is available for sending
   */
  async isMailableFromDomain(domain: string): Promise<boolean> {
    try {
      const verifiedDomains = await this.getVerifiedDomains();
      return verifiedDomains.some(
        (d) => d.name.toLowerCase() === domain.toLowerCase()
      );
    } catch (error) {
      logger.warn(`Failed to verify domain ${domain}:`, error);
      return false;
    }
  }

  /**
   * Get user account info
   */
  async getUserInfo(): Promise<SendPulseUser | null> {
    try {
      const token = await this.authenticate();

      const response = await this.client.get<SendPulseUser>('/user/info', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return response.data || null;
    } catch (error) {
      logger.warn('Failed to fetch SendPulse user info:', error);
      return null;
    }
  }

  /**
   * Invalidate current token (logout)
   */
  invalidateToken(): void {
    this.token = null;
    logger.debug('SendPulse token invalidated');
  }
}

// Singleton instance
let sendPulseClientInstance: SendPulseClient | null = null;

export function getSendPulseClient(): SendPulseClient {
  if (!sendPulseClientInstance) {
    sendPulseClientInstance = new SendPulseClient();
  }
  return sendPulseClientInstance;
}

export function createSendPulseClient(
  apiKey?: string,
  apiSecret?: string
): SendPulseClient {
  return new SendPulseClient(apiKey, apiSecret);
}

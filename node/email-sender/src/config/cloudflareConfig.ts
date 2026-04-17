/**
 * Cloudflare Tunnel Configuration
 * Manages tunnel credentials, routing, and connection status
 * Credentials can be embedded at build time or provided at runtime
 */

export interface CloudflareTunnelConfig {
  enabled: boolean;
  token?: string;
  tunnelName?: string;
  accountTag?: string;
  domain: string;
  routes: TunnelRoute[];
}

export interface TunnelRoute {
  service: string;
  localAddress: string;
  localPort: number;
  publicHostname?: string;
}

/**
 * Load Cloudflare Tunnel configuration from environment
 */
export function loadCloudflareConfig(): CloudflareTunnelConfig {
  const enabled = process.env.CF_TUNNEL_ENABLED === 'true';
  const token = process.env.CF_TUNNEL_TOKEN || '';
  const tunnelName = process.env.CF_TUNNEL_NAME || 'email-service-tunnel';
  const accountTag = process.env.CF_ACCOUNT_TAG || '';
  const domain = process.env.CF_DOMAIN || 'httpsbuffcowland.in';

  // Define routes for SMTP and Email API
  // SMTP: Public facing on smtp.httpsbuffcowland.in
  // Email API: Internal only (no public route, accessed via API gateway)
  const routes: TunnelRoute[] = [
    {
      service: 'emailSMTP',
      localAddress: 'localhost',
      localPort: parseInt(process.env.SMTP_PORT || '3425', 10),
      publicHostname: `smtp.${domain}`,
    },
    {
      service: 'emailService',
      localAddress: 'localhost',
      localPort: parseInt(process.env.PORT || '3430', 10),
      // No public hostname - this is an internal service
      // Accessed via api.httpsbuffcowland.in if needed, but typically private
    },
  ];

  return {
    enabled,
    token,
    tunnelName,
    accountTag,
    domain,
    routes,
  };
}

/**
 * Validate Cloudflare Tunnel configuration
 */
export function validateTunnelConfig(config: CloudflareTunnelConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.enabled) {
    return { valid: true, errors: [] };
  }

  if (!config.token) {
    errors.push('CF_TUNNEL_TOKEN not set');
  }

  if (!config.accountTag) {
    errors.push('CF_ACCOUNT_TAG not set');
  }

  if (!config.domain) {
    errors.push('CF_DOMAIN not set');
  }

  if (config.routes.length === 0) {
    errors.push('No tunnel routes configured');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format tunnel configuration for display
 */
export function formatTunnelConfig(config: CloudflareTunnelConfig): string {
  if (!config.enabled) {
    return '⚠️  Cloudflare Tunnel disabled (direct connection)';
  }

  const output: string[] = [];
  output.push('☁️  Cloudflare Tunnel Configuration:');
  output.push('┌─────────────────────────────────────────────────────┐');
  output.push(`│ Status: ✓ ENABLED                                    │`);
  output.push(`│ Tunnel Name: ${config.tunnelName?.padEnd(25)} │`);
  output.push(`│ Domain: ${config.domain?.padEnd(31)} │`);
  output.push('├─────────────────────────────────────────────────────┤');
  output.push('│ Routes:                                             │');
  config.routes.forEach((route) => {
    output.push(
      `│   ${route.service}: ${route.publicHostname?.padEnd(35)} │`
    );
    output.push(
      `│     ↓ ${route.localAddress}:${route.localPort}${' '.repeat(30)}│`
    );
  });
  output.push('└─────────────────────────────────────────────────────┘');

  return output.join('\n');
}

/**
 * Get tunnel status badge for logging
 */
export function getTunnelStatusBadge(enabled: boolean): string {
  return enabled ? '☁️  Tunnel Connected' : '🔌 Direct Connection';
}

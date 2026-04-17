/**
 * Domain Configuration Checker
 * Validates DNS, MX records, SPF, DKIM, and email delivery configuration
 * Logs clean configuration status for debugging email delivery issues
 */

import * as dns from 'dns';
import { promises as dnsPromises } from 'dns';
import { getGlobalLogger } from '../logger';
import { getConfiguredDomains, getDefaultFromAddress, isPlaceholderDomain } from './emailDefaults';

const logger = getGlobalLogger();

export interface DNSRecord {
  type: string;
  value: string;
  priority?: number;
  ttl?: number;
}

export interface DomainConfig {
  domain: string;
  mxRecords: DNSRecord[];
  spfRecord?: DNSRecord;
  dkimCandidate?: string; // Common DKIM selector
  cnameToCF?: boolean; // Is CNAME pointing to Cloudflare?
  cloudflareEnabled?: boolean;
  configStatus: 'CONFIGURED' | 'PARTIAL' | 'MISCONFIGURED';
  issues: string[];
  recommendations: string[];
}

export interface ConfigurationCheckResult {
  domain: string;
  canSendMail: boolean;
  canReceiveMail: boolean;
  dnsConfigured: boolean;
  spfConfigured: boolean;
  dkimConfigured: boolean;
  cloudflareProxied: boolean;
  details: DomainConfig;
}

/**
 * Check MX records for a domain
 */
export async function checkMXRecords(domain: string): Promise<DNSRecord[]> {
  try {
    const mxRecords = await dnsPromises.resolveMx(domain);
    return mxRecords.map((record: any) => ({
      type: 'MX',
      value: record.exchange,
      priority: record.priority,
    }));
  } catch (error) {
    logger.debug(`MX lookup failed for ${domain}: ${error}`);
    return [];
  }
}

/**
 * Check SPF record for a domain
 */
export async function checkSPFRecord(domain: string): Promise<DNSRecord | undefined> {
  try {
    const txtRecords = await dnsPromises.resolveTxt(domain);
    const spfRecord = txtRecords.find((record: any) => {
      const txt = Array.isArray(record) ? record.join('') : record;
      return txt.startsWith('v=spf1');
    });

    if (spfRecord) {
      const txt = Array.isArray(spfRecord) ? spfRecord.join('') : spfRecord;
      return {
        type: 'TXT (SPF)',
        value: txt,
      };
    }
  } catch (error) {
    logger.debug(`SPF lookup failed for ${domain}: ${error}`);
  }

  return undefined;
}

/**
 * Check for DKIM records
 * Common DKIM selectors: default, k1, selector1, selector2, google, amazonses
 */
export async function checkDKIMRecord(
  domain: string,
  selector: string = 'default'
): Promise<DNSRecord | undefined> {
  try {
    const dkimDomain = `${selector}._domainkey.${domain}`;
    const txtRecords = await dnsPromises.resolveTxt(dkimDomain);

    const dkimRecord = txtRecords.find((record: any) => {
      const txt = Array.isArray(record) ? record.join('') : record;
      return txt.includes('v=DKIM1');
    });

    if (dkimRecord) {
      const txt = Array.isArray(dkimRecord) ? dkimRecord.join('') : dkimRecord;
      return {
        type: 'TXT (DKIM)',
        value: txt.substring(0, 50) + (txt.length > 50 ? '...' : ''),
      };
    }
  } catch (error) {
    logger.debug(`DKIM lookup failed for ${selector}._domainkey.${domain}: ${error}`);
  }

  return undefined;
}

/**
 * Check if domain is Cloudflare proxied (CNAME check)
 */
export async function checkCloudflareProxy(domain: string): Promise<boolean> {
  try {
    const cnameRecords = await dnsPromises.resolveCname(domain).catch(() => []);
    const isCFProxied = cnameRecords.some((cname: string) => cname.includes('cloudflare'));
    return isCFProxied;
  } catch (error) {
    logger.debug(`Cloudflare proxy check failed: ${error}`);
    return false;
  }
}

/**
 * Comprehensive domain configuration check
 */
export async function checkDomainConfiguration(domain: string): Promise<ConfigurationCheckResult> {
  logger.info(`🔍 Starting domain configuration check for: ${domain}`);

  const [mxRecords, spfRecord, dkimRecord, cfProxied] = await Promise.all([
    checkMXRecords(domain),
    checkSPFRecord(domain),
    checkDKIMRecord(domain, 'default'),
    checkCloudflareProxy(domain),
  ]);

  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check for send capability (requires SPF)
  const canSendMail = !!spfRecord;
  if (!canSendMail) {
    issues.push('SPF record not found');
    recommendations.push('Add SPF record: v=spf1 mx ~all');
  }

  // Check for receive capability (requires MX records)
  const canReceiveMail = mxRecords.length > 0;
  if (!canReceiveMail) {
    issues.push('MX records not found');
    recommendations.push('Add MX records pointing to mail servers');
  }

  // DKIM status
  const dkimConfigured = !!dkimRecord;
  if (!dkimConfigured) {
    recommendations.push('Configure DKIM for email authentication');
  }

  // Overall status
  let configStatus: 'CONFIGURED' | 'PARTIAL' | 'MISCONFIGURED';
  if (canSendMail && canReceiveMail && dkimConfigured) {
    configStatus = 'CONFIGURED';
  } else if (canSendMail || canReceiveMail) {
    configStatus = 'PARTIAL';
  } else {
    configStatus = 'MISCONFIGURED';
  }

  const dnsConfigured = mxRecords.length > 0;

  const result: ConfigurationCheckResult = {
    domain,
    canSendMail,
    canReceiveMail,
    dnsConfigured,
    spfConfigured: !!spfRecord,
    dkimConfigured,
    cloudflareProxied: cfProxied,
    details: {
      domain,
      mxRecords,
      spfRecord,
      dkimCandidate: dkimRecord ? 'default' : undefined,
      cnameToCF: cfProxied,
      cloudflareEnabled: cfProxied,
      configStatus,
      issues,
      recommendations,
    },
  };

  return result;
}

/**
 * Log domain configuration in a clean table format
 */
export function logDomainConfiguration(result: ConfigurationCheckResult): void {
  const { domain, details } = result;

  // Configuration table header
  logger.info(`════════════════════════════════════════════════════════════════`);
  logger.info(`📧 Domain Configuration: ${domain}`);
  logger.info(`════════════════════════════════════════════════════════════════`);

  // DNS Configuration Table
  logger.info(`\n🔧 DNS Configuration:`);
  logger.info(`┌─────────────────────┬──────────────┬───────────┬─────────────┐`);
  logger.info(`│ Record Type         │ Value/Host   │ Priority  │ Status      │`);
  logger.info(`├─────────────────────┼──────────────┼───────────┼─────────────┤`);

  // MX Records
  if (details.mxRecords.length > 0) {
    details.mxRecords.forEach((record, idx) => {
      const status = idx === 0 ? '✓ Primary' : '✓ Secondary';
      const priority = record.priority || '-';
      logger.info(
        `│ MX Record ${idx + 1}         │ ${record.value.padEnd(12)} │ ${String(priority).padEnd(9)} │ ${status.padEnd(11)} │`
      );
    });
  } else {
    logger.warn(`│ MX Record           │ Not Found    │ -         │ ❌ Missing  │`);
  }

  logger.info(`├─────────────────────┼──────────────┼───────────┼─────────────┤`);

  // SPF Record
  if (details.spfRecord) {
    const spfValue = details.spfRecord.value.substring(0, 12) + '...';
    logger.info(`│ SPF (TXT)           │ ${spfValue.padEnd(12)} │ -         │ ✓ Configured│`);
  } else {
    logger.warn(`│ SPF (TXT)           │ Not Found    │ -         │ ❌ Missing  │`);
  }

  logger.info(`├─────────────────────┼──────────────┼───────────┼─────────────┤`);

  // DKIM Record
  if (details.dkimCandidate) {
    logger.info(`│ DKIM (${details.dkimCandidate})       │ Configured│ -         │ ✓ Active    │`);
  } else {
    logger.warn(`│ DKIM                │ Not Found    │ -         │ ❌ Missing  │`);
  }

  logger.info(`└─────────────────────┴──────────────┴───────────┴─────────────┘`);

  // Cloudflare/Proxy configuration
  logger.info(`\n☁️  CDN & Proxy Configuration:`);
  logger.info(`┌─────────────────────┬──────────────────┬────────────────┐`);
  logger.info(`│ Service             │ Status           │ Configuration  │`);
  logger.info(`├─────────────────────┼──────────────────┼────────────────┤`);

  if (details.cloudflareEnabled) {
    logger.info(`│ Cloudflare DNS      │ ✓ Proxied        │ CNAME to CF    │`);
    logger.info(`│ Proxy Status        │ ✓ Active         │ Orange Cloud   │`);
  } else {
    logger.info(`│ Cloudflare DNS      │ ❌ Not Proxied   │ Direct DNS     │`);
    logger.info(`│ Proxy Status        │ ⚠️  Not Active   │ Gray Cloud     │`);
  }

  logger.info(`└─────────────────────┴──────────────────┴────────────────┘`);

  // Email Capability Summary
  logger.info(`\n📨 Email Capabilities:`);
  logger.info(`┌──────────────────────────┬───────┐`);
  logger.info(`│ Capability               │ Status│`);
  logger.info(`├──────────────────────────┼───────┤`);
  logger.info(
    `│ Can Send Emails (SPF)    │ ${result.canSendMail ? '✓ Yes' : '❌ No'
      .padEnd(6)} │`
  );
  logger.info(
    `│ Can Receive Emails (MX)  │ ${result.canReceiveMail ? '✓ Yes' : '❌ No'
      .padEnd(6)} │`
  );
  logger.info(
    `│ DKIM Authentication      │ ${result.dkimConfigured ? '✓ Yes' : '❌ No'
      .padEnd(6)} │`
  );
  logger.info(
    `│ SPF Verification         │ ${result.spfConfigured ? '✓ Yes' : '⚠️  No'
      .padEnd(6)} │`
  );
  logger.info(`└──────────────────────────┴───────┘`);

  // Overall status with color
  const statusEmoji = {
    CONFIGURED: '✓',
    PARTIAL: '⚠️',
    MISCONFIGURED: '❌',
  };
  const statusText = {
    CONFIGURED: 'FULLY CONFIGURED',
    PARTIAL: 'PARTIALLY CONFIGURED',
    MISCONFIGURED: 'MISCONFIGURED',
  };

  logger.info(`\n${statusEmoji[details.configStatus]} Overall Status: ${statusText[details.configStatus]}`);

  // Issues and recommendations
  if (details.issues.length > 0) {
    logger.warn(`\n⚠️  Issues Found:`);
    details.issues.forEach((issue) => {
      logger.warn(`  • ${issue}`);
    });
  }

  if (details.recommendations.length > 0) {
    logger.info(`\n💡 Recommendations:`);
    details.recommendations.forEach((rec) => {
      logger.info(`  • ${rec}`);
    });
  }

  logger.info(`════════════════════════════════════════════════════════════════\n`);
}

/**
 * Check all configured sender domains
 */
export async function checkAllSenderDomains(): Promise<ConfigurationCheckResult[]> {
  const emailFrom = getDefaultFromAddress();
  const uniqueDomains = [
    ...new Set(
      [emailFrom.split('@')[1], ...getConfiguredDomains()].filter(
        (domain): domain is string => !isPlaceholderDomain(domain)
      )
    ),
  ];

  logger.info(`\n🔍 Checking configuration for ${uniqueDomains.length} domain(s)...\n`);

  const results = await Promise.all(uniqueDomains.map((domain) => checkDomainConfiguration(domain)));

  results.forEach((result) => {
    logDomainConfiguration(result);
  });

  return results;
}

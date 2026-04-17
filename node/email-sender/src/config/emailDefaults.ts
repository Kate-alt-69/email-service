const PLACEHOLDER_DOMAINS = new Set([
  'yourdomain.com',
  'mydomain.com',
  'mydomain.in',
  'example.com',
]);

function normalizeDomain(input?: string | null): string {
  const trimmed = String(input || '').trim().toLowerCase();
  if (!trimmed) {
    return '';
  }

  return trimmed
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^@+/, '')
    .replace(/\.+$/, '');
}

export function domainFromAddress(address?: string | null): string {
  const trimmed = String(address || '').trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex >= trimmed.length - 1) {
    return '';
  }

  return normalizeDomain(trimmed.slice(atIndex + 1));
}

export function isPlaceholderDomain(domain?: string | null): boolean {
  const normalized = normalizeDomain(domain);
  return !normalized || PLACEHOLDER_DOMAINS.has(normalized);
}

export function isTestingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const testingFlags = [
    env.EMAIL_SERVICE_TEST_MODE,
    env.EMAIL_TEST_MODE,
    env.TEST_MODE,
  ];

  for (const value of testingFlags) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    return normalized !== '0' && normalized !== 'false' && normalized !== 'off';
  }

  return String(env.NODE_ENV || '').trim().toLowerCase() === 'test';
}

export function getTestingDomain(env: NodeJS.ProcessEnv = process.env): string {
  return (
    normalizeDomain(env.EMAIL_TEST_DOMAIN) ||
    normalizeDomain(env.CF_DOMAIN) ||
    'httpsbuffcowland.in'
  );
}

export function getPrimaryDomain(env: NodeJS.ProcessEnv = process.env): string {
  const candidateDomains = [
    normalizeDomain(env.EMAIL_DEFAULT_DOMAIN),
    normalizeDomain(env.CUSTOM_DOMAIN),
    normalizeDomain(env.CF_DOMAIN),
    domainFromAddress(env.CUSTOM_DOMAIN_FROM_EMAIL),
    domainFromAddress(env.EMAIL_FROM),
    ...String(env.EMAIL_DOMAINS || env.EMAIL_SERVICE_DOMAINS || '')
      .split(',')
      .map((value) => normalizeDomain(value)),
  ];

  const explicitDomain = candidateDomains.find((domain) => !isPlaceholderDomain(domain));
  if (explicitDomain) {
    return explicitDomain;
  }

  if (isTestingEnabled(env)) {
    return getTestingDomain(env);
  }

  return normalizeDomain(env.EMAIL_LOCAL_DOMAIN) || 'localhost.test';
}

export function getConfiguredDomains(env: NodeJS.ProcessEnv = process.env): string[] {
  const values = [
    getPrimaryDomain(env),
    ...String(env.EMAIL_DOMAINS || env.EMAIL_SERVICE_DOMAINS || '')
      .split(',')
      .map((value) => normalizeDomain(value)),
    normalizeDomain(env.CUSTOM_DOMAIN),
    normalizeDomain(env.CF_DOMAIN),
    domainFromAddress(env.CUSTOM_DOMAIN_FROM_EMAIL),
    domainFromAddress(env.EMAIL_FROM),
  ].filter((domain) => !isPlaceholderDomain(domain));

  return Array.from(new Set(values));
}

export function getDefaultFromAddress(
  env: NodeJS.ProcessEnv = process.env,
  localPart = 'noreply'
): string {
  const configuredFrom = String(env.EMAIL_FROM || '').trim();
  if (configuredFrom) {
    return configuredFrom;
  }

  return `${localPart}@${getPrimaryDomain(env)}`;
}

export function getDefaultWebsiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configuredUrl = String(env.COMPANY_WEBSITE || '').trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  return `https://${getPrimaryDomain(env)}`;
}

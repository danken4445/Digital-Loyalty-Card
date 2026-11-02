import 'server-only';

export type SecurityLogLevel = 'info' | 'warn' | 'error';

export interface StructuredSecurityLog {
  timestamp: string;
  level: SecurityLogLevel;
  event: string;
  context: Record<string, unknown>;
}

const SENSITIVE_KEY_PATTERN =
  /secret|token|password|cookie|authorization|service_role|anon_key|email|ip|phone|credential|signature/i;

const EMAIL_VALUE_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const TOKEN_VALUE_PATTERN =
  /\b(tcp_redeem1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|tcp_merge1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+|sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]+)\b/g;

/**
 * Redacts PII (emails, IPs, phone numbers) and secrets/tokens from a value before logging.
 */
export function redactSensitiveValue(value: unknown, keyName = ''): unknown {
  if (keyName && SENSITIVE_KEY_PATTERN.test(keyName)) {
    return '[REDACTED]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return value
      .replace(TOKEN_VALUE_PATTERN, '[REDACTED_TOKEN]')
      .replace(EMAIL_VALUE_PATTERN, '[REDACTED_EMAIL]');
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSensitiveValue(v, k);
    }
    return out;
  }

  return '[UNSERIALIZABLE]';
}

/**
 * Produces a sanitized shallow+deep copy of log context with all PII and secrets stripped.
 */
export function sanitizeLogContext(context: Record<string, unknown> = {}): Record<string, unknown> {
  return redactSensitiveValue(context) as Record<string, unknown>;
}

/**
 * Formats and emits a structured, PII-free security log event.
 */
export function logSecurityEvent(
  level: SecurityLogLevel,
  event: string,
  context: Record<string, unknown> = {},
): StructuredSecurityLog {
  const payload: StructuredSecurityLog = {
    timestamp: new Date().toISOString(),
    level,
    event,
    context: sanitizeLogContext(context),
  };

  const serialized = JSON.stringify(payload);
  if (level === 'error') {
    console.error(serialized);
  } else if (process.env.NODE_ENV !== 'test') {
    if (level === 'warn') {
      console.warn(serialized);
    } else {
      console.info(serialized);
    }
  }

  return payload;
}

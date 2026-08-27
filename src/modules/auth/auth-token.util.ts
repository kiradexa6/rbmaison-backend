import { Request } from 'express';
import { extractSupabaseProjectRef } from '../../infrastructure/supabase/supabase-project.util';

export type AccessTokenDescription = {
  present: boolean;
  format: 'missing' | 'jwt' | 'non-jwt';
  projectRef: string | null;
  expired: boolean | null;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const remainder = padded.length % 4;
    const withPad =
      remainder === 0 ? padded : padded + '='.repeat(4 - remainder);
    return JSON.parse(Buffer.from(withPad, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function describeAccessToken(
  token: string | undefined,
): AccessTokenDescription {
  if (!token) {
    return {
      present: false,
      format: 'missing',
      projectRef: null,
      expired: null,
    };
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    return {
      present: true,
      format: 'non-jwt',
      projectRef: null,
      expired: null,
    };
  }

  const iss = typeof payload.iss === 'string' ? payload.iss : undefined;
  const exp = typeof payload.exp === 'number' ? payload.exp : undefined;

  return {
    present: true,
    format: 'jwt',
    projectRef: extractSupabaseProjectRef(iss),
    expired: typeof exp === 'number' ? exp * 1000 <= Date.now() : null,
  };
}

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(';').reduce<Record<string, string>>((cookies, part) => {
    const trimmed = part.trim();
    if (!trimmed) {
      return cookies;
    }
    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      return cookies;
    }
    const name = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function readSupabaseSessionToken(raw: string): string | undefined {
  const candidates = [raw];
  if (raw.startsWith('base64-')) {
    try {
      candidates.push(
        Buffer.from(raw.slice('base64-'.length), 'base64').toString('utf8'),
      );
    } catch {
      // Ignore malformed base64 cookie payloads.
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        access_token?: string;
        currentSession?: { access_token?: string };
      };
      if (parsed.access_token) {
        return parsed.access_token;
      }
      if (parsed.currentSession?.access_token) {
        return parsed.currentSession.access_token;
      }
    } catch {
      // Ignore non-JSON cookie payloads.
    }
  }

  return undefined;
}

export function extractAccessToken(request: Request): string | undefined {
  const authHeader = request.headers.authorization;
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();
    if (token) {
      return token;
    }
  }

  const cookies = parseCookieHeader(request.headers.cookie);
  const authCookieParts: string[] = [];

  for (const [name, value] of Object.entries(cookies)) {
    if (name.startsWith('sb-') && name.includes('auth-token')) {
      authCookieParts.push(value);
    }
  }

  for (const value of authCookieParts) {
    const token = readSupabaseSessionToken(value);
    if (token) {
      return token;
    }
  }

  return undefined;
}

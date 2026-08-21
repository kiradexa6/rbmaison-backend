import { Request } from 'express';

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
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token.length > 0) {
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

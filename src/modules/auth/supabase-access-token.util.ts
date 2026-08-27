import { createHmac, timingSafeEqual } from 'node:crypto';
import { extractSupabaseProjectRef } from '../../infrastructure/supabase/supabase-project.util';

export type VerifiedSupabaseAccessToken = {
  userId: string;
  email: string;
  projectRef: string | null;
};

export class SupabaseAccessTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SupabaseAccessTokenError';
  }
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  const padded =
    remainder === 0 ? normalized : normalized + '='.repeat(4 - remainder);
  return Buffer.from(padded, 'base64');
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new SupabaseAccessTokenError('invalid jwt format');
  }

  try {
    return JSON.parse(decodeBase64Url(parts[1]).toString('utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    throw new SupabaseAccessTokenError('invalid jwt payload');
  }
}

function verifyJwtSignature(token: string, secret: string): void {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new SupabaseAccessTokenError('invalid jwt format');
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const expected = createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signaturePart);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new SupabaseAccessTokenError('invalid jwt signature');
  }
}

function normalizeIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`;
}

export function verifySupabaseAccessToken(
  token: string,
  supabaseUrl: string,
  jwtSecret: string,
): VerifiedSupabaseAccessToken {
  if (!token.trim()) {
    throw new SupabaseAccessTokenError('missing access token');
  }

  if (!jwtSecret.trim()) {
    throw new SupabaseAccessTokenError('jwt secret is not configured');
  }

  verifyJwtSignature(token, jwtSecret);
  const payload = decodeJwtPayload(token);

  const issuer = typeof payload.iss === 'string' ? payload.iss : undefined;
  const audience = payload.aud;
  const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
  const email = typeof payload.email === 'string' ? payload.email : '';
  const expiresAt =
    typeof payload.exp === 'number' ? payload.exp * 1000 : undefined;

  const expectedIssuer = normalizeIssuer(supabaseUrl);
  if (issuer !== expectedIssuer) {
    throw new SupabaseAccessTokenError('jwt issuer mismatch');
  }

  if (audience !== 'authenticated') {
    throw new SupabaseAccessTokenError('jwt audience mismatch');
  }

  if (!subject) {
    throw new SupabaseAccessTokenError('jwt subject missing');
  }

  if (typeof expiresAt === 'number' && expiresAt <= Date.now()) {
    throw new SupabaseAccessTokenError('jwt expired');
  }

  return {
    userId: subject,
    email,
    projectRef: extractSupabaseProjectRef(issuer),
  };
}

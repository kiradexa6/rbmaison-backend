export const THROTTLE_TTL_MS = 60_000;

export const THROTTLE_DEFAULT_LIMIT = 120;
export const THROTTLE_AUTH_LIMIT = 5;
export const THROTTLE_FINANCIAL_LIMIT = 10;
export const THROTTLE_ORDER_LIMIT = 20;

export const THROTTLE_DEFAULT = {
  default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_DEFAULT_LIMIT },
} as const;

export const THROTTLE_AUTH = {
  default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_AUTH_LIMIT },
} as const;

export const THROTTLE_FINANCIAL = {
  default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_FINANCIAL_LIMIT },
} as const;

export const THROTTLE_ORDERS = {
  default: { ttl: THROTTLE_TTL_MS, limit: THROTTLE_ORDER_LIMIT },
} as const;

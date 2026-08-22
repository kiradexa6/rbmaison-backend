import { UserRole } from '../../infrastructure/supabase/types/database.types';

const ADMIN_ROLE = 'admin';
const MERCHANT_ROLE = 'merchant';
const CUSTOMER_ROLE = 'customer';

export function normalizeUserRole(
  role: string | null | undefined,
): UserRole | null {
  if (!role || typeof role !== 'string') {
    return null;
  }

  const normalized = role.trim().toLowerCase();
  if (
    normalized === ADMIN_ROLE ||
    normalized === MERCHANT_ROLE ||
    normalized === CUSTOMER_ROLE
  ) {
    return normalized;
  }

  return null;
}

export function isAdminRole(role: string | null | undefined): boolean {
  return normalizeUserRole(role) === ADMIN_ROLE;
}

export function roleMatches(
  actual: string | null | undefined,
  allowed: readonly UserRole[],
): boolean {
  const normalized = normalizeUserRole(actual);
  if (!normalized) {
    return false;
  }

  return allowed.some(
    (role) => normalizeUserRole(role) === normalized,
  );
}

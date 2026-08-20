import { createHash } from 'crypto';
import type { HistoricalCategory } from '../../infrastructure/supabase/types/database.types';

export const HISTORICAL_HISTORY_TYPES = [
  'deposits',
  'withdrawals',
  'profits',
  'orders',
  'payments',
  'billing',
  'wallet',
  'walletTransactions',
  'viewers',
] as const;

export type HistoricalHistoryType = (typeof HISTORICAL_HISTORY_TYPES)[number];

const SELECT_ALL_TYPES: HistoricalHistoryType[] = [
  'deposits',
  'withdrawals',
  'profits',
  'orders',
  'payments',
  'billing',
  'wallet',
];

export function historyTypesToCategories(
  types: readonly string[],
): HistoricalCategory[] {
  const categories = new Set<HistoricalCategory>();
  for (const type of types) {
    switch (type) {
      case 'deposits':
        categories.add('deposits');
        break;
      case 'withdrawals':
        categories.add('withdrawals');
        break;
      case 'wallet':
      case 'walletTransactions':
      case 'wallet_transactions':
        categories.add('wallet');
        break;
      case 'orders':
      case 'profits':
      case 'payments':
        categories.add('orders');
        break;
      case 'billing':
        categories.add('wallet');
        categories.add('deposits');
        categories.add('withdrawals');
        categories.add('orders');
        break;
      case 'viewers':
        categories.add('viewers');
        break;
      default:
        if (
          type === 'wallet' ||
          type === 'deposits' ||
          type === 'withdrawals' ||
          type === 'orders' ||
          type === 'viewers'
        ) {
          categories.add(type);
        }
    }
  }
  return [...categories];
}

export function categoriesToHistoryTypes(
  categories: readonly string[],
): HistoricalHistoryType[] {
  const types: HistoricalHistoryType[] = [];
  if (categories.includes('deposits')) types.push('deposits');
  if (categories.includes('withdrawals')) types.push('withdrawals');
  if (categories.includes('orders')) {
    types.push('orders', 'profits', 'payments');
  }
  if (
    categories.includes('wallet') ||
    categories.includes('deposits') ||
    categories.includes('withdrawals') ||
    categories.includes('orders')
  ) {
    types.push('billing');
  }
  if (categories.includes('wallet')) types.push('wallet');
  if (categories.includes('viewers')) types.push('viewers');
  return [...new Set(types)];
}

export function defaultHistoryTypes(
  allowedCategories: readonly string[],
): HistoricalHistoryType[] {
  return SELECT_ALL_TYPES.filter((type) =>
    historyTypesToCategories([type]).every((category) =>
      allowedCategories.includes(category),
    ),
  );
}

export function availableHistoryTypes(allowedCategories: readonly string[]) {
  return SELECT_ALL_TYPES.concat('viewers').map((id) => {
    const mapped = historyTypesToCategories([id]);
    return {
      id,
      label: historyTypeLabel(id),
      available: mapped.every((category) => allowedCategories.includes(category)),
    };
  });
}

export function historyTypeLabel(type: string): string {
  switch (type) {
    case 'wallet':
    case 'walletTransactions':
      return 'Wallet transactions';
    case 'billing':
      return 'Billing records';
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}

export function stableIdempotencyKey(
  userId: string,
  categories: readonly string[],
): string {
  const digest = createHash('sha1')
    .update([...categories].sort().join(','))
    .digest('hex')
    .slice(0, 16);
  return `hist-${userId.slice(0, 8)}-${digest}`;
}

export function sameCategorySet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

export function categoriesOverlap(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

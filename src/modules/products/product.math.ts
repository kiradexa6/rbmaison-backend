export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function wholesalePrice(salesPrice: number): number {
  return Math.round(salesPrice * 0.8 * 100) / 100;
}

export const LISTING_ACTION = {
  ADD: 'ADD TO WHOLESALE',
  LISTED: 'LISTED',
} as const;

export function listingAction(listed: boolean): string {
  return listed ? LISTING_ACTION.LISTED : LISTING_ACTION.ADD;
}

export function availableQuantity(
  quantity: number,
  reservedQuantity: number,
): number {
  return quantity - reservedQuantity;
}

export const PUBLIC_PRODUCT_HIDDEN_FIELDS = [
  'wholesale_price',
  'merchant_id',
  'merchant_profit',
  'quantity',
  'reserved_quantity',
  'available_quantity',
] as const;

export function unitProfit(salesPrice: number, wholesalePrice: number): number {
  return Math.round((salesPrice - wholesalePrice) * 100) / 100;
}

export function lineAmount(unitPrice: number, quantity: number): number {
  return Math.round(unitPrice * quantity * 100) / 100;
}

export const INSUFFICIENT_BALANCE_MESSAGE =
  'Insufficient balance. Please top up your account.';

export const ORDER_ALREADY_SETTLED_MESSAGE = 'Order already settled';

export function lineSettlement(salesPrice: number, wholesalePrice: number, quantity: number) {
  const wholesaleReturn = lineAmount(wholesalePrice, quantity);
  const profitRelease = lineAmount(unitProfit(salesPrice, wholesalePrice), quantity);
  return {
    wholesaleReturn,
    profitRelease,
    walletCredit: Math.round((wholesaleReturn + profitRelease) * 100) / 100,
  };
}

export const CUSTOMER_ORDER_HIDDEN_FIELDS = [
  'wholesale_price',
  'merchant_profit',
  'amount_required',
  'unit_profit',
] as const;

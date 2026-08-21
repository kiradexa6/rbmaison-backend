export const PAID_ORDER_STATUSES = [
  'paid',
  'processing',
  'shipping',
  'shipped',
  'delivered',
  'completed',
] as const;

export const PENDING_ORDER_STATUSES = [
  'pending',
  'awaiting_payment',
  'confirmed',
] as const;

export function utcDate(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function listingProfit(
  salesPrice: number,
  wholesalePrice: number,
): number {
  return Math.round((salesPrice - wholesalePrice) * 100) / 100;
}

export function shopProductStats(listings: Array<{ status: string }>): {
  total_products_listed: number;
  active_products: number;
  removed_products: number;
} {
  return {
    total_products_listed: listings.length,
    active_products: listings.filter((row) => row.status === 'active').length,
    removed_products: listings.filter((row) => row.status === 'removed').length,
  };
}

export function shopOrderStats(
  orders: Array<{
    status: string;
    created_at: string;
    total_amount: string | number;
  }>,
  today: string,
): {
  total_orders: number;
  todays_orders: number;
  completed_orders: number;
  pending_orders: number;
  total_sales: number;
  todays_sales: number;
} {
  const paid = (status: string) =>
    (PAID_ORDER_STATUSES as readonly string[]).includes(status);

  let totalSales = 0;
  let todaysSales = 0;

  for (const order of orders) {
    if (!paid(order.status)) {
      continue;
    }
    const amount = Number(order.total_amount);
    totalSales += amount;
    if (utcDate(order.created_at) === today) {
      todaysSales += amount;
    }
  }

  return {
    total_orders: orders.length,
    todays_orders: orders.filter((order) => utcDate(order.created_at) === today)
      .length,
    completed_orders: orders.filter(
      (order) => order.status === 'delivered' || order.status === 'completed',
    ).length,
    pending_orders: orders.filter((order) =>
      (PENDING_ORDER_STATUSES as readonly string[]).includes(order.status),
    ).length,
    total_sales: Math.round(totalSales * 100) / 100,
    todays_sales: Math.round(todaysSales * 100) / 100,
  };
}

export function shopProfitStats(
  items: Array<{
    merchant_profit: string | number;
    order_status: string;
    delivered_at: string;
  }>,
  today: string,
): { total_profit: number; todays_profit: number } {
  let total = 0;
  let todays = 0;

  for (const item of items) {
    if (
      item.order_status !== 'delivered' &&
      item.order_status !== 'completed'
    ) {
      continue;
    }
    const profit = Number(item.merchant_profit);
    total += profit;
    if (utcDate(item.delivered_at) === today) {
      todays += profit;
    }
  }

  return {
    total_profit: Math.round(total * 100) / 100,
    todays_profit: Math.round(todays * 100) / 100,
  };
}

export function shopFinancialTotals(
  transactions: Array<{
    type: string;
    amount: string | number;
    status: string;
  }>,
): {
  total_deposits: number;
  total_withdrawals: number;
  order_payments: number;
  profit_releases: number;
  refunds: number;
  wholesale_returns: number;
} {
  const sum = (type: string) =>
    Math.round(
      transactions
        .filter((row) => row.status === 'completed' && row.type === type)
        .reduce((total, row) => total + Number(row.amount), 0) * 100,
    ) / 100;

  return {
    total_deposits: sum('deposit'),
    total_withdrawals: sum('withdrawal'),
    order_payments: sum('order_payment'),
    profit_releases: sum('profit_release'),
    refunds: sum('refund'),
    wholesale_returns: sum('wholesale_return'),
  };
}

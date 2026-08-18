import {
  listingProfit,
  shopFinancialTotals,
  shopOrderStats,
  shopProductStats,
  shopProfitStats,
} from './shop.stats';

describe('shop statistics calculations', () => {
  it('counts listed, active, and removed products from listing rows', () => {
    expect(
      shopProductStats([
        { status: 'active' },
        { status: 'active' },
        { status: 'inactive' },
        { status: 'removed' },
      ]),
    ).toEqual({
      total_products_listed: 4,
      active_products: 2,
      removed_products: 1,
    });
  });

  it('calculates unit listing profit as sales minus wholesale', () => {
    expect(listingProfit(1000, 800)).toBe(200);
  });

  it('calculates order, sales, and today totals from real order rows', () => {
    expect(
      shopOrderStats(
        [
          {
            status: 'delivered',
            created_at: '2026-08-18T10:00:00.000Z',
            total_amount: '150.00',
          },
          {
            status: 'paid',
            created_at: '2026-08-18T12:00:00.000Z',
            total_amount: '50.00',
          },
          {
            status: 'pending',
            created_at: '2026-08-18T13:00:00.000Z',
            total_amount: '20.00',
          },
          {
            status: 'delivered',
            created_at: '2026-08-17T10:00:00.000Z',
            total_amount: '80.00',
          },
          {
            status: 'cancelled',
            created_at: '2026-08-18T14:00:00.000Z',
            total_amount: '999.00',
          },
        ],
        '2026-08-18',
      ),
    ).toEqual({
      total_orders: 5,
      todays_orders: 4,
      completed_orders: 2,
      pending_orders: 1,
      total_sales: 280,
      todays_sales: 200,
    });
  });

  it('counts delivered profit only, including profit delivered today', () => {
    expect(
      shopProfitStats(
        [
          {
            merchant_profit: '40.00',
            order_status: 'delivered',
            delivered_at: '2026-08-18T16:00:00.000Z',
          },
          {
            merchant_profit: '10.00',
            order_status: 'paid',
            delivered_at: '2026-08-18T16:00:00.000Z',
          },
          {
            merchant_profit: '25.00',
            order_status: 'delivered',
            delivered_at: '2026-08-17T16:00:00.000Z',
          },
        ],
        '2026-08-18',
      ),
    ).toEqual({
      total_profit: 65,
      todays_profit: 40,
    });
  });

  it('sums completed wallet ledger rows by type', () => {
    expect(
      shopFinancialTotals([
        { type: 'deposit', amount: '100.00', status: 'completed' },
        { type: 'deposit', amount: '40.00', status: 'pending' },
        { type: 'withdrawal', amount: '25.00', status: 'completed' },
        { type: 'order_payment', amount: '80.00', status: 'completed' },
        { type: 'profit_release', amount: '120.00', status: 'completed' },
        { type: 'wholesale_return', amount: '80.00', status: 'completed' },
        { type: 'refund', amount: '10.00', status: 'completed' },
        { type: 'admin_adjustment', amount: '5.00', status: 'completed' },
      ]),
    ).toEqual({
      total_deposits: 100,
      total_withdrawals: 25,
      order_payments: 80,
      profit_releases: 120,
      refunds: 10,
      wholesale_returns: 80,
    });
  });
});

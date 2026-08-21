import {
  unitProfit,
  lineAmount,
  INSUFFICIENT_BALANCE_MESSAGE,
  lineSettlement,
} from './order.math';

describe('order math', () => {
  it('calculates wholesale amount as wholesale × quantity', () => {
    expect(lineAmount(800, 1)).toBe(800);
    expect(lineAmount(800, 2)).toBe(1600);
  });

  it('calculates unit profit as sales − wholesale', () => {
    expect(unitProfit(1000, 800)).toBe(200);
  });

  it('settles each product as wholesale return + profit credit', () => {
    expect(lineSettlement(1000, 800, 1)).toEqual({
      wholesaleReturn: 800,
      profitRelease: 200,
      walletCredit: 1000,
    });
    expect(lineSettlement(600, 500, 1)).toEqual({
      wholesaleReturn: 500,
      profitRelease: 100,
      walletCredit: 600,
    });
  });

  it('uses the production insufficient-balance message', () => {
    expect(INSUFFICIENT_BALANCE_MESSAGE).toBe(
      'Insufficient balance. Please top up your account.',
    );
  });
});

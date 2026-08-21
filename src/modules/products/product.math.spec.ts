import {
  wholesalePrice,
  availableQuantity,
  slugify,
  listingAction,
} from './product.math';

describe('product math', () => {
  it('calculates wholesale as 20% off sales price on the server', () => {
    expect(wholesalePrice(1000)).toBe(800);
    expect(wholesalePrice(99.99)).toBe(79.99);
  });

  it('maps listing state to ADD TO WHOLESALE or LISTED', () => {
    expect(listingAction(false)).toBe('ADD TO WHOLESALE');
    expect(listingAction(true)).toBe('LISTED');
  });

  it('never treats reserved stock as available', () => {
    expect(availableQuantity(10, 3)).toBe(7);
    expect(availableQuantity(0, 0)).toBe(0);
  });

  it('slugifies product names', () => {
    expect(slugify('Women Leather Tote')).toBe('women-leather-tote');
  });
});

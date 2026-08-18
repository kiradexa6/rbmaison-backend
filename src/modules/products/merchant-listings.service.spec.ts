import { ConflictException, ValidationPipe } from '@nestjs/common';
import { MerchantListingsService } from './merchant-listings.service';
import { CreateListingDto, PreviewListingDto } from './dto/product.dto';
import { listingAction, wholesalePrice } from './product.math';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { mapSupabaseError } from './supabase-error';

const merchant: AuthenticatedUser = {
  id: '55555555-5555-4555-8555-555555555555',
  email: 'merchant@rbmaison.test',
  role: 'merchant',
  status: 'active',
  accessToken: 'merchant-token',
};

const otherMerchant: AuthenticatedUser = {
  id: '88888888-8888-4888-8888-888888888888',
  email: 'other@rbmaison.test',
  role: 'merchant',
  status: 'active',
  accessToken: 'other-merchant-token',
};

const productId = '22222222-2222-4222-8222-222222222222';
const listingId = '66666666-6666-4666-8666-666666666666';

function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: listingId,
    merchant_id: '77777777-7777-4777-8777-777777777777',
    product_id: productId,
    sales_price: '1000.00',
    sales_price_snapshot: '1000.00',
    wholesale_price: '800.00',
    discount_percentage: '20.00',
    status: 'active',
    created_at: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

function listedProduct(overrides: Record<string, unknown> = {}) {
  return {
    listing_id: listingId,
    product_id: productId,
    product_name: 'Maison Tote',
    product_slug: 'maison-tote',
    brand_name: 'Maison',
    category_name: 'Tote Bags',
    primary_image_url: 'https://cdn/tote.jpg',
    sales_price: '1000.00',
    sales_price_snapshot: '1000.00',
    wholesale_price: '800.00',
    listing_status: 'active',
    listed_at: '2026-08-18T00:00:00.000Z',
    ...overrides,
  };
}

describe('MerchantListingsService', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  it('creates a listing from product id only and snapshots server wholesale 1000 → 800', async () => {
    const listing = listingRow();
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: listing, error: null }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new MerchantListingsService({
      isConfigured: () => true,
      asUser,
      getAdminClient: jest.fn(),
    } as never);

    const result = await service.createListing(merchant, { productId });

    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('create_merchant_listing', {
      p_product_id: productId,
    });
    expect(Object.keys(client.rpc.mock.calls[0][1])).toEqual(['p_product_id']);
    expect(result.wholesale_price).toBe('800.00');
    expect(result.status).toBe('active');
    expect(result.action).toBe(listingAction(true));
    expect(wholesalePrice(1000)).toBe(800);
  });

  it('rejects client wholesale_price and salesPrice on create and preview DTOs', async () => {
    await expect(
      pipe.transform(
        {
          productId,
          salesPrice: 1000,
          wholesale_price: 1,
        },
        { type: 'body', metatype: CreateListingDto },
      ),
    ).rejects.toThrow();

    await expect(
      pipe.transform(
        { productId, wholesale_price: 1, sales_price: 900 },
        { type: 'body', metatype: PreviewListingDto },
      ),
    ).rejects.toThrow();
  });

  it('prevents duplicate listings', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Product is already listed', code: 'P0001' },
      }),
    };
    const service = new MerchantListingsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await expect(
      service.createListing(merchant, { productId }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(
      mapSupabaseError(
        { message: 'duplicate key value violates unique constraint', code: '23505' },
        'not found',
      ),
    ).toBeInstanceOf(ConflictException);
  });

  it('previews wholesale from catalogue sales price without accepting a client price', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          {
            product_id: productId,
            product_name: 'Maison Tote',
            brand_name: 'Maison',
            category_name: 'Tote Bags',
            primary_image_url: 'https://cdn/tote.jpg',
            sales_price: '1000.00',
            wholesale_price: '800.00',
            discount_percentage: '20.00',
            listed: false,
            listing_id: null,
            listing_status: null,
          },
        ],
        error: null,
      }),
    };
    const service = new MerchantListingsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const preview = await service.previewListing(merchant, { productId });

    expect(client.rpc).toHaveBeenCalledWith('preview_merchant_listing', {
      p_product_id: productId,
    });
    expect(preview.sales_price).toBe('1000.00');
    expect(preview.wholesale_price).toBe('800.00');
    expect(preview.expected_wholesale_price).toBe('800.00');
    expect(preview.action).toBe('ADD TO WHOLESALE');
  });

  it('marks already-listed catalogue rows as LISTED', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          {
            id: productId,
            name: 'Maison Tote',
            sales_price: '1000.00',
            wholesale_price: '800.00',
            listed: true,
            listing_id: listingId,
            listing_status: 'active',
          },
        ],
        error: null,
      }),
    };
    const service = new MerchantListingsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const rows = await service.wholesaleCatalogue(merchant, {});
    expect(client.rpc).toHaveBeenCalledWith(
      'merchant_wholesale_catalog',
      expect.any(Object),
    );
    expect(rows[0].action).toBe('LISTED');
  });

  it('isolates merchants by using the caller JWT and never an admin client', async () => {
    const merchantClient = {
      rpc: jest.fn().mockResolvedValue({
        data: [listedProduct()],
        error: null,
      }),
    };
    const otherClient = {
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const getAdminClient = jest.fn();
    const asUser = jest.fn((token: string) =>
      token === merchant.accessToken ? merchantClient : otherClient,
    );
    const service = new MerchantListingsService({
      isConfigured: () => true,
      asUser,
      getAdminClient,
    } as never);

    const own = await service.myProducts(merchant);
    const other = await service.myProducts(otherMerchant);

    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(asUser).toHaveBeenCalledWith(otherMerchant.accessToken);
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(merchantClient.rpc).toHaveBeenCalledWith('merchant_listed_products');
    expect(merchantClient.rpc.mock.calls[0][1]).toBeUndefined();
    expect(own).toHaveLength(1);
    expect(other).toEqual([]);
  });

  it('shows the product in merchant product management after listing', async () => {
    const created = listingRow();
    const client = {
      rpc: jest
        .fn()
        .mockResolvedValueOnce({ data: created, error: null })
        .mockResolvedValueOnce({ data: [listedProduct()], error: null }),
    };
    const service = new MerchantListingsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.createListing(merchant, { productId });
    const products = await service.myProducts(merchant);

    expect(products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          listing_id: listingId,
          product_id: productId,
          product_name: 'Maison Tote',
          brand_name: 'Maison',
          category_name: 'Tote Bags',
          sales_price: '1000.00',
          wholesale_price: '800.00',
          listing_status: 'active',
        }),
      ]),
    );
  });

  it('removes a listing so it no longer appears in product management', async () => {
    const client = {
      rpc: jest
        .fn()
        .mockResolvedValueOnce({
          data: listingRow({ status: 'removed' }),
          error: null,
        })
        .mockResolvedValueOnce({ data: [], error: null }),
    };
    const service = new MerchantListingsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const removed = await service.removeListing(merchant, listingId);
    const remaining = await service.myProducts(merchant);

    expect(client.rpc).toHaveBeenNthCalledWith(1, 'remove_merchant_listing', {
      p_listing_id: listingId,
    });
    expect(removed.status).toBe('removed');
    expect(remaining).toEqual([]);
  });
});

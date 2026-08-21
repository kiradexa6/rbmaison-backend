import { AdminProductsService } from './admin-products.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

function mockClient(result: {
  data: unknown;
  error: null | { message: string; code?: string };
}) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
    single: jest.fn().mockResolvedValue(result),
  };
  return {
    from: jest.fn().mockReturnValue(builder),
    rpc: jest.fn().mockResolvedValue(result),
    builder,
  };
}

const admin: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@rbmaison.test',
  role: 'admin',
  status: 'active',
  accessToken: 'admin-token',
};

describe('AdminProductsService', () => {
  it('creates a draft unpublished product', async () => {
    const created = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Maison Tote',
      slug: 'maison-tote',
      status: 'draft',
      published: false,
    };
    const client = mockClient({ data: created, error: null });
    const service = new AdminProductsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.createProduct(admin, {
      name: 'Maison Tote',
      brandId: '33333333-3333-4333-8333-333333333333',
      categoryId: '44444444-4444-4444-8444-444444444444',
      price: 1200,
    });

    expect(client.from).toHaveBeenCalledWith('products');
    expect(client.builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Maison Tote',
        slug: 'maison-tote',
        published: false,
        status: 'draft',
        price: '1200.00',
      }),
    );
    expect(result).toEqual(created);
  });

  it('updates product fields without allowing merchant ownership', async () => {
    const client = mockClient({
      data: { id: '22222222-2222-4222-8222-222222222222', name: 'Updated' },
      error: null,
    });
    const service = new AdminProductsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.updateProduct(admin, createdId(), {
      name: 'Updated',
      price: 1500,
    });

    expect(client.builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated', price: '1500.00' }),
    );
    expect(client.builder.update.mock.calls[0][0]).not.toHaveProperty(
      'merchant_id',
    );
  });

  it('publishes through the admin RPC', async () => {
    const client = mockClient({
      data: { published: true, status: 'active' },
      error: null,
    });
    const service = new AdminProductsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.publish(admin, createdId());
    expect(client.rpc).toHaveBeenCalledWith('admin_set_product_publication', {
      p_product_id: createdId(),
      p_published: true,
    });
  });

  it('creates variants with optional price override', async () => {
    const client = mockClient({
      data: { sku: 'RB-TOTE-BLK-M', is_active: true },
      error: null,
    });
    const service = new AdminProductsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.addVariant(admin, createdId(), {
      sku: 'RB-TOTE-BLK-M',
      size: 'M',
      color: 'black',
      priceOverride: 1300,
    });

    expect(client.from).toHaveBeenCalledWith('product_variants');
    expect(client.builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        sku: 'RB-TOTE-BLK-M',
        size: 'M',
        color: 'black',
        price_override: '1300.00',
        is_active: true,
      }),
    );
  });

  it('adjusts inventory through the ledger RPC', async () => {
    const client = mockClient({
      data: { quantity: 8, reserved_quantity: 0, available_quantity: 8 },
      error: null,
    });
    const service = new AdminProductsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.adjustInventory(admin, createdId(), {
      type: 'stock_added',
      quantity: 8,
      reference: 'intake-1',
    });

    expect(client.rpc).toHaveBeenCalledWith('admin_adjust_inventory', {
      p_variant_id: createdId(),
      p_type: 'stock_added',
      p_quantity: 8,
      p_reference: 'intake-1',
    });
  });

  it('adds images with ordering and primary flag', async () => {
    const client = mockClient({
      data: { is_primary: true, position: 0 },
      error: null,
    });
    const service = new AdminProductsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await service.addImage(admin, createdId(), {
      storagePath: `${createdId()}/hero.webp`,
      imageUrl: 'https://cdn/hero.webp',
      isPrimary: true,
      position: 0,
    });

    expect(client.from).toHaveBeenCalledWith('product_images');
    expect(client.builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        is_primary: true,
        position: 0,
        storage_path: `${createdId()}/hero.webp`,
      }),
    );
  });
});

function createdId() {
  return '22222222-2222-4222-8222-222222222222';
}

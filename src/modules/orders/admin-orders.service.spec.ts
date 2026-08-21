import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminOrdersService } from './admin-orders.service';

const admin: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@rbmaison.test',
  role: 'admin',
  status: 'active',
  accessToken: 'admin-token',
};

describe('AdminOrdersService shipment queue', () => {
  it('returns shipping and shipped customer and merchant orders', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            order_id: 'order-shipping',
            store_id: 'store-id',
            store_name: 'Maison',
            merchant_id: 'merchant-id',
            merchant_name: 'Owner',
            customer_id: 'customer-id',
            customer_name: 'Buyer',
            customer_email: 'buyer@test',
            status: 'shipping',
            total_amount: '100.00',
            currency: 'USD',
            created_at: '2026-08-18T00:00:00.000Z',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [
          {
            order_id: 'merchant-order-shipped',
            store_id: 'store-id',
            store_name: 'Maison',
            merchant_id: 'merchant-id',
            merchant_name: 'Owner',
            customer_id: 'customer-id',
            customer_name: 'Buyer',
            customer_email: 'buyer@test',
            status: 'shipped',
            total_amount: '200.00',
            currency: 'USD',
            created_at: '2026-08-18T00:00:00.000Z',
            amount_paid: '200.00',
            item_id: 'item-id',
            listing_id: 'listing-id',
            product_id: 'product-id',
            product_name: 'Bag',
            primary_image_url: null,
            quantity: 1,
            sales_price: '200.00',
            wholesale_price: '160.00',
            unit_profit: '40.00',
            merchant_profit: '40.00',
            amount_required: '160.00',
          },
        ],
        error: null,
      });

    const asUser = jest.fn().mockReturnValue({ rpc });
    const service = new AdminOrdersService({
      isConfigured: () => true,
      asUser,
    } as never);

    const result = await service.getShipmentQueue(admin);

    expect(asUser).toHaveBeenCalledWith(admin.accessToken);
    expect(rpc).toHaveBeenCalledWith('admin_search_orders', {
      p_order_id: undefined,
      p_store_id: undefined,
      p_merchant_query: undefined,
      p_customer_query: undefined,
      p_status: 'shipping',
    });
    expect(rpc).toHaveBeenCalledWith('admin_search_orders', {
      p_order_id: undefined,
      p_store_id: undefined,
      p_merchant_query: undefined,
      p_customer_query: undefined,
      p_status: 'shipped',
    });
    expect(rpc).toHaveBeenCalledWith('admin_merchant_orders', {});
    expect(result.customerOrders).toHaveLength(1);
    expect(result.merchantOrders).toHaveLength(1);
    expect(result.summary.totalCount).toBe(2);
  });
});

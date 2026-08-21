import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AdminWalletsService } from './admin-wallets.service';
import { MerchantWalletsService } from './merchant-wallets.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { mapSupabaseError } from '../products/supabase-error';
import { RolesGuard } from '../auth/guards/roles.guard';

const admin: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'admin@rbmaison.test',
  role: 'admin',
  status: 'active',
  accessToken: 'admin-token',
};

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

const addressId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const depositId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const withdrawalId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const merchantId = '77777777-7777-4777-8777-777777777777';

function addressRow(status: 'active' | 'disabled' = 'active') {
  return {
    id: addressId,
    asset: 'USDT',
    network: 'trc20',
    wallet_address: 'TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    status,
    created_by: admin.id,
  };
}

describe('AdminWalletsService', () => {
  it('adds an admin deposit wallet', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: addressRow(), error: null }),
    };
    const asUser = jest.fn().mockReturnValue(client);
    const service = new AdminWalletsService({
      isConfigured: () => true,
      asUser,
      getAdminClient: jest.fn(),
    } as never);

    const result = await service.addAddress(admin, {
      asset: 'USDT',
      network: 'trc20',
      walletAddress: 'TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });

    expect(asUser).toHaveBeenCalledWith(admin.accessToken);
    expect(client.rpc).toHaveBeenCalledWith('admin_add_wallet_address', {
      p_asset: 'USDT',
      p_network: 'trc20',
      p_wallet_address: 'TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    });
    expect(result.status).toBe('active');
  });

  it('approves a deposit by creating a deposit ledger row', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: depositId, status: 'approved', amount: '1000' },
        error: null,
      }),
    };
    const service = new AdminWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.approveDeposit(admin, depositId);
    expect(client.rpc).toHaveBeenCalledWith('admin_approve_deposit', {
      p_request_id: depositId,
    });
    expect(result.status).toBe('approved');
  });

  it('rejects a deposit without creating a ledger credit', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: depositId, status: 'rejected' },
        error: null,
      }),
    };
    const service = new AdminWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.rejectDeposit(admin, depositId);
    expect(client.rpc).toHaveBeenCalledWith('admin_reject_deposit', {
      p_request_id: depositId,
    });
    expect(result.status).toBe('rejected');
  });

  it('approves a withdrawal through the ledger RPC', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: { id: withdrawalId, status: 'completed', amount: '1000' },
        error: null,
      }),
    };
    const service = new AdminWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.approveWithdrawal(admin, withdrawalId);
    expect(client.rpc).toHaveBeenCalledWith('admin_approve_withdrawal', {
      p_request_id: withdrawalId,
    });
    expect(result.status).toBe('completed');
  });

  it('searches wallet transactions through admin RPC', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: [
          {
            transaction_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            merchant_id: merchantId,
            type: 'deposit',
            amount: '1000',
            currency: 'USDT',
            status: 'completed',
          },
        ],
        error: null,
      }),
    };
    const service = new AdminWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const rows = await service.searchTransactions(admin, {
      currency: 'USDT',
      type: 'deposit',
    });

    expect(client.rpc).toHaveBeenCalledWith(
      'admin_search_wallet_transactions',
      expect.objectContaining({
        p_currency: 'USDT',
        p_type: 'deposit',
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it('blocks merchants from admin wallet routes', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['admin']),
    };
    const guard = new RolesGuard(reflector as never);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user: merchant }),
      }),
    };
    expect(() => guard.canActivate(context as never)).toThrow(
      ForbiddenException,
    );
  });
});

describe('MerchantWalletsService', () => {
  it('hides disabled deposit wallets from merchants', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const service = new MerchantWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await expect(
      service.depositAddress(merchant, { asset: 'USDT', network: 'trc20' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(client.rpc).toHaveBeenCalledWith('merchant_deposit_addresses', {
      p_asset: 'USDT',
      p_network: 'trc20',
    });
  });

  it('creates a merchant deposit request against the displayed address', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: {
          id: depositId,
          merchant_id: merchantId,
          amount: '1000',
          asset: 'USDT',
          network: 'trc20',
          wallet_address_used: 'TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
          status: 'pending',
        },
        error: null,
      }),
    };
    const service = new MerchantWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.createDeposit(merchant, {
      amount: 1000,
      asset: 'USDT',
      network: 'trc20',
    });

    expect(client.rpc).toHaveBeenCalledWith('create_deposit_request', {
      p_amount: 1000,
      p_asset: 'USDT',
      p_network: 'trc20',
    });
    expect(result.status).toBe('pending');
    expect(result.wallet_address_used).toBe('TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  });

  it('creates a withdrawal request without debiting the ledger', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: {
          id: withdrawalId,
          status: 'pending',
          amount: '500',
        },
        error: null,
      }),
    };
    const service = new MerchantWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    const result = await service.createWithdrawal(merchant, {
      asset: 'USDT',
      network: 'trc20',
      amount: 500,
      destinationAddress: 'TYyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
    });

    expect(client.rpc).toHaveBeenCalledWith('create_withdrawal_request', {
      p_asset: 'USDT',
      p_network: 'trc20',
      p_amount: 500,
      p_destination_address: 'TYyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
    });
    expect(result.status).toBe('pending');
  });

  it('blocks withdrawals when the balance is insufficient', async () => {
    const client = {
      rpc: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'Insufficient balance.', code: 'P0001' },
      }),
    };
    const service = new MerchantWalletsService({
      isConfigured: () => true,
      asUser: jest.fn().mockReturnValue(client),
    } as never);

    await expect(
      service.createWithdrawal(merchant, {
        asset: 'USDT',
        network: 'trc20',
        amount: 5000,
        destinationAddress: 'TYyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(
      mapSupabaseError(
        { message: 'Insufficient balance.', code: 'P0001' },
        'not found',
      ).message,
    ).toBe('Insufficient balance.');
  });

  it('isolates merchants by caller JWT and never uses the admin client', async () => {
    const merchantBuilder = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({
        data: [{ id: 'wallet-1', currency: 'USDT', balance: '1000' }],
        error: null,
      }),
    };
    const otherBuilder = {
      select: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const merchantClient = {
      from: jest.fn().mockReturnValue(merchantBuilder),
      rpc: jest.fn(),
    };
    const otherClient = {
      from: jest.fn().mockReturnValue(otherBuilder),
      rpc: jest.fn(),
    };
    const getAdminClient = jest.fn();
    const asUser = jest.fn((token: string) =>
      token === merchant.accessToken ? merchantClient : otherClient,
    );
    const service = new MerchantWalletsService({
      isConfigured: () => true,
      asUser,
      getAdminClient,
    } as never);

    const own = await service.getWallets(merchant);
    const other = await service.getWallets(otherMerchant);

    expect(asUser).toHaveBeenCalledWith(merchant.accessToken);
    expect(asUser).toHaveBeenCalledWith(otherMerchant.accessToken);
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(own).toHaveLength(1);
    expect(other).toEqual([]);
  });
});

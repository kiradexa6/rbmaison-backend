import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  AddWalletAddressDto,
  AdjustMerchantWalletDto,
  AdminDepositSearchQueryDto,
  AdminWithdrawalSearchQueryDto,
  UpdateWalletAddressDto,
} from './dto/wallet.dto';
import type { WalletAddressStatus } from '../../infrastructure/supabase/types/database.types';

@Injectable()
export class AdminWalletsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async listAddresses(user: AuthenticatedUser) {
    const { data, error } = await this.client(user)
      .from('admin_wallet_addresses')
      .select(
        'id, asset, network, wallet_address, status, created_by, created_at, updated_at',
      )
      .order('created_at', { ascending: false });
    return assertSupabase({ data, error }) ?? [];
  }

  async addAddress(user: AuthenticatedUser, dto: AddWalletAddressDto) {
    const { data, error } = await this.client(user).rpc(
      'admin_add_wallet_address',
      {
        p_asset: dto.asset,
        p_network: dto.network,
        p_wallet_address: dto.walletAddress.trim(),
      },
    );
    return assertSupabase({ data, error });
  }

  async updateAddress(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateWalletAddressDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_update_wallet_address',
      {
        p_id: id,
        p_wallet_address: dto.walletAddress?.trim(),
        p_network: dto.network,
      },
    );
    return assertSupabase({ data, error }, 'Wallet address not found');
  }

  async setAddressStatus(
    user: AuthenticatedUser,
    id: string,
    status: WalletAddressStatus,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_set_wallet_address_status',
      { p_id: id, p_status: status },
    );
    return assertSupabase({ data, error }, 'Wallet address not found');
  }

  async deleteAddress(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_delete_wallet_address',
      { p_id: id },
    );
    return assertSupabase({ data, error }, 'Wallet address not found');
  }

  async searchDeposits(
    user: AuthenticatedUser,
    query: AdminDepositSearchQueryDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_search_deposits',
      {
        p_status: query.status ?? undefined,
        p_store_id: query.storeId ?? undefined,
        p_merchant_query: query.merchant ?? undefined,
      },
    );
    return assertSupabase({ data, error }) ?? [];
  }

  async approveDeposit(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_approve_deposit',
      { p_request_id: id },
    );
    return assertSupabase({ data, error }, 'Deposit request not found');
  }

  async rejectDeposit(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.client(user).rpc('admin_reject_deposit', {
      p_request_id: id,
    });
    return assertSupabase({ data, error }, 'Deposit request not found');
  }

  async searchWithdrawals(
    user: AuthenticatedUser,
    query: AdminWithdrawalSearchQueryDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_search_withdrawals',
      {
        p_status: query.status ?? undefined,
        p_store_id: query.storeId ?? undefined,
        p_merchant_query: query.merchant ?? undefined,
      },
    );
    return assertSupabase({ data, error }) ?? [];
  }

  async approveWithdrawal(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_approve_withdrawal',
      { p_request_id: id },
    );
    return assertSupabase({ data, error }, 'Withdrawal request not found');
  }

  async rejectWithdrawal(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_reject_withdrawal',
      { p_request_id: id },
    );
    return assertSupabase({ data, error }, 'Withdrawal request not found');
  }

  async adjustMerchantWallet(
    user: AuthenticatedUser,
    merchantId: string,
    dto: AdjustMerchantWalletDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_adjust_merchant_wallet',
      {
        p_merchant_id: merchantId,
        p_currency: dto.currency,
        p_amount: dto.amount,
        p_direction: dto.direction,
        p_reason: dto.reason.trim(),
      },
    );
    return assertSupabase({ data, error }, 'Merchant wallet not found');
  }

  async getAddress(user: AuthenticatedUser, id: string) {
    const rows = await this.listAddresses(user);
    const row = rows.find((item) => item.id === id);
    if (!row) {
      throw new NotFoundException('Wallet address not found');
    }
    return row;
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}

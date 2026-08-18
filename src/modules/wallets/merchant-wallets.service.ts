import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  CreateDepositRequestDto,
  CreateWithdrawalRequestDto,
  DepositAddressQueryDto,
} from './dto/wallet.dto';

@Injectable()
export class MerchantWalletsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getWallets(user: AuthenticatedUser) {
    const { data, error } = await this.client(user)
      .from('wallets')
      .select('id, currency, balance, updated_at')
      .order('currency');
    return assertSupabase({ data, error }) ?? [];
  }

  async history(user: AuthenticatedUser) {
    const wallets = await this.getWallets(user);
    const ids = wallets.map((wallet) => wallet.id);
    if (ids.length === 0) {
      return [];
    }

    const { data, error } = await this.client(user)
      .from('wallet_transactions')
      .select(
        'id, wallet_id, type, amount, currency, direction, status, reference_type, reference_id, description, created_at',
      )
      .in('wallet_id', ids)
      .order('created_at', { ascending: false });
    return assertSupabase({ data, error }) ?? [];
  }

  async depositAddress(user: AuthenticatedUser, query: DepositAddressQueryDto) {
    const { data, error } = await this.client(user).rpc(
      'merchant_deposit_addresses',
      { p_asset: query.asset, p_network: query.network },
    );
    const rows = assertSupabase({ data, error }) ?? [];
    const address = rows[0];
    if (!address) {
      throw new NotFoundException(
        'No deposit address available for this asset and network',
      );
    }
    return address;
  }

  async createDeposit(user: AuthenticatedUser, dto: CreateDepositRequestDto) {
    const { data, error } = await this.client(user).rpc(
      'create_deposit_request',
      {
        p_amount: dto.amount,
        p_asset: dto.asset,
        p_network: dto.network,
      },
    );
    return assertSupabase({ data, error });
  }

  async myDeposits(user: AuthenticatedUser) {
    const { data, error } = await this.client(user)
      .from('wallet_deposit_requests')
      .select(
        'id, asset, network, amount, wallet_address_used, status, created_at, reviewed_at',
      )
      .order('created_at', { ascending: false });
    return assertSupabase({ data, error }) ?? [];
  }

  async createWithdrawal(
    user: AuthenticatedUser,
    dto: CreateWithdrawalRequestDto,
  ) {
    const { data, error } = await this.client(user).rpc(
      'create_withdrawal_request',
      {
        p_asset: dto.asset,
        p_network: dto.network,
        p_amount: dto.amount,
        p_destination_address: dto.destinationAddress,
      },
    );
    return assertSupabase({ data, error });
  }

  async myWithdrawals(user: AuthenticatedUser) {
    const { data, error } = await this.client(user)
      .from('withdrawal_requests')
      .select(
        'id, asset, network, amount, destination_address, status, created_at, reviewed_at',
      )
      .order('created_at', { ascending: false });
    return assertSupabase({ data, error }) ?? [];
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}

import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import { AdminSearchUsersQueryDto } from './dto/merchant.dto';

@Injectable()
export class AdminUsersService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async search(user: AuthenticatedUser, query: AdminSearchUsersQueryDto) {
    const { data, error } = await this.client(user).rpc('admin_search_users', {
      p_email: query.email ?? undefined,
      p_user_id: query.userId ?? undefined,
      p_store_id: query.storeId ?? undefined,
      p_merchant_id: query.merchantId ?? undefined,
      p_query: query.q ?? undefined,
    });
    return assertSupabase({ data, error }) ?? [];
  }

  async get(user: AuthenticatedUser, userId: string) {
    const rows = await this.search(user, { userId });
    const profile = rows[0];
    if (!profile) {
      throw new NotFoundException('User not found');
    }
    return profile;
  }

  async suspend(user: AuthenticatedUser, userId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_set_user_status',
      { p_user_id: userId, p_status: 'suspended' },
    );
    return assertSupabase({ data, error }, 'User not found');
  }

  async restore(user: AuthenticatedUser, userId: string) {
    const { data, error } = await this.client(user).rpc(
      'admin_set_user_status',
      { p_user_id: userId, p_status: 'active' },
    );
    return assertSupabase({ data, error }, 'User not found');
  }

  async activityLogs(
    user: AuthenticatedUser,
    query: { action?: string; targetType?: string },
  ) {
    const { data, error } = await this.client(user).rpc(
      'admin_search_activity_logs',
      {
        p_action: query.action ?? undefined,
        p_target_type: query.targetType ?? undefined,
      },
    );
    return assertSupabase({ data, error }) ?? [];
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}

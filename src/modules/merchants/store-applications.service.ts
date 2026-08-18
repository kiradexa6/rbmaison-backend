import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import { SubmitMerchantApplicationDto } from './dto/merchant.dto';

@Injectable()
export class StoreApplicationsService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(user: AuthenticatedUser, dto: SubmitMerchantApplicationDto) {
    const documents = (dto.documents ?? []).map((item) => item.trim());
    const { data, error } = await this.client(user).rpc(
      'submit_merchant_application',
      {
        p_store_name: dto.storeName.trim(),
        p_business_description: dto.businessDescription?.trim() || undefined,
        p_country: dto.country?.trim() || undefined,
        p_documents: documents,
      },
    );
    return assertSupabase({ data, error });
  }

  async mine(user: AuthenticatedUser) {
    const { data, error } = await this.client(user).rpc(
      'my_merchant_applications',
    );
    return assertSupabase({ data, error }) ?? [];
  }

  async latest(user: AuthenticatedUser) {
    const rows = await this.mine(user);
    const application = rows[0];
    if (!application) {
      throw new NotFoundException('Store application not found');
    }
    return application;
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}

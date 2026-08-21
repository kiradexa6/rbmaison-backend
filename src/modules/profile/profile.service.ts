import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { Database } from '../../infrastructure/supabase/types/database.types';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import { UpdateProfileDto } from './dto/profile.dto';

@Injectable()
export class ProfileService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getMine(user: AuthenticatedUser) {
    const { data, error } = await this.client(user)
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    const profile = assertSupabase({ data, error }, 'Profile not found');
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return profile;
  }

  async updateMine(user: AuthenticatedUser, dto: UpdateProfileDto) {
    const patch: Database['public']['Tables']['profiles']['Update'] = {};
    if (dto.fullName !== undefined) {
      patch.full_name = dto.fullName.trim();
    }
    if (dto.phone !== undefined) {
      patch.phone = dto.phone.trim();
    }
    if (dto.country !== undefined) {
      patch.country = dto.country.trim();
    }
    if (dto.avatar !== undefined) {
      patch.avatar = dto.avatar.trim();
    }

    const { data, error } = await this.client(user)
      .from('profiles')
      .update(patch)
      .eq('user_id', user.id)
      .select()
      .maybeSingle();

    const row = assertSupabase({ data, error }, 'Profile not found');
    if (!row) {
      throw new NotFoundException('Profile not found');
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

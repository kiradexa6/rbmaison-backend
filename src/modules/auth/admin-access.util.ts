import { ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { isAdminRole, normalizeUserRole } from './role.util';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface';

export async function assertAdminProfile(
  supabaseService: SupabaseService,
  user: AuthenticatedUser,
): Promise<void> {
  const { data, error } = await supabaseService
    .getAdminClient()
    .from('profiles')
    .select('role, status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) {
    throw new ForbiddenException('Administrator access required.');
  }

  const role = normalizeUserRole(data.role);
  if (data.status !== 'active' || !isAdminRole(role)) {
    throw new ForbiddenException('Administrator access required.');
  }
}

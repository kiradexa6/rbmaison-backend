import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../../infrastructure/supabase/types/database.types';

export const ROLES_KEY = 'roles';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

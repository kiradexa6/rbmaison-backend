import { UserRole } from '../../../infrastructure/supabase/types/database.types';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  status: string;
  accessToken: string;
}

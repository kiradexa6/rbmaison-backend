import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { UserRole } from '../../infrastructure/supabase/types/database.types';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { LoginDto, RefreshTokenDto, SignupDto } from './dto/auth.dto';

type AuthProfile = {
  role: UserRole;
  status: string;
};

@Injectable()
export class AuthService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async signup(dto: SignupDto) {
    const client = this.anon();
    const { data, error } = await client.auth.signUp({
      email: dto.email,
      password: dto.password,
    });

    if (error) {
      throw this.mapAuthError(error.message);
    }

    const profile = data.user
      ? await this.loadProfile(data.user.id).catch(() => null)
      : null;

    return {
      user: data.user
        ? {
            id: data.user.id,
            email: data.user.email ?? dto.email,
            role: profile?.role ?? 'customer',
            status: profile?.status ?? 'pending',
          }
        : null,
      session: data.session
        ? {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
            expiresAt: data.session.expires_at ?? null,
          }
        : null,
    };
  }

  async login(dto: LoginDto) {
    const client = this.anon();
    const { data, error } = await client.auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    if (error || !data.session || !data.user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const profile = await this.loadProfile(data.user.id);

    if (profile.status !== 'active') {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? dto.email,
        role: profile.role,
        status: profile.status,
      },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
      },
    };
  }

  async refresh(dto: RefreshTokenDto) {
    const client = this.anon();
    const { data, error } = await client.auth.refreshSession({
      refresh_token: dto.refreshToken,
    });

    if (error || !data.session || !data.user) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const profile = await this.loadProfile(data.user.id);

    if (profile.status !== 'active') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? '',
        role: profile.role,
        status: profile.status,
      },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
      },
    };
  }

  session(user: AuthenticatedUser) {
    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
      },
      session: {
        accessToken: user.accessToken,
      },
    };
  }

  async logout(user: AuthenticatedUser) {
    const { error } = await this.supabaseService
      .asUser(user.accessToken)
      .auth.signOut();

    if (error) {
      throw new UnauthorizedException('Unable to log out');
    }

    return { loggedOut: true };
  }

  private async loadProfile(userId: string): Promise<AuthProfile> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('role, status')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      role: data.role,
      status: data.status,
    };
  }

  private anon() {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }

    return this.supabaseService.getAnonClient();
  }

  private mapAuthError(message: string) {
    const lower = message.toLowerCase();
    if (
      lower.includes('already registered') ||
      lower.includes('already exists')
    ) {
      return new ConflictException('An account with this email already exists');
    }
    if (lower.includes('invalid') || lower.includes('credentials')) {
      return new UnauthorizedException('Invalid email or password');
    }
    return new UnauthorizedException(message);
  }
}

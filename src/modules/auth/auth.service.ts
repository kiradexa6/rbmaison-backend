import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { LoginDto, SignupDto } from './dto/auth.dto';

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

    return {
      user: data.user
        ? { id: data.user.id, email: data.user.email ?? dto.email }
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

    return {
      user: { id: data.user.id, email: data.user.email ?? dto.email },
      session: {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: data.session.expires_at ?? null,
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

  private anon() {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }

    return this.supabaseService.getAnonClient();
  }

  private mapAuthError(message: string) {
    const lower = message.toLowerCase();
    if (lower.includes('already registered') || lower.includes('already exists')) {
      return new ConflictException('An account with this email already exists');
    }
    if (lower.includes('invalid') || lower.includes('credentials')) {
      return new UnauthorizedException('Invalid email or password');
    }
    return new UnauthorizedException(message);
  }
}

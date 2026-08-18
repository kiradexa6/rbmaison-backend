import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { UserRole } from '../../../infrastructure/supabase/types/database.types';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }

    const request = context.switchToHttp().getRequest<
      Request & { user?: AuthenticatedUser }
    >();

    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ')
      ? header.slice('Bearer '.length).trim()
      : undefined;

    if (!token) {
      this.logUnauthorized(request, 'missing token');
      throw new UnauthorizedException('Unauthorized');
    }

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .auth.getUser(token);

    if (error || !data.user) {
      this.logUnauthorized(request, 'invalid token');
      throw new UnauthorizedException('Unauthorized');
    }
    const asUser = this.supabaseService.asUser(token);
    const { data: profile, error: profileError } = await asUser
      .from('profiles')
      .select('role, status')
      .eq('user_id', data.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      this.logUnauthorized(request, 'profile not found');
      throw new UnauthorizedException('Unauthorized');
    }

    if (profile.status !== 'active') {
      this.logUnauthorized(request, 'inactive account');
      throw new UnauthorizedException('Unauthorized');
    }

    request.user = {
      id: data.user.id,
      email: data.user.email ?? '',
      role: profile.role as UserRole,
      status: profile.status,
      accessToken: token,
    };

    return true;
  }

  private logUnauthorized(request: Request, reason: string): void {
    this.logger.warn(
      `Failed authorization attempt ${request.method} ${request.originalUrl ?? request.url} ip=${request.ip} reason=${reason}`,
    );
  }
}

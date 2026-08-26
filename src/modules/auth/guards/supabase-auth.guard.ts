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
import { describeAccessToken, extractAccessToken } from '../auth-token.util';
import { extractSupabaseProjectRef } from '../../../infrastructure/supabase/supabase-project.util';
import { normalizeUserRole } from '../role.util';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    const token = extractAccessToken(request);

    if (!token) {
      this.logUnauthorized(request, 'missing token', token);
      throw new UnauthorizedException('Unauthorized');
    }

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .auth.getUser(token);

    if (error || !data.user) {
      this.logUnauthorized(request, 'invalid token', token);
      throw new UnauthorizedException('Unauthorized');
    }

    const { data: profile, error: profileError } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('role, status')
      .eq('user_id', data.user.id)
      .maybeSingle();

    if (profileError || !profile) {
      this.logUnauthorized(request, 'profile not found', token);
      throw new UnauthorizedException('Unauthorized');
    }

    if (profile.status !== 'active') {
      this.logUnauthorized(request, 'inactive account', token);
      throw new UnauthorizedException('Unauthorized');
    }

    const role = normalizeUserRole(profile.role);
    if (!role) {
      this.logUnauthorized(request, 'invalid role', token);
      throw new UnauthorizedException('Unauthorized');
    }

    request.user = {
      id: data.user.id,
      email: data.user.email ?? '',
      role,
      status: profile.status,
      accessToken: token,
    };

    return true;
  }

  private logUnauthorized(
    request: Request,
    reason: string,
    token?: string,
  ): void {
    const meta = describeAccessToken(token);
    const expectedProject = extractSupabaseProjectRef(
      this.supabaseService.getPublicUrl(),
    );
    const projectMismatch =
      Boolean(meta.projectRef) &&
      Boolean(expectedProject) &&
      meta.projectRef !== expectedProject;

    this.logger.warn(
      `Failed authorization attempt ${request.method} ${request.originalUrl ?? request.url} ip=${request.ip} reason=${reason} tokenFormat=${meta.format} tokenProject=${meta.projectRef ?? 'none'} expectedProject=${expectedProject ?? 'none'} expired=${meta.expired} projectMismatch=${projectMismatch}`,
    );
  }
}

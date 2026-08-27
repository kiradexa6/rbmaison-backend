import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { SupabaseService } from '../../../infrastructure/supabase/supabase.service';
import { extractSupabaseProjectRef } from '../../../infrastructure/supabase/supabase-project.util';
import { describeAccessToken, extractAccessToken } from '../auth-token.util';
import { normalizeUserRole } from '../role.util';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import {
  SupabaseAccessTokenError,
  verifySupabaseAccessToken,
} from '../supabase-access-token.util';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private readonly logger = new Logger(SupabaseAuthGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
  ) {}

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

    const tokenMeta = describeAccessToken(token);
    const expectedProject = extractSupabaseProjectRef(
      this.supabaseService.getPublicUrl(),
    );
    const projectMismatch =
      Boolean(tokenMeta.projectRef) &&
      Boolean(expectedProject) &&
      tokenMeta.projectRef !== expectedProject;

    if (projectMismatch) {
      this.logUnauthorized(request, 'supabase project mismatch', token);
      throw new UnauthorizedException('Unauthorized');
    }

    if (tokenMeta.expired === true) {
      this.logUnauthorized(request, 'expired token', token);
      throw new UnauthorizedException('Unauthorized');
    }

    const supabaseUrl = this.supabaseService.getPublicUrl();
    const jwtSecret = this.configService.get<string>('supabase.jwtSecret');
    if (!supabaseUrl || !jwtSecret) {
      throw new ServiceUnavailableException('Supabase auth is not configured');
    }

    let verifiedUser: { userId: string; email: string };
    try {
      verifiedUser = verifySupabaseAccessToken(token, supabaseUrl, jwtSecret);
    } catch (error) {
      const reason =
        error instanceof SupabaseAccessTokenError
          ? error.message
          : 'invalid token';
      this.logUnauthorized(request, reason, token);
      throw new UnauthorizedException('Unauthorized');
    }

    const { data: profile, error: profileError } = await this.supabaseService
      .getAdminClient()
      .from('profiles')
      .select('role, status')
      .eq('user_id', verifiedUser.userId)
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
      id: verifiedUser.userId,
      email: verifiedUser.email,
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

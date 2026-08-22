import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRole } from '../../../infrastructure/supabase/types/database.types';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { roleMatches } from '../role.util';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!roles || roles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    if (!request.user || !roleMatches(request.user.role, roles)) {
      this.logger.warn(
        `Failed authorization attempt ${request.method} ${request.originalUrl ?? request.url} ip=${request.ip} role=${request.user?.role ?? 'anonymous'} required=${roles.join(',')}`,
      );
      const message = roles.some((role) => role.toLowerCase() === 'admin')
        ? 'Administrator access required.'
        : 'Permission denied';
      throw new ForbiddenException(message);
    }

    return true;
  }
}

import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminUsersService } from './admin-users.service';
import {
  AdminActivityLogsQueryDto,
  AdminSearchUsersQueryDto,
} from './dto/merchant.dto';

@Controller('admin')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get('users')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminSearchUsersQueryDto,
  ) {
    return this.adminUsersService.search(user, query);
  }

  @Get('users/:id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminUsersService.get(user, id);
  }

  @Post('users/:id/suspend')
  suspend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminUsersService.suspend(user, id);
  }

  @Post('users/:id/restore')
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminUsersService.restore(user, id);
  }

  @Get('activity-logs')
  activityLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminActivityLogsQueryDto,
  ) {
    return this.adminUsersService.activityLogs(user, query);
  }
}

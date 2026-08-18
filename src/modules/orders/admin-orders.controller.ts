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
import { AdminOrdersService } from './admin-orders.service';
import { AdminSearchOrdersQueryDto } from './dto/order.dto';

@Controller('admin/orders')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOrdersController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

  @Get()
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminSearchOrdersQueryDto,
  ) {
    return this.adminOrdersService.search(user, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminOrdersService.getOrder(user, id);
  }

  @Get(':id/payments')
  payments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminOrdersService.payments(user, id);
  }

  @Post(':id/deliver')
  confirmDelivery(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminOrdersService.confirmDelivery(user, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminOrdersService.cancel(user, id);
  }
}

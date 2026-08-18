import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { OrdersService } from './orders.service';

@Controller('merchant/orders')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('merchant')
export class MerchantShopOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.ordersService.storeOrders(user);
  }
}

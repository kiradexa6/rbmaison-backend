import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminOrdersService } from './admin-orders.service';

@Controller('admin/shipment-queue')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class AdminShipmentQueueController {
  constructor(private readonly adminOrdersService: AdminOrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.adminOrdersService.getShipmentQueue(user);
  }
}

import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { MerchantStoreService } from './merchant-store.service';

@Controller('merchant')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('merchant')
export class MerchantStoreController {
  constructor(private readonly merchantStoreService: MerchantStoreService) {}

  @Get('store')
  getStore(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantStoreService.getStore(user);
  }

  @Get('shop-details')
  shopDetails(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantStoreService.shopDetails(user);
  }

  @Get('shop-statistics')
  shopStatistics(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantStoreService.shopStatistics(user);
  }
}

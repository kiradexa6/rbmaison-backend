import {
  Body,
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
import { AdminStoresService } from './admin-stores.service';
import {
  AdjustStoreBalanceDto,
  AdjustStoreCreditDto,
  AdminSearchStoresQueryDto,
  SetStoreStatusDto,
  SetWholesaleAccessDto,
} from './dto/merchant.dto';

@Controller('admin/stores')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class AdminStoresController {
  constructor(private readonly adminStoresService: AdminStoresService) {}

  @Get()
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminSearchStoresQueryDto,
  ) {
    return this.adminStoresService.search(user, query);
  }

  @Get(':storeId')
  getStore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseUUIDPipe) storeId: string,
  ) {
    return this.adminStoresService.getStore(user, storeId);
  }

  @Get(':storeId/products')
  products(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseUUIDPipe) storeId: string,
  ) {
    return this.adminStoresService.products(user, storeId);
  }

  @Get(':storeId/orders')
  orders(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storeId', ParseUUIDPipe) storeId: string,
  ) {
    return this.adminStoresService.orders(user, storeId);
  }

  @Post(':id/balance-adjust')
  adjustBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustStoreBalanceDto,
  ) {
    return this.adminStoresService.adjustBalance(user, id, dto);
  }

  @Post(':id/credit-adjust')
  adjustCredit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustStoreCreditDto,
  ) {
    return this.adminStoresService.adjustCredit(user, id, dto);
  }

  @Post(':id/status')
  setStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStoreStatusDto,
  ) {
    return this.adminStoresService.setStatus(user, id, dto);
  }

  @Post(':id/wholesale-access')
  setWholesaleAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetWholesaleAccessDto,
  ) {
    return this.adminStoresService.setWholesaleAccess(user, id, dto.enabled);
  }
}

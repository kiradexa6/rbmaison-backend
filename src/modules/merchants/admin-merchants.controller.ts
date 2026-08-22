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
import { AdminMerchantsService } from './admin-merchants.service';
import {
  AdminSearchApplicationsQueryDto,
  AdminSearchListingsQueryDto,
  AdminSearchMerchantsQueryDto,
  ApproveApplicationDto,
  RejectApplicationDto,
  SetWholesaleAccessDto,
} from './dto/merchant.dto';

@Controller('admin')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class AdminMerchantsController {
  constructor(private readonly adminMerchantsService: AdminMerchantsService) {}

  @Get('merchants')
  searchMerchants(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminSearchMerchantsQueryDto,
  ) {
    return this.adminMerchantsService.searchMerchants(user, query);
  }

  @Get('merchants/applications')
  searchApplications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminSearchApplicationsQueryDto,
  ) {
    return this.adminMerchantsService.searchApplications(user, query);
  }

  @Post('merchants/:id/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: ApproveApplicationDto,
  ) {
    return this.adminMerchantsService.approve(user, id);
  }

  @Post('merchants/:id/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.adminMerchantsService.reject(
      user,
      id,
      dto.reason ?? dto.note,
    );
  }

  @Get('merchants/:id')
  getMerchant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminMerchantsService.getMerchant(user, id);
  }

  @Post('merchants/:id/wholesale-access')
  setWholesaleAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetWholesaleAccessDto,
  ) {
    return this.adminMerchantsService.setWholesaleAccess(user, id, dto.enabled);
  }

  @Get('wholesale/listings')
  searchListings(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminSearchListingsQueryDto,
  ) {
    return this.adminMerchantsService.searchListings(user, query);
  }

  @Post('wholesale/listings/:id/disable')
  disableListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminMerchantsService.disableListing(user, id);
  }

  @Post('wholesale/listings/:id/remove')
  removeListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminMerchantsService.removeListing(user, id);
  }
}

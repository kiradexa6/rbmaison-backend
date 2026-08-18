import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { SubmitMerchantApplicationDto } from './dto/merchant.dto';
import { StoreApplicationsService } from './store-applications.service';

@Controller('store-applications')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('customer')
export class StoreApplicationsController {
  constructor(
    private readonly storeApplicationsService: StoreApplicationsService,
  ) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitMerchantApplicationDto,
  ) {
    return this.storeApplicationsService.create(user, dto);
  }

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.storeApplicationsService.mine(user);
  }
}

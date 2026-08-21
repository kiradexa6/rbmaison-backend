import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_FINANCIAL } from '../../shared/common/constants/throttle.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  CreateDepositRequestDto,
  CreateWithdrawalRequestDto,
  DepositAddressQueryDto,
} from './dto/wallet.dto';
import { MerchantWalletsService } from './merchant-wallets.service';

@Controller('merchant/wallet')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('merchant')
export class MerchantWalletsController {
  constructor(
    private readonly merchantWalletsService: MerchantWalletsService,
  ) {}

  @Get()
  wallets(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantWalletsService.getWallets(user);
  }

  @Get('balance')
  balance(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantWalletsService.getBalance(user);
  }

  @Get('transactions')
  history(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantWalletsService.history(user);
  }

  @Get('deposit-address')
  depositAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DepositAddressQueryDto,
  ) {
    return this.merchantWalletsService.depositAddress(user, query);
  }

  @Get('deposits')
  myDeposits(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantWalletsService.myDeposits(user);
  }

  @Get('deposits/:id')
  getDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.merchantWalletsService.getDeposit(user, id);
  }

  @Post('deposits')
  @Throttle(THROTTLE_FINANCIAL)
  completeDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateDepositRequestDto,
  ) {
    return this.merchantWalletsService.createDeposit(user, dto);
  }

  @Get('withdrawals')
  myWithdrawals(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantWalletsService.myWithdrawals(user);
  }

  @Get('withdrawals/:id')
  getWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.merchantWalletsService.getWithdrawal(user, id);
  }

  @Post('withdrawals')
  @Throttle(THROTTLE_FINANCIAL)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWithdrawalRequestDto,
  ) {
    return this.merchantWalletsService.createWithdrawal(user, dto);
  }
}

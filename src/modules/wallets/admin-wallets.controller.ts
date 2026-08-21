import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_FINANCIAL } from '../../shared/common/constants/throttle.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AdminWalletsService } from './admin-wallets.service';
import {
  AddWalletAddressDto,
  AdjustMerchantWalletDto,
  AdminDepositSearchQueryDto,
  AdminWalletTransactionSearchQueryDto,
  AdminWithdrawalSearchQueryDto,
  UpdateWalletAddressDto,
} from './dto/wallet.dto';

@Controller('admin/wallets')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class AdminWalletsController {
  constructor(private readonly adminWalletsService: AdminWalletsService) {}

  @Get('addresses')
  listAddresses(@CurrentUser() user: AuthenticatedUser) {
    return this.adminWalletsService.listAddresses(user);
  }

  @Post('addresses')
  addAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddWalletAddressDto,
  ) {
    return this.adminWalletsService.addAddress(user, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWalletAddressDto,
  ) {
    return this.adminWalletsService.updateAddress(user, id, dto);
  }

  @Post('addresses/:id/disable')
  disableAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminWalletsService.setAddressStatus(user, id, 'disabled');
  }

  @Delete('addresses/:id')
  deleteAddress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminWalletsService.deleteAddress(user, id);
  }

  @Get('deposits')
  searchDeposits(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminDepositSearchQueryDto,
  ) {
    return this.adminWalletsService.searchDeposits(user, query);
  }

  @Get('deposits/:id')
  getDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminWalletsService.getDeposit(user, id);
  }

  @Post('deposits/:id/approve')
  @Throttle(THROTTLE_FINANCIAL)
  approveDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminWalletsService.approveDeposit(user, id);
  }

  @Post('deposits/:id/reject')
  @Throttle(THROTTLE_FINANCIAL)
  rejectDeposit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminWalletsService.rejectDeposit(user, id);
  }

  @Get('withdrawals')
  searchWithdrawals(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminWithdrawalSearchQueryDto,
  ) {
    return this.adminWalletsService.searchWithdrawals(user, query);
  }

  @Get('withdrawals/:id')
  getWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminWalletsService.getWithdrawal(user, id);
  }

  @Get('transactions')
  searchTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AdminWalletTransactionSearchQueryDto,
  ) {
    return this.adminWalletsService.searchTransactions(user, query);
  }

  @Post('withdrawals/:id/approve')
  @Throttle(THROTTLE_FINANCIAL)
  approveWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminWalletsService.approveWithdrawal(user, id);
  }

  @Post('withdrawals/:id/reject')
  @Throttle(THROTTLE_FINANCIAL)
  rejectWithdrawal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminWalletsService.rejectWithdrawal(user, id);
  }

  @Post('merchants/:id/adjust')
  @Throttle(THROTTLE_FINANCIAL)
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustMerchantWalletDto,
  ) {
    return this.adminWalletsService.adjustMerchantWallet(user, id, dto);
  }
}

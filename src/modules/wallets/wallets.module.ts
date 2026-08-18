import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminWalletsController } from './admin-wallets.controller';
import { AdminWalletsService } from './admin-wallets.service';
import { MerchantWalletsController } from './merchant-wallets.controller';
import { MerchantWalletsService } from './merchant-wallets.service';

@Module({
  imports: [AuthModule],
  controllers: [MerchantWalletsController, AdminWalletsController],
  providers: [MerchantWalletsService, AdminWalletsService],
})
export class WalletsModule {}

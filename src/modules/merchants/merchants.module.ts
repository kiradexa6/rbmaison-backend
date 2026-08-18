import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminMerchantsController } from './admin-merchants.controller';
import { AdminMerchantsService } from './admin-merchants.service';
import { AdminStoresController } from './admin-stores.controller';
import { AdminStoresService } from './admin-stores.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { MerchantStoreController } from './merchant-store.controller';
import { MerchantStoreService } from './merchant-store.service';
import { StoreApplicationsController } from './store-applications.controller';
import { StoreApplicationsService } from './store-applications.service';

@Module({
  imports: [AuthModule],
  controllers: [
    StoreApplicationsController,
    MerchantStoreController,
    AdminUsersController,
    AdminMerchantsController,
    AdminStoresController,
  ],
  providers: [
    StoreApplicationsService,
    MerchantStoreService,
    AdminUsersService,
    AdminMerchantsService,
    AdminStoresService,
  ],
})
export class MerchantsModule {}

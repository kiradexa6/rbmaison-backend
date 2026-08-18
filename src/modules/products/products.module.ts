import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminProductsController } from './admin-products.controller';
import { AdminProductsService } from './admin-products.service';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';
import { MerchantListingsService } from './merchant-listings.service';
import { MerchantProductsController } from './merchant-products.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    CatalogueController,
    AdminProductsController,
    MerchantProductsController,
  ],
  providers: [CatalogueService, AdminProductsService, MerchantListingsService],
})
export class ProductsModule {}

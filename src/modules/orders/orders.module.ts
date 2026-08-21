import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminMerchantOrdersController } from './admin-merchant-orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';
import { AdminShipmentQueueController } from './admin-shipment-queue.controller';
import { CustomerOrdersController } from './customer-orders.controller';
import { MerchantOrdersController } from './merchant-orders.controller';
import { MerchantShopOrdersController } from './merchant-shop-orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [
    CustomerOrdersController,
    MerchantShopOrdersController,
    MerchantOrdersController,
    AdminMerchantOrdersController,
    AdminOrdersController,
    AdminShipmentQueueController,
  ],
  providers: [OrdersService, AdminOrdersService],
})
export class OrdersModule {}

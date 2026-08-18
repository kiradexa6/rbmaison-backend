import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminNotificationsController } from './admin-notifications.controller';
import {
  EmailNotificationChannel,
  InAppNotificationChannel,
  SmsNotificationChannel,
} from './notification.channels';
import { NotificationsController } from './notifications.controller';
import { NotificationService } from './notifications.service';

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [
    InAppNotificationChannel,
    EmailNotificationChannel,
    SmsNotificationChannel,
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationsModule {}

import { Injectable, Logger } from '@nestjs/common';
import {
  EmailNotificationInput,
  InAppNotificationInput,
  NotificationChannel,
  SmsNotificationInput,
} from './notification.types';

@Injectable()
export class InAppNotificationChannel implements NotificationChannel {
  readonly kind = 'in-app' as const;
  private readonly logger = new Logger(InAppNotificationChannel.name);

  async send(input: InAppNotificationInput): Promise<void> {
    this.logger.debug(`in-app queued type=${input.type} user=${input.userId}`);
  }
}

@Injectable()
export class EmailNotificationChannel implements NotificationChannel {
  readonly kind = 'email' as const;
  private readonly logger = new Logger(EmailNotificationChannel.name);

  async send(input: EmailNotificationInput): Promise<void> {
    this.logger.debug(
      `email channel not configured; skipped subject="${input.subject}" to=${input.to}`,
    );
  }
}

@Injectable()
export class SmsNotificationChannel implements NotificationChannel {
  readonly kind = 'sms' as const;
  private readonly logger = new Logger(SmsNotificationChannel.name);

  async send(input: SmsNotificationInput): Promise<void> {
    this.logger.debug(`sms channel not configured; skipped to=${input.to}`);
  }
}

import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import type { Json } from '../../infrastructure/supabase/types/database.types';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  EmailNotificationChannel,
  InAppNotificationChannel,
  SmsNotificationChannel,
} from './notification.channels';
import {
  EmailNotificationInput,
  InAppNotificationInput,
  NotificationReadStatus,
  SmsNotificationInput,
} from './notification.types';

export type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  read_status: NotificationReadStatus;
  created_at: string;
  read_at: string | null;
};

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly inAppChannel: InAppNotificationChannel,
    private readonly emailChannel: EmailNotificationChannel,
    private readonly smsChannel: SmsNotificationChannel,
  ) {}

  realtimeFilter(userId: string) {
    return {
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${userId}`,
      events: ['INSERT', 'UPDATE'] as const,
    };
  }

  async sendInApp(input: InAppNotificationInput): Promise<NotificationRow> {
    await this.inAppChannel.send(input);
    const { data, error } = await this.admin().rpc('create_notification', {
      p_user_id: input.userId,
      p_type: input.type,
      p_title: input.title,
      p_message: input.message,
      p_data: (input.data ?? {}) as Json,
    });
    const row = assertSupabase({ data, error });
    if (!row) {
      throw new ServiceUnavailableException('Failed to create notification');
    }
    this.logger.debug(`in-app notification ${row.id} created`);
    return row as NotificationRow;
  }

  async sendEmail(input: EmailNotificationInput): Promise<void> {
    await this.emailChannel.send(input);
  }

  async sendSMS(input: SmsNotificationInput): Promise<void> {
    await this.smsChannel.send(input);
  }

  async notifyPaymentRequired(orderId: string): Promise<void> {
    const { error } = await this.admin().rpc('notify_order_payment_required', {
      p_order_id: orderId,
    });
    if (error) {
      this.logger.warn(
        `Failed to persist payment-required notification for order ${orderId}: ${error.message}`,
      );
    }
  }

  async listMine(user: AuthenticatedUser) {
    const { data, error } = await this.client(user).rpc('my_notifications');
    const rows = (assertSupabase({ data, error }) ?? []) as NotificationRow[];
    return {
      unread: rows.filter((row) => row.read_status === 'unread'),
      read: rows.filter((row) => row.read_status === 'read'),
      realtime: this.realtimeFilter(user.id),
    };
  }

  async unreadCount(user: AuthenticatedUser) {
    const { data, error } = await this.client(user).rpc(
      'notification_unread_count',
    );
    return {
      count: Number(assertSupabase({ data, error }) ?? 0),
      realtime: this.realtimeFilter(user.id),
    };
  }

  async markRead(user: AuthenticatedUser, id: string) {
    const { data, error } = await this.client(user).rpc(
      'mark_notification_read',
      { p_id: id },
    );
    return assertSupabase({ data, error }, 'Notification not found');
  }

  async markAllRead(user: AuthenticatedUser) {
    const { data, error } = await this.client(user).rpc(
      'mark_all_notifications_read',
    );
    return { updated: Number(assertSupabase({ data, error }) ?? 0) };
  }

  async adminSend(user: AuthenticatedUser, input: InAppNotificationInput) {
    const { data: targetProfile, error: targetError } = await this.admin()
      .from('profiles')
      .select('user_id, status')
      .eq('user_id', input.userId)
      .maybeSingle();

    if (targetError || !targetProfile) {
      throw new NotFoundException('Notification recipient not found');
    }

    if (targetProfile.status !== 'active') {
      throw new UnprocessableEntityException(
        'Notification recipient is not active',
      );
    }

    const notification = await this.sendInApp(input);

    const { error: logError } = await this.client(user).rpc(
      'log_admin_action',
      {
        p_action: 'send_notification',
        p_target_type: 'notifications',
        p_target_id: notification.id,
        p_description: `Sent ${input.type} notification to ${input.userId}`,
      },
    );

    if (logError) {
      this.logger.warn(
        `Notification ${notification.id} sent but admin activity log failed: ${logError.message}`,
      );
    }

    return notification;
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }

  private admin() {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.getAdminClient();
  }
}

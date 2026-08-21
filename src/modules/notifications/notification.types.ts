export type NotificationType =
  | 'merchant_application'
  | 'merchant_approved'
  | 'merchant_rejected'
  | 'new_order'
  | 'order_payment_required'
  | 'order_paid'
  | 'shipping_confirmed'
  | 'delivery_completed'
  | 'profit_released'
  | 'deposit_pending'
  | 'deposit_approved'
  | 'deposit_rejected'
  | 'withdrawal_pending'
  | 'withdrawal_approved'
  | 'withdrawal_rejected'
  | 'admin_action';

export type NotificationReadStatus = 'unread' | 'read';

export interface InAppNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface EmailNotificationInput {
  to: string;
  subject: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface SmsNotificationInput {
  to: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface NotificationChannel {
  readonly kind: 'in-app' | 'email' | 'sms';
  send(
    input:
      InAppNotificationInput | EmailNotificationInput | SmsNotificationInput,
  ): Promise<void>;
}

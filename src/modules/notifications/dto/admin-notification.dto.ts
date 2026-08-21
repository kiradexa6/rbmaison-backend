import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { NotificationType } from '../../../infrastructure/supabase/types/database.types';

const ADMIN_NOTIFICATION_TYPES = [
  'merchant_application',
  'merchant_approved',
  'merchant_rejected',
  'new_order',
  'order_payment_required',
  'order_paid',
  'shipping_confirmed',
  'delivery_completed',
  'profit_released',
  'deposit_pending',
  'deposit_approved',
  'deposit_rejected',
  'withdrawal_pending',
  'withdrawal_approved',
  'withdrawal_rejected',
  'admin_action',
] as const satisfies readonly NotificationType[];

export class AdminSendNotificationDto {
  @IsUUID()
  userId!: string;

  @IsEnum(ADMIN_NOTIFICATION_TYPES)
  type!: NotificationType;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

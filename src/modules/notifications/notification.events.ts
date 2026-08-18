import { NotificationType } from './notification.types';

export type NotificationEventKey =
  | 'applicationSubmitted'
  | 'applicationApproved'
  | 'applicationRejected'
  | 'newOrder'
  | 'orderPaid'
  | 'paymentRequired'
  | 'shippingConfirmed'
  | 'orderSentForShipping'
  | 'deliveryCompleted'
  | 'profitReleased'
  | 'depositPending'
  | 'depositApproved'
  | 'depositRejected'
  | 'withdrawalPending'
  | 'withdrawalApproved'
  | 'withdrawalRejected';

export const NOTIFICATION_EVENTS: Record<
  NotificationEventKey,
  { type: NotificationType; title: string; message: string; audience: 'user' | 'merchant' | 'admin' | 'merchant+admin' }
> = {
  applicationSubmitted: {
    type: 'merchant_application',
    title: 'Application Submitted',
    message:
      'Your store application has been submitted and is waiting for review.',
    audience: 'merchant+admin',
  },
  applicationApproved: {
    type: 'merchant_approved',
    title: 'Store Approved',
    message:
      'Your store has been approved. Merchant access is now available.',
    audience: 'user',
  },
  applicationRejected: {
    type: 'merchant_rejected',
    title: 'Store Application Rejected',
    message: 'Your store application was rejected.',
    audience: 'user',
  },
  newOrder: {
    type: 'new_order',
    title: 'New Order',
    message: 'New order received',
    audience: 'merchant',
  },
  orderPaid: {
    type: 'order_paid',
    title: 'Wholesale Payment Completed',
    message: 'Order confirmed and wholesale payment completed',
    audience: 'merchant',
  },
  paymentRequired: {
    type: 'order_payment_required',
    title: 'Payment Required',
    message: 'Wholesale payment failed. Please top up your account.',
    audience: 'merchant',
  },
  shippingConfirmed: {
    type: 'shipping_confirmed',
    title: 'Merchant Order Waiting For Confirmation',
    message: 'Merchant order waiting for confirmation',
    audience: 'admin',
  },
  orderSentForShipping: {
    type: 'shipping_confirmed',
    title: 'Order Sent For Shipping',
    message: 'Order sent for shipping',
    audience: 'merchant',
  },
  deliveryCompleted: {
    type: 'delivery_completed',
    title: 'Order Completed',
    message: 'Order completed. Wholesale returned and profit released.',
    audience: 'merchant',
  },
  profitReleased: {
    type: 'profit_released',
    title: 'Profit Released',
    message: 'Order completed. Wholesale returned and profit released.',
    audience: 'merchant',
  },
  depositPending: {
    type: 'deposit_pending',
    title: 'Deposit Pending',
    message: 'Your deposit request is waiting for admin review.',
    audience: 'merchant+admin',
  },
  depositApproved: {
    type: 'deposit_approved',
    title: 'Deposit Approved',
    message: 'Your deposit has been approved.',
    audience: 'merchant',
  },
  depositRejected: {
    type: 'deposit_rejected',
    title: 'Deposit Rejected',
    message: 'Your deposit request was rejected.',
    audience: 'merchant',
  },
  withdrawalPending: {
    type: 'withdrawal_pending',
    title: 'Withdrawal Pending',
    message: 'Your withdrawal request is waiting for admin review.',
    audience: 'merchant+admin',
  },
  withdrawalApproved: {
    type: 'withdrawal_approved',
    title: 'Withdrawal Approved',
    message: 'Your withdrawal has been approved.',
    audience: 'merchant',
  },
  withdrawalRejected: {
    type: 'withdrawal_rejected',
    title: 'Withdrawal Rejected',
    message: 'Your withdrawal request was rejected.',
    audience: 'merchant',
  },
};

export const ADMIN_EVENT_TITLES = {
  newApplication: 'New Merchant Application',
  newDeposit: 'New Deposit Request',
  newWithdrawal: 'New Withdrawal Request',
  shipping: 'Merchant Order Waiting For Confirmation',
  suspicious: 'Suspicious Activity',
} as const;

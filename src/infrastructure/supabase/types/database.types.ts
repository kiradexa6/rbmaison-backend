export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = 'customer' | 'merchant' | 'admin';
export type ProfileStatus = 'active' | 'suspended' | 'blocked' | 'pending';
export type VerificationStatus = 'pending' | 'approved' | 'rejected';
export type MerchantStatus = 'active' | 'suspended' | 'blocked';
export type StoreStatus = 'pending' | 'active' | 'suspended';
export type MerchantApplicationStatus =
  'pending' | 'approved' | 'rejected' | 'suspended';
export type SupportedCurrency = 'USD' | 'BTC' | 'ETH' | 'USDT';
export type WalletTransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'order_payment'
  | 'admin_adjustment'
  | 'refund'
  | 'profit_release'
  | 'wholesale_return';
export type WalletTransactionStatus =
  'pending' | 'completed' | 'failed' | 'cancelled';
export type WalletTransactionDirection = 'credit' | 'debit';
export type CryptoAsset = 'BTC' | 'ETH' | 'USDT';
export type WalletNetwork =
  'bitcoin' | 'ethereum' | 'erc20' | 'trc20' | 'bep20';
export type WalletAddressStatus = 'active' | 'disabled';
export type DepositRequestStatus = 'pending' | 'approved' | 'rejected';
export type WithdrawalRequestStatus =
  'pending' | 'approved' | 'rejected' | 'completed';
export type ProductStatus = 'draft' | 'active' | 'inactive' | 'archived';
export type ProductGender = 'women' | 'men' | 'unisex';
export type BrandStatus = 'active' | 'inactive';
export type InventoryTransactionType =
  | 'stock_added'
  | 'stock_removed'
  | 'order_reserved'
  | 'order_released'
  | 'adjustment';
export type ListingStatus =
  'pending' | 'active' | 'suspended' | 'inactive' | 'removed';
export type OrderStatus =
  | 'pending'
  | 'awaiting_payment'
  | 'confirmed'
  | 'paid'
  | 'processing'
  | 'shipping'
  | 'shipped'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'refunded';
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
export type HistoricalRunStatus =
  'preview' | 'running' | 'completed' | 'failed' | 'reversed';
export type HistoricalActivityLevel = 'low' | 'medium' | 'high';
export type HistoricalCategory =
  'wallet' | 'deposits' | 'withdrawals' | 'orders' | 'viewers';
export type HistoricalRangePreset =
  'last_7_days' | 'last_30_days' | 'last_90_days' | 'last_180_days' | 'custom';

type RowInsertUpdate<TRow, TInsert, TUpdate> = {
  Row: TRow;
  Insert: TInsert;
  Update: TUpdate;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      profiles: RowInsertUpdate<
        {
          id: string;
          user_id: string;
          full_name: string | null;
          email: string;
          phone: string | null;
          avatar: string | null;
          country: string | null;
          role: UserRole;
          status: ProfileStatus;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          full_name?: string | null;
          email: string;
          phone?: string | null;
          avatar?: string | null;
          country?: string | null;
          role?: UserRole;
          status?: ProfileStatus;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          full_name?: string | null;
          email?: string;
          phone?: string | null;
          avatar?: string | null;
          country?: string | null;
          role?: UserRole;
          status?: ProfileStatus;
          created_at?: string;
          updated_at?: string;
        }
      >;
      admin_activity_logs: RowInsertUpdate<
        {
          id: string;
          admin_id: string;
          action: string;
          target_type: string;
          target_id: string | null;
          description: string | null;
          timestamp: string;
          created_at: string;
        },
        {
          id?: string;
          admin_id: string;
          action: string;
          target_type: string;
          target_id?: string | null;
          description?: string | null;
          timestamp?: string;
          created_at?: string;
        },
        {
          action?: string;
          target_type?: string;
          target_id?: string | null;
          description?: string | null;
        }
      >;
      notifications: RowInsertUpdate<
        {
          id: string;
          user_id: string;
          type: NotificationType;
          title: string;
          message: string;
          data: Json;
          read_status: NotificationReadStatus;
          created_at: string;
          read_at: string | null;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          type: NotificationType;
          title: string;
          message: string;
          data?: Json;
          read_status?: NotificationReadStatus;
          created_at?: string;
          read_at?: string | null;
          updated_at?: string;
        },
        {
          read_status?: NotificationReadStatus;
          read_at?: string | null;
          updated_at?: string;
        }
      >;
      merchant_invitation_codes: RowInsertUpdate<
        {
          id: string;
          code: string;
          active: boolean;
          created_by: string;
          used_count: number;
          max_usage: number;
          expires_at: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          code: string;
          active?: boolean;
          created_by: string;
          used_count?: number;
          max_usage?: number;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          active?: boolean;
          used_count?: number;
          max_usage?: number;
          expires_at?: string | null;
          updated_at?: string;
        }
      >;
      merchants: RowInsertUpdate<
        {
          id: string;
          user_id: string;
          store_id: string | null;
          store_name: string;
          business_email: string;
          phone: string | null;
          country: string;
          verification_status: VerificationStatus;
          status: MerchantStatus;
          wholesale_enabled: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          store_id?: string | null;
          store_name: string;
          business_email: string;
          phone?: string | null;
          country: string;
          verification_status?: VerificationStatus;
          status?: MerchantStatus;
          wholesale_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          store_id?: string | null;
          store_name?: string;
          business_email?: string;
          phone?: string | null;
          country?: string;
          verification_status?: VerificationStatus;
          status?: MerchantStatus;
          wholesale_enabled?: boolean;
          updated_at?: string;
        }
      >;
      merchant_applications: RowInsertUpdate<
        {
          id: string;
          user_id: string;
          store_name: string;
          business_description: string | null;
          country: string;
          documents: Json;
          status: MerchantApplicationStatus;
          submitted_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
          merchant_id: string | null;
          store_id: string | null;
          rejection_reason: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          user_id: string;
          store_name: string;
          business_description?: string | null;
          country: string;
          documents?: Json;
          status?: MerchantApplicationStatus;
          submitted_at?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          merchant_id?: string | null;
          store_id?: string | null;
          rejection_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          store_name?: string;
          business_description?: string | null;
          country?: string;
          documents?: Json;
          status?: MerchantApplicationStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          merchant_id?: string | null;
          store_id?: string | null;
          rejection_reason?: string | null;
          updated_at?: string;
        }
      >;
      merchant_credit_scores: RowInsertUpdate<
        {
          id: string;
          merchant_id: string;
          score: string;
          reason: string;
          updated_by: string;
          created_at: string;
        },
        {
          id?: string;
          merchant_id: string;
          score: number | string;
          reason: string;
          updated_by: string;
          created_at?: string;
        },
        {
          score?: number | string;
          reason?: string;
        }
      >;
      store_followers: RowInsertUpdate<
        {
          id: string;
          store_id: string;
          user_id: string;
          created_at: string;
        },
        {
          id?: string;
          store_id: string;
          user_id: string;
          created_at?: string;
        },
        {
          store_id?: string;
          user_id?: string;
        }
      >;
      stores: RowInsertUpdate<
        {
          id: string;
          merchant_id: string;
          store_name: string;
          description: string | null;
          logo: string | null;
          status: StoreStatus;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          merchant_id: string;
          store_name: string;
          description?: string | null;
          logo?: string | null;
          status?: StoreStatus;
          created_at?: string;
          updated_at?: string;
        },
        {
          store_name?: string;
          description?: string | null;
          logo?: string | null;
          status?: StoreStatus;
          updated_at?: string;
        }
      >;
      wallets: RowInsertUpdate<
        {
          id: string;
          merchant_id: string;
          currency: SupportedCurrency;
          balance: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          merchant_id: string;
          currency: SupportedCurrency;
          balance?: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          balance?: string;
          updated_at?: string;
        }
      >;
      wallet_transactions: RowInsertUpdate<
        {
          id: string;
          wallet_id: string;
          type: WalletTransactionType;
          amount: string;
          currency: SupportedCurrency;
          direction: WalletTransactionDirection;
          status: WalletTransactionStatus;
          reference_type: string | null;
          reference_id: string | null;
          description: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          wallet_id: string;
          type: WalletTransactionType;
          amount: string;
          currency: SupportedCurrency;
          direction: WalletTransactionDirection;
          status?: WalletTransactionStatus;
          reference_type?: string | null;
          reference_id?: string | null;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          status?: WalletTransactionStatus;
          description?: string | null;
          updated_at?: string;
        }
      >;
      admin_wallet_addresses: RowInsertUpdate<
        {
          id: string;
          asset: CryptoAsset;
          network: WalletNetwork;
          wallet_address: string;
          status: WalletAddressStatus;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          asset: CryptoAsset;
          network: WalletNetwork;
          wallet_address: string;
          status?: WalletAddressStatus;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          wallet_address?: string;
          network?: WalletNetwork;
          status?: WalletAddressStatus;
          updated_at?: string;
        }
      >;
      wallet_deposit_requests: RowInsertUpdate<
        {
          id: string;
          merchant_id: string;
          asset: CryptoAsset;
          network: WalletNetwork;
          amount: string;
          wallet_address_id: string | null;
          wallet_address_used: string;
          status: DepositRequestStatus;
          created_at: string;
          updated_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
        },
        {
          id?: string;
          merchant_id: string;
          asset: CryptoAsset;
          network: WalletNetwork;
          amount: string;
          wallet_address_id?: string | null;
          wallet_address_used: string;
          status?: DepositRequestStatus;
          created_at?: string;
          updated_at?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
        },
        {
          status?: DepositRequestStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          updated_at?: string;
        }
      >;
      withdrawal_requests: RowInsertUpdate<
        {
          id: string;
          merchant_id: string;
          asset: CryptoAsset;
          network: WalletNetwork;
          amount: string;
          destination_address: string;
          status: WithdrawalRequestStatus;
          created_at: string;
          updated_at: string;
          reviewed_by: string | null;
          reviewed_at: string | null;
        },
        {
          id?: string;
          merchant_id: string;
          asset: CryptoAsset;
          network: WalletNetwork;
          amount: string;
          destination_address: string;
          status?: WithdrawalRequestStatus;
          created_at?: string;
          updated_at?: string;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
        },
        {
          status?: WithdrawalRequestStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          updated_at?: string;
        }
      >;
      product_categories: RowInsertUpdate<
        {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          parent_id: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          parent_id?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          name?: string;
          slug?: string;
          description?: string | null;
          parent_id?: string | null;
          updated_at?: string;
        }
      >;
      brands: RowInsertUpdate<
        {
          id: string;
          name: string;
          slug: string;
          logo: string | null;
          description: string | null;
          status: BrandStatus;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          name: string;
          slug: string;
          logo?: string | null;
          description?: string | null;
          status?: BrandStatus;
          created_at?: string;
          updated_at?: string;
        },
        {
          name?: string;
          slug?: string;
          logo?: string | null;
          description?: string | null;
          status?: BrandStatus;
          updated_at?: string;
        }
      >;
      products: RowInsertUpdate<
        {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          brand_id: string;
          category_id: string;
          gender: ProductGender;
          collection: string | null;
          price: string;
          currency: SupportedCurrency;
          status: ProductStatus;
          published: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          brand_id: string;
          category_id: string;
          gender?: ProductGender;
          collection?: string | null;
          price: string;
          currency?: SupportedCurrency;
          status?: ProductStatus;
          published?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          name?: string;
          slug?: string;
          description?: string | null;
          brand_id?: string;
          category_id?: string;
          gender?: ProductGender;
          collection?: string | null;
          price?: string;
          currency?: SupportedCurrency;
          status?: ProductStatus;
          published?: boolean;
          updated_at?: string;
        }
      >;
      product_images: RowInsertUpdate<
        {
          id: string;
          product_id: string;
          storage_path: string;
          image_url: string | null;
          alt_text: string | null;
          sort_order: number;
          position: number;
          is_primary: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          product_id: string;
          storage_path: string;
          image_url?: string | null;
          alt_text?: string | null;
          sort_order?: number;
          position?: number;
          is_primary?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          storage_path?: string;
          image_url?: string | null;
          alt_text?: string | null;
          sort_order?: number;
          position?: number;
          is_primary?: boolean;
          updated_at?: string;
        }
      >;
      product_variants: RowInsertUpdate<
        {
          id: string;
          product_id: string;
          size: string | null;
          color: string | null;
          sku: string;
          price_override: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          product_id: string;
          size?: string | null;
          color?: string | null;
          sku: string;
          price_override?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          size?: string | null;
          color?: string | null;
          sku?: string;
          price_override?: string | null;
          is_active?: boolean;
          updated_at?: string;
        }
      >;
      inventory: RowInsertUpdate<
        {
          id: string;
          variant_id: string;
          quantity: number;
          reserved_quantity: number;
          available_quantity: number;
          availability: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          variant_id: string;
          quantity?: number;
          reserved_quantity?: number;
          availability?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          quantity?: number;
          reserved_quantity?: number;
          availability?: boolean;
          updated_at?: string;
        }
      >;
      inventory_transactions: RowInsertUpdate<
        {
          id: string;
          product_id: string;
          variant_id: string;
          type: InventoryTransactionType;
          quantity: number;
          reference: string | null;
          created_by: string | null;
          created_at: string;
        },
        {
          id?: string;
          product_id: string;
          variant_id: string;
          type: InventoryTransactionType;
          quantity: number;
          reference?: string | null;
          created_by?: string | null;
          created_at?: string;
        },
        {
          reference?: string | null;
        }
      >;
      merchant_product_listings: RowInsertUpdate<
        {
          id: string;
          merchant_id: string;
          product_id: string;
          sales_price: string;
          sales_price_snapshot: string;
          wholesale_price: string;
          discount_percentage: string;
          status: ListingStatus;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          merchant_id: string;
          product_id: string;
          sales_price: string;
          discount_percentage?: string;
          status?: ListingStatus;
          created_at?: string;
          updated_at?: string;
        },
        {
          sales_price?: string;
          discount_percentage?: string;
          status?: ListingStatus;
          updated_at?: string;
        }
      >;
      orders: RowInsertUpdate<
        {
          id: string;
          customer_id: string;
          merchant_id: string;
          store_id: string;
          status: OrderStatus;
          total_amount: string;
          currency: SupportedCurrency;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          customer_id: string;
          merchant_id: string;
          store_id: string;
          status?: OrderStatus;
          total_amount: string;
          currency?: SupportedCurrency;
          created_at?: string;
          updated_at?: string;
        },
        {
          status?: OrderStatus;
          updated_at?: string;
        }
      >;
      order_items: RowInsertUpdate<
        {
          id: string;
          order_id: string;
          product_id: string;
          listing_id: string | null;
          variant_id: string;
          quantity: number;
          sales_price: string;
          wholesale_price: string;
          merchant_profit: string;
          created_at: string;
        },
        {
          id?: string;
          order_id: string;
          product_id: string;
          listing_id?: string | null;
          variant_id: string;
          quantity: number;
          sales_price: string;
          wholesale_price: string;
          created_at?: string;
        },
        {
          quantity?: number;
        }
      >;
      store_viewer_settings: RowInsertUpdate<
        {
          store_id: string;
          viewer_count: number;
          reason: string;
          updated_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          store_id: string;
          viewer_count: number;
          reason: string;
          updated_by: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          viewer_count?: number;
          reason?: string;
          updated_by?: string;
          updated_at?: string;
        }
      >;
      admin_historical_data_runs: RowInsertUpdate<
        {
          id: string;
          admin_id: string;
          target_user_id: string;
          merchant_id: string | null;
          store_id: string | null;
          period_from: string;
          period_to: string;
          categories: string[];
          activity_level: HistoricalActivityLevel;
          idempotency_key: string | null;
          status: HistoricalRunStatus;
          created_counts: Json;
          created_ids: Json;
          snapshot: Json;
          error_message: string | null;
          created_at: string;
          completed_at: string | null;
          reversed_at: string | null;
        },
        {
          id?: string;
          admin_id: string;
          target_user_id: string;
          merchant_id?: string | null;
          store_id?: string | null;
          period_from: string;
          period_to: string;
          categories: string[];
          activity_level: HistoricalActivityLevel;
          idempotency_key?: string | null;
          status?: HistoricalRunStatus;
          created_counts?: Json;
          created_ids?: Json;
          snapshot?: Json;
          error_message?: string | null;
          created_at?: string;
          completed_at?: string | null;
          reversed_at?: string | null;
        },
        {
          status?: HistoricalRunStatus;
          created_counts?: Json;
          created_ids?: Json;
          snapshot?: Json;
          error_message?: string | null;
          completed_at?: string | null;
          reversed_at?: string | null;
        }
      >;
    };
    Views: {
      catalogue_availability: {
        Row: {
          variant_id: string;
          product_id: string;
          in_stock: boolean;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      storefront_listings: {
        Row: {
          id: string;
          merchant_id: string;
          product_id: string;
          sales_price: string;
          status: ListingStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      customer_order_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          variant_id: string;
          quantity: number;
          sales_price: string;
          created_at: string;
          listing_id: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_merchant: { Args: Record<string, never>; Returns: boolean };
      is_customer: { Args: Record<string, never>; Returns: boolean };
      current_merchant_id: { Args: Record<string, never>; Returns: string };
      current_store_id: { Args: Record<string, never>; Returns: string };
      log_admin_action: {
        Args: {
          p_action: string;
          p_target_type: string;
          p_target_id?: string;
          p_description?: string;
        };
        Returns: string;
      };
      create_merchant_invitation_code: {
        Args: { p_max_usage?: number; p_expires_at?: string };
        Returns: Database['public']['Tables']['merchant_invitation_codes']['Row'];
      };
      deactivate_merchant_invitation_code: {
        Args: { p_code_id: string };
        Returns: Database['public']['Tables']['merchant_invitation_codes']['Row'];
      };
      register_merchant_with_invitation: {
        Args: {
          p_invitation_code: string;
          p_store_name: string;
          p_business_email: string;
          p_phone?: string;
          p_country?: string;
        };
        Returns: Database['public']['Tables']['merchants']['Row'];
      };
      record_wallet_transaction: {
        Args: {
          p_wallet_id: string;
          p_type: WalletTransactionType;
          p_amount: number;
          p_status?: WalletTransactionStatus;
          p_direction?: WalletTransactionDirection;
          p_reference_type?: string;
          p_reference_id?: string;
          p_description?: string;
        };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'];
      };
      request_withdrawal: {
        Args: {
          p_wallet_id: string;
          p_amount: number;
          p_description?: string;
        };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'];
      };
      finalize_wallet_transaction: {
        Args: {
          p_transaction_id: string;
          p_status: WalletTransactionStatus;
        };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'];
      };
      search_catalogue: {
        Args: {
          p_query?: string;
          p_brand_id?: string;
          p_category_id?: string;
          p_gender?: ProductGender;
          p_price_min?: number;
          p_price_max?: number;
          p_available_only?: boolean;
        };
        Returns: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          brand_id: string;
          brand_name: string;
          category_id: string;
          category_name: string;
          gender: ProductGender;
          collection: string | null;
          price: string;
          currency: SupportedCurrency;
          in_stock: boolean;
          primary_image_url: string | null;
        }[];
      };
      preview_merchant_listing: {
        Args: { p_product_id: string };
        Returns: {
          product_id: string;
          product_name: string;
          brand_name: string;
          category_name: string;
          primary_image_url: string | null;
          sales_price: string;
          wholesale_price: string;
          discount_percentage: string;
          listed: boolean;
          listing_id: string | null;
          listing_status: ListingStatus | null;
        }[];
      };
      create_merchant_listing: {
        Args: { p_product_id: string };
        Returns: Database['public']['Tables']['merchant_product_listings']['Row'];
      };
      remove_merchant_listing: {
        Args: { p_listing_id: string };
        Returns: Database['public']['Tables']['merchant_product_listings']['Row'];
      };
      merchant_wholesale_catalog: {
        Args: {
          p_query?: string;
          p_brand_id?: string;
          p_category_id?: string;
          p_gender?: ProductGender;
          p_price_min?: number;
          p_price_max?: number;
          p_available_only?: boolean;
        };
        Returns: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          brand_id: string;
          brand_name: string;
          category_id: string;
          category_name: string;
          gender: ProductGender;
          collection: string | null;
          price: string;
          currency: SupportedCurrency;
          in_stock: boolean;
          primary_image_url: string | null;
          sales_price: string;
          wholesale_price: string;
          listed: boolean;
          listing_id: string | null;
          listing_status: ListingStatus | null;
        }[];
      };
      merchant_listed_products: {
        Args: Record<string, never>;
        Returns: {
          listing_id: string;
          product_id: string;
          product_name: string;
          product_slug: string;
          brand_name: string;
          category_name: string;
          primary_image_url: string | null;
          sales_price: string;
          sales_price_snapshot: string;
          wholesale_price: string;
          listing_status: ListingStatus;
          listed_at: string;
        }[];
      };
      merchant_store_profile: {
        Args: Record<string, never>;
        Returns: {
          merchant_id: string;
          store_id: string | null;
          store_name: string;
          owner_name: string | null;
          owner_email: string;
          owner_phone: string | null;
          verification_status: VerificationStatus;
          account_status: MerchantStatus;
          wholesale_enabled: boolean;
        }[];
      };
      admin_search_merchants: {
        Args: { p_store_id?: string; p_query?: string };
        Returns: {
          merchant_id: string;
          store_id: string | null;
          store_name: string;
          owner_name: string | null;
          owner_email: string;
          owner_phone: string | null;
          verification_status: VerificationStatus;
          account_status: MerchantStatus;
          wholesale_enabled: boolean;
        }[];
      };
      admin_search_listings: {
        Args: {
          p_store_id?: string;
          p_merchant_id?: string;
          p_merchant_query?: string;
          p_product_query?: string;
          p_status?: ListingStatus;
        };
        Returns: {
          listing_id: string;
          merchant_id: string;
          store_id: string | null;
          store_name: string;
          merchant_name: string | null;
          product_id: string;
          product_name: string;
          sales_price: string;
          wholesale_price: string;
          listing_status: ListingStatus;
          listed_at: string;
        }[];
      };
      admin_set_listing_status: {
        Args: { p_listing_id: string; p_status: ListingStatus };
        Returns: Database['public']['Tables']['merchant_product_listings']['Row'];
      };
      admin_set_merchant_wholesale_access: {
        Args: { p_merchant_id: string; p_enabled: boolean };
        Returns: Database['public']['Tables']['merchants']['Row'];
      };
      admin_adjust_inventory: {
        Args: {
          p_variant_id: string;
          p_type: InventoryTransactionType;
          p_quantity: number;
          p_reference?: string;
        };
        Returns: Database['public']['Tables']['inventory']['Row'];
      };
      admin_set_product_publication: {
        Args: { p_product_id: string; p_published: boolean };
        Returns: Database['public']['Tables']['products']['Row'];
      };
      admin_archive_product: {
        Args: { p_product_id: string };
        Returns: Database['public']['Tables']['products']['Row'];
      };
      place_order: {
        Args: { p_merchant_id: string; p_items: Json };
        Returns: Database['public']['Tables']['orders']['Row'];
      };
      confirm_merchant_order: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['orders']['Row'];
      };
      merchant_go_for_shipping: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['orders']['Row'];
      };
      merchant_send_for_shipping: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['orders']['Row'];
      };
      cancel_order: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['orders']['Row'];
      };
      admin_confirm_delivery: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['orders']['Row'];
      };
      admin_complete_merchant_order: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['orders']['Row'];
      };
      release_wholesale_settlement: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'][];
      };
      order_is_settled: {
        Args: { p_order_id: string };
        Returns: boolean;
      };
      merchant_store_orders: {
        Args: Record<string, never>;
        Returns: {
          order_id: string;
          store_id: string;
          customer_id: string;
          customer_name: string | null;
          customer_email: string;
          status: OrderStatus;
          total_amount: string;
          currency: SupportedCurrency;
          created_at: string;
          item_id: string;
          listing_id: string | null;
          product_id: string;
          product_name: string;
          primary_image_url: string | null;
          quantity: number;
          sales_price: string;
          wholesale_price: string;
          unit_profit: string;
          merchant_profit: string;
          amount_required: string;
        }[];
      };
      admin_merchant_orders: {
        Args: {
          p_order_id?: string;
          p_store_id?: string;
          p_merchant_id?: string;
          p_product_query?: string;
        };
        Returns: {
          order_id: string;
          store_id: string;
          store_name: string;
          merchant_id: string;
          merchant_name: string | null;
          customer_id: string;
          customer_name: string | null;
          customer_email: string;
          status: OrderStatus;
          total_amount: string;
          currency: SupportedCurrency;
          created_at: string;
          amount_paid: string;
          item_id: string;
          listing_id: string | null;
          product_id: string;
          product_name: string;
          primary_image_url: string | null;
          quantity: number;
          sales_price: string;
          wholesale_price: string;
          unit_profit: string;
          merchant_profit: string;
          amount_required: string;
        }[];
      };
      admin_search_orders: {
        Args: {
          p_order_id?: string;
          p_store_id?: string;
          p_merchant_query?: string;
          p_customer_query?: string;
          p_status?: OrderStatus;
        };
        Returns: {
          order_id: string;
          store_id: string;
          store_name: string;
          merchant_id: string;
          merchant_name: string | null;
          customer_id: string;
          customer_name: string | null;
          customer_email: string;
          status: OrderStatus;
          total_amount: string;
          wholesale_due: string;
          currency: SupportedCurrency;
          created_at: string;
        }[];
      };
      admin_order_payments: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'][];
      };
      order_wholesale_due: {
        Args: { p_order_id: string };
        Returns: string;
      };
      admin_add_wallet_address: {
        Args: {
          p_asset: CryptoAsset;
          p_network: WalletNetwork;
          p_wallet_address: string;
        };
        Returns: Database['public']['Tables']['admin_wallet_addresses']['Row'];
      };
      admin_update_wallet_address: {
        Args: {
          p_id: string;
          p_wallet_address?: string;
          p_network?: WalletNetwork;
        };
        Returns: Database['public']['Tables']['admin_wallet_addresses']['Row'];
      };
      admin_set_wallet_address_status: {
        Args: { p_id: string; p_status: WalletAddressStatus };
        Returns: Database['public']['Tables']['admin_wallet_addresses']['Row'];
      };
      admin_delete_wallet_address: {
        Args: { p_id: string };
        Returns: Database['public']['Tables']['admin_wallet_addresses']['Row'];
      };
      merchant_deposit_addresses: {
        Args: { p_asset: CryptoAsset; p_network: WalletNetwork };
        Returns: Database['public']['Tables']['admin_wallet_addresses']['Row'][];
      };
      create_deposit_request: {
        Args: {
          p_amount: number;
          p_asset: CryptoAsset;
          p_network: WalletNetwork;
        };
        Returns: Database['public']['Tables']['wallet_deposit_requests']['Row'];
      };
      admin_search_deposits: {
        Args: {
          p_status?: DepositRequestStatus;
          p_store_id?: string;
          p_merchant_query?: string;
        };
        Returns: {
          request_id: string;
          merchant_id: string;
          store_id: string | null;
          store_name: string;
          merchant_name: string | null;
          amount: string;
          asset: CryptoAsset;
          network: WalletNetwork;
          wallet_address_used: string;
          status: DepositRequestStatus;
          created_at: string;
        }[];
      };
      admin_approve_deposit: {
        Args: { p_request_id: string };
        Returns: Database['public']['Tables']['wallet_deposit_requests']['Row'];
      };
      admin_reject_deposit: {
        Args: { p_request_id: string };
        Returns: Database['public']['Tables']['wallet_deposit_requests']['Row'];
      };
      create_withdrawal_request: {
        Args: {
          p_asset: CryptoAsset;
          p_network: WalletNetwork;
          p_amount: number;
          p_destination_address: string;
        };
        Returns: Database['public']['Tables']['withdrawal_requests']['Row'];
      };
      admin_search_withdrawals: {
        Args: {
          p_status?: WithdrawalRequestStatus;
          p_store_id?: string;
          p_merchant_query?: string;
        };
        Returns: {
          request_id: string;
          merchant_id: string;
          store_id: string | null;
          store_name: string;
          merchant_name: string | null;
          amount: string;
          asset: CryptoAsset;
          network: WalletNetwork;
          destination_address: string;
          status: WithdrawalRequestStatus;
          created_at: string;
        }[];
      };
      admin_approve_withdrawal: {
        Args: { p_request_id: string };
        Returns: Database['public']['Tables']['withdrawal_requests']['Row'];
      };
      admin_reject_withdrawal: {
        Args: { p_request_id: string };
        Returns: Database['public']['Tables']['withdrawal_requests']['Row'];
      };
      admin_adjust_merchant_wallet: {
        Args: {
          p_merchant_id: string;
          p_currency: SupportedCurrency;
          p_amount: number;
          p_direction: WalletTransactionDirection;
          p_reason: string;
        };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'];
      };
      submit_merchant_application: {
        Args: {
          p_store_name: string;
          p_business_description?: string;
          p_country?: string;
          p_documents?: Json;
        };
        Returns: Database['public']['Tables']['merchant_applications']['Row'];
      };
      my_merchant_applications: {
        Args: Record<string, never>;
        Returns: Database['public']['Tables']['merchant_applications']['Row'][];
      };
      admin_search_users: {
        Args: {
          p_email?: string;
          p_user_id?: string;
          p_store_id?: string;
          p_merchant_id?: string;
          p_query?: string;
        };
        Returns: {
          user_id: string;
          profile_id: string;
          full_name: string | null;
          email: string;
          phone: string | null;
          country: string | null;
          role: UserRole;
          status: ProfileStatus;
          created_at: string;
          last_login: string | null;
          merchant_id: string | null;
          store_id: string | null;
          store_name: string | null;
        }[];
      };
      admin_set_user_status: {
        Args: { p_user_id: string; p_status: ProfileStatus };
        Returns: Database['public']['Tables']['profiles']['Row'];
      };
      admin_search_applications: {
        Args: { p_status?: MerchantApplicationStatus; p_query?: string };
        Returns: {
          application_id: string;
          user_id: string;
          applicant_name: string | null;
          applicant_email: string;
          store_name: string;
          store_id: string | null;
          merchant_id: string | null;
          documents: Json;
          country: string;
          status: MerchantApplicationStatus;
          submitted_at: string;
          reviewed_at: string | null;
        }[];
      };
      admin_approve_merchant_application: {
        Args: { p_id: string };
        Returns: {
          application_id: string | null;
          merchant_id: string;
          store_id: string | null;
          user_id: string;
          role: UserRole;
          store_name: string;
          status: string;
        }[];
      };
      admin_reject_merchant_application: {
        Args: { p_id: string; p_reason?: string };
        Returns: {
          application_id: string | null;
          merchant_id: string | null;
          user_id: string;
          status: string;
        }[];
      };
      shop_details: {
        Args: { p_store_id?: string };
        Returns: {
          store_id: string;
          store_name: string;
          logo: string | null;
          description: string | null;
          owner_user_id: string;
          owner_name: string | null;
          owner_email: string;
          owner_phone: string | null;
          country: string | null;
          status: StoreStatus;
          approval_date: string | null;
          merchant_id: string;
          verification_status: VerificationStatus;
          merchant_status: MerchantStatus;
          wholesale_enabled: boolean;
        }[];
      };
      shop_statistics: {
        Args: { p_store_id?: string };
        Returns: {
          store_id: string;
          merchant_id: string;
          total_products_listed: number;
          active_products: number;
          removed_products: number;
          total_orders: number;
          todays_orders: number;
          completed_orders: number;
          pending_orders: number;
          total_sales: string;
          todays_sales: string;
          total_profit: string;
          todays_profit: string;
          total_followers: number;
          credit_score: string;
        }[];
      };
      shop_financials: {
        Args: { p_store_id?: string };
        Returns: {
          currency: SupportedCurrency;
          wallet_id: string;
          wallet_balance: string;
          total_deposits: string;
          total_withdrawals: string;
          order_payments: string;
          profit_releases: string;
          refunds: string;
          wholesale_returns: string;
        }[];
      };
      store_shop_products: {
        Args: { p_store_id?: string };
        Returns: {
          listing_id: string;
          product_id: string;
          image: string | null;
          name: string;
          category: string;
          sales_price: string;
          profit: string;
          listing_date: string;
          status: ListingStatus;
        }[];
      };
      store_shop_orders: {
        Args: { p_store_id?: string };
        Returns: {
          order_id: string;
          product: string;
          customer_id: string;
          customer_name: string | null;
          customer_email: string;
          amount: string;
          wholesale_amount: string;
          profit: string;
          status: OrderStatus;
          created_at: string;
        }[];
      };
      admin_search_stores: {
        Args: {
          p_store_id?: string;
          p_merchant_id?: string;
          p_store_name?: string;
          p_email?: string;
        };
        Returns: {
          store_id: string;
          store_name: string;
          merchant_id: string;
          owner_name: string | null;
          owner_email: string;
          country: string;
          status: StoreStatus;
          verification_status: VerificationStatus;
          wholesale_enabled: boolean;
          created_at: string;
        }[];
      };
      admin_set_store_status: {
        Args: { p_store_id: string; p_status: StoreStatus; p_reason?: string };
        Returns: Database['public']['Tables']['stores']['Row'];
      };
      admin_adjust_store_wallet: {
        Args: {
          p_store_id: string;
          p_amount: number;
          p_direction: WalletTransactionDirection;
          p_reason: string;
          p_currency?: SupportedCurrency;
        };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'];
      };
      admin_adjust_credit_score: {
        Args: { p_merchant_id: string; p_score: number; p_reason: string };
        Returns: Database['public']['Tables']['merchant_credit_scores']['Row'];
      };
      admin_adjust_store_credit: {
        Args: { p_store_id: string; p_score: number; p_reason: string };
        Returns: Database['public']['Tables']['merchant_credit_scores']['Row'];
      };
      admin_set_store_wholesale_access: {
        Args: { p_store_id: string; p_enabled: boolean };
        Returns: Database['public']['Tables']['merchants']['Row'];
      };
      admin_search_activity_logs: {
        Args: { p_action?: string; p_target_type?: string; p_limit?: number };
        Returns: Database['public']['Tables']['admin_activity_logs']['Row'][];
      };
      current_merchant_credit_score: {
        Args: { p_merchant_id: string };
        Returns: string;
      };
      resolve_shop_store_id: {
        Args: { p_store_id?: string };
        Returns: string;
      };
      merchant_credit_history: {
        Args: Record<string, never>;
        Returns: Database['public']['Tables']['merchant_credit_scores']['Row'][];
      };
      release_order_profit: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'];
      };
      create_notification: {
        Args: {
          p_user_id: string;
          p_type: NotificationType;
          p_title: string;
          p_message: string;
          p_data?: Json;
        };
        Returns: Database['public']['Tables']['notifications']['Row'];
      };
      notify_admins: {
        Args: {
          p_type: NotificationType;
          p_title: string;
          p_message: string;
          p_data?: Json;
        };
        Returns: number;
      };
      notify_order_payment_required: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['notifications']['Row'];
      };
      my_notifications: {
        Args: Record<string, never>;
        Returns: Database['public']['Tables']['notifications']['Row'][];
      };
      notification_unread_count: {
        Args: Record<string, never>;
        Returns: number;
      };
      mark_notification_read: {
        Args: { p_id: string };
        Returns: Database['public']['Tables']['notifications']['Row'];
      };
      mark_all_notifications_read: {
        Args: Record<string, never>;
        Returns: number;
      };
      order_notification_payload: {
        Args: { p_order_id: string };
        Returns: Json;
      };
      merchant_user_id: {
        Args: { p_merchant_id: string };
        Returns: string;
      };
      store_displayed_viewer_count: {
        Args: { p_store_id: string };
        Returns: number;
      };
      admin_adjust_store_viewers: {
        Args: {
          p_store_id: string;
          p_viewer_count: number;
          p_reason: string;
        };
        Returns: Database['public']['Tables']['store_viewer_settings']['Row'];
      };
      admin_enrich_historical_run_counts: {
        Args: { p_run_id: string };
        Returns: Json;
      };
      admin_resolve_historical_target: {
        Args: { p_user_id: string };
        Returns: Json;
      };
      admin_preview_historical_data: {
        Args: {
          p_user_id: string;
          p_categories: string[];
          p_activity_level: HistoricalActivityLevel;
          p_preset: string;
          p_from?: string;
          p_to?: string;
        };
        Returns: Json;
      };
      admin_start_historical_run: {
        Args: {
          p_user_id: string;
          p_categories: string[];
          p_activity_level: HistoricalActivityLevel;
          p_preset: string;
          p_confirm: boolean;
          p_idempotency_key?: string;
          p_from?: string;
          p_to?: string;
        };
        Returns: Database['public']['Tables']['admin_historical_data_runs']['Row'];
      };
      admin_execute_historical_run: {
        Args: { p_run_id: string };
        Returns: Database['public']['Tables']['admin_historical_data_runs']['Row'];
      };
      admin_fail_historical_run: {
        Args: { p_run_id: string; p_error?: string };
        Returns: Database['public']['Tables']['admin_historical_data_runs']['Row'];
      };
      admin_reverse_historical_run: {
        Args: { p_run_id: string };
        Returns: Database['public']['Tables']['admin_historical_data_runs']['Row'];
      };
      admin_get_historical_run: {
        Args: { p_run_id: string };
        Returns: Database['public']['Tables']['admin_historical_data_runs']['Row'];
      };
      admin_list_historical_runs: {
        Args: { p_user_id: string };
        Returns: Database['public']['Tables']['admin_historical_data_runs']['Row'][];
      };
      admin_user_historical_overview: {
        Args: { p_user_id: string };
        Returns: Json;
      };
    };
    Enums: {
      user_role: UserRole;
      profile_status: ProfileStatus;
      verification_status: VerificationStatus;
      merchant_status: MerchantStatus;
      store_status: StoreStatus;
      merchant_application_status: MerchantApplicationStatus;
      supported_currency: SupportedCurrency;
      wallet_transaction_type: WalletTransactionType;
      wallet_transaction_status: WalletTransactionStatus;
      wallet_transaction_direction: WalletTransactionDirection;
      product_status: ProductStatus;
      product_gender: ProductGender;
      brand_status: BrandStatus;
      inventory_transaction_type: InventoryTransactionType;
      listing_status: ListingStatus;
      order_status: OrderStatus;
      crypto_asset: CryptoAsset;
      wallet_network: WalletNetwork;
      wallet_address_status: WalletAddressStatus;
      deposit_request_status: DepositRequestStatus;
      withdrawal_request_status: WithdrawalRequestStatus;
      notification_type: NotificationType;
      notification_read_status: NotificationReadStatus;
      historical_run_status: HistoricalRunStatus;
      historical_activity_level: HistoricalActivityLevel;
    };
    CompositeTypes: Record<string, never>;
  };
}

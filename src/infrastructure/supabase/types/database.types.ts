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
export type SupportedCurrency = 'USD' | 'BTC' | 'ETH' | 'USDT';
export type WalletTransactionType =
  | 'deposit'
  | 'withdrawal'
  | 'order_payment'
  | 'admin_adjustment'
  | 'refund'
  | 'profit_release';
export type WalletTransactionStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type WalletTransactionDirection = 'credit' | 'debit';
export type ProductStatus = 'draft' | 'active' | 'archived';
export type ListingStatus = 'pending' | 'active' | 'suspended' | 'inactive';
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

type RowInsertUpdate<TRow, TInsert, TUpdate> = {
  Row: TRow;
  Insert: TInsert;
  Update: TUpdate;
  Relationships: unknown[];
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
          updated_at?: string;
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
          description: string | null;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          name: string;
          slug: string;
          description?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          name?: string;
          slug?: string;
          description?: string | null;
          updated_at?: string;
        }
      >;
      products: RowInsertUpdate<
        {
          id: string;
          name: string;
          description: string | null;
          brand_id: string;
          category_id: string;
          price: string;
          currency: SupportedCurrency;
          status: ProductStatus;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          name: string;
          description?: string | null;
          brand_id: string;
          category_id: string;
          price: string;
          currency?: SupportedCurrency;
          status?: ProductStatus;
          created_at?: string;
          updated_at?: string;
        },
        {
          name?: string;
          description?: string | null;
          brand_id?: string;
          category_id?: string;
          price?: string;
          currency?: SupportedCurrency;
          status?: ProductStatus;
          updated_at?: string;
        }
      >;
      product_images: RowInsertUpdate<
        {
          id: string;
          product_id: string;
          storage_path: string;
          alt_text: string | null;
          sort_order: number;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          product_id: string;
          storage_path: string;
          alt_text?: string | null;
          sort_order?: number;
          created_at?: string;
          updated_at?: string;
        },
        {
          storage_path?: string;
          alt_text?: string | null;
          sort_order?: number;
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
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          product_id: string;
          size?: string | null;
          color?: string | null;
          sku: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          size?: string | null;
          color?: string | null;
          sku?: string;
          updated_at?: string;
        }
      >;
      inventory: RowInsertUpdate<
        {
          id: string;
          variant_id: string;
          quantity: number;
          availability: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          variant_id: string;
          quantity?: number;
          availability?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          quantity?: number;
          availability?: boolean;
          updated_at?: string;
        }
      >;
      merchant_product_listings: RowInsertUpdate<
        {
          id: string;
          merchant_id: string;
          product_id: string;
          sales_price: string;
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
    };
    Views: {
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
        Relationships: unknown[];
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
        };
        Relationships: unknown[];
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
      place_order: {
        Args: { p_merchant_id: string; p_items: Json };
        Returns: Database['public']['Tables']['orders']['Row'];
      };
      release_order_profit: {
        Args: { p_order_id: string };
        Returns: Database['public']['Tables']['wallet_transactions']['Row'];
      };
    };
    Enums: {
      user_role: UserRole;
      profile_status: ProfileStatus;
      verification_status: VerificationStatus;
      merchant_status: MerchantStatus;
      store_status: StoreStatus;
      supported_currency: SupportedCurrency;
      wallet_transaction_type: WalletTransactionType;
      wallet_transaction_status: WalletTransactionStatus;
      wallet_transaction_direction: WalletTransactionDirection;
      product_status: ProductStatus;
      listing_status: ListingStatus;
      order_status: OrderStatus;
    };
  };
}

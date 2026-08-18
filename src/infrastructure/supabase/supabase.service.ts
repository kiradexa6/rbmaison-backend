import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from './types/database.types';

export type TypedSupabaseClient = SupabaseClient<Database>;

@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly url?: string;
  private readonly anonKey?: string;
  private readonly serviceRoleKey?: string;
  private adminClient: TypedSupabaseClient | null = null;

  constructor(private readonly configService: ConfigService) {
    this.url = this.configService.get<string>('supabase.url');
    this.anonKey = this.configService.get<string>('supabase.anonKey');
    this.serviceRoleKey = this.configService.get<string>(
      'supabase.serviceRoleKey',
    );

    if (this.isConfigured()) {
      this.logger.log('Supabase client configured');
    } else {
      this.logger.warn(
        'Supabase is not fully configured. Database operations will fail until environment variables are set.',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.url && this.anonKey && this.serviceRoleKey);
  }

  getPublicUrl(): string | undefined {
    return this.url;
  }

  getAdminClient(): TypedSupabaseClient {
    if (!this.url || !this.serviceRoleKey) {
      throw new Error(
        'Supabase service role client is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
      );
    }

    // Service role bypasses RLS. It must stay on the API server and never
    // be returned to a browser, mobile app, or public health payload.

    if (!this.adminClient) {
      this.adminClient = createClient<Database>(this.url, this.serviceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    }

    return this.adminClient;
  }

  getAnonClient(): TypedSupabaseClient {
    if (!this.url || !this.anonKey) {
      throw new Error(
        'Supabase anon client is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.',
      );
    }

    return createClient<Database>(this.url, this.anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  asUser(accessToken: string): TypedSupabaseClient {
    if (!this.url || !this.anonKey) {
      throw new Error(
        'Supabase anon client is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.',
      );
    }

    if (!accessToken) {
      throw new Error('Access token is required for RLS-scoped queries');
    }

    return createClient<Database>(this.url, this.anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
}

import { ConfigService } from '@nestjs/config';
import { SupabaseService } from './supabase.service';

describe('SupabaseService', () => {
  it('reports unconfigured when credentials are missing', () => {
    const config = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    const service = new SupabaseService(config);

    expect(service.isConfigured()).toBe(false);
    expect(() => service.getAdminClient()).toThrow(/not configured/);
  });

  it('requires an access token for user-scoped clients', () => {
    const config = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          'supabase.url': 'http://127.0.0.1:54321',
          'supabase.anonKey': 'anon-key',
          'supabase.serviceRoleKey': 'service-role-key',
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    const service = new SupabaseService(config);

    expect(service.isConfigured()).toBe(true);
    expect(() => service.asUser('')).toThrow(/Access token/);
    expect(service.getPublicUrl()).toBe('http://127.0.0.1:54321');
    expect(service.getAnonClient()).toBeDefined();
  });
});

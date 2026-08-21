import { extractSupabaseProjectRef, isLocalSupabaseUrl } from './supabase-project.util';

describe('supabase-project.util', () => {
  it('extracts hosted project ref from Supabase URL', () => {
    expect(
      extractSupabaseProjectRef('https://sbcyoaswsjfhhkypdniu.supabase.co'),
    ).toBe('sbcyoaswsjfhhkypdniu');
  });

  it('detects local Supabase URLs', () => {
    expect(isLocalSupabaseUrl('http://127.0.0.1:54321')).toBe(true);
    expect(isLocalSupabaseUrl('https://sbcyoaswsjfhhkypdniu.supabase.co')).toBe(
      false,
    );
  });
});

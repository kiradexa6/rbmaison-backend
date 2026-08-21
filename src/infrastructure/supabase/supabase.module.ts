import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [SupabaseService, StorageService],
  exports: [SupabaseService, StorageService],
})
export class SupabaseModule {}

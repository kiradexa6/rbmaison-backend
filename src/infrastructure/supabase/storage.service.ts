import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  STORAGE_BUCKETS,
} from './supabase.constants';
import { SupabaseService } from './supabase.service';
import { AuthenticatedUser } from '../../modules/auth/interfaces/authenticated-user.interface';
import { mapSupabaseError } from '../../modules/products/supabase-error';

export type UploadedObject = {
  bucket: string;
  storagePath: string;
  publicUrl: string | null;
  mimeType: string;
};

@Injectable()
export class StorageService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async uploadForUser(
    user: AuthenticatedUser,
    bucket: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
    folder: string,
  ): Promise<UploadedObject> {
    const client = this.client(user);
    const extension = file.originalname.split('.').pop() ?? 'bin';
    const safeName =
      file.originalname
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .slice(0, 80) || 'file';
    const storagePath = `${folder}/${Date.now()}-${safeName}.${extension}`;

    const { error } = await client.storage.from(bucket).upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

    if (error) {
      throw mapSupabaseError(error, 'File upload failed');
    }

    return {
      bucket,
      storagePath,
      publicUrl: this.publicUrl(bucket, storagePath),
      mimeType: file.mimetype,
    };
  }

  async uploadApplicationDocument(
    user: AuthenticatedUser,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    this.assertAllowedDocumentMime(file.mimetype);
    return this.uploadForUser(
      user,
      STORAGE_BUCKETS.APPLICATION_DOCUMENTS,
      file,
      user.id,
    );
  }

  async uploadStoreLogo(
    user: AuthenticatedUser,
    merchantId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    this.assertAllowedImageMime(file.mimetype);
    return this.uploadForUser(
      user,
      STORAGE_BUCKETS.STORE_LOGOS,
      file,
      merchantId,
    );
  }

  async uploadAvatar(
    user: AuthenticatedUser,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    this.assertAllowedImageMime(file.mimetype);
    return this.uploadForUser(user, STORAGE_BUCKETS.AVATARS, file, user.id);
  }

  private publicUrl(bucket: string, storagePath: string): string | null {
    const baseUrl = this.supabaseService.getPublicUrl();
    if (!baseUrl) {
      return storagePath;
    }

    if (bucket === STORAGE_BUCKETS.APPLICATION_DOCUMENTS) {
      return null;
    }

    return `${baseUrl}/storage/v1/object/public/${bucket}/${storagePath}`;
  }

  private assertAllowedDocumentMime(mimeType: string) {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
    ];
    if (!allowed.includes(mimeType)) {
      throw new UnprocessableEntityException(
        'Document must be JPEG, PNG, WEBP, or PDF',
      );
    }
  }

  private assertAllowedImageMime(mimeType: string) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(mimeType)) {
      throw new UnprocessableEntityException(
        'Image must be JPEG, PNG, or WEBP',
      );
    }
  }

  private client(user: AuthenticatedUser) {
    if (!this.supabaseService.isConfigured()) {
      throw new ServiceUnavailableException('Supabase is not configured');
    }
    return this.supabaseService.asUser(user.accessToken);
  }
}

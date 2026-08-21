import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { StorageService } from '../../infrastructure/supabase/storage.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import type { Json } from '../../infrastructure/supabase/types/database.types';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { assertSupabase } from '../products/supabase-error';
import {
  ApplicationDocumentDto,
  SubmitMerchantApplicationDto,
} from './dto/merchant.dto';

@Injectable()
export class StoreApplicationsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly storageService: StorageService,
  ) {}

  async uploadDocument(
    user: AuthenticatedUser,
    file: { originalname: string; mimetype: string; buffer: Buffer },
    kind: ApplicationDocumentDto['kind'],
  ) {
    const uploaded = await this.storageService.uploadApplicationDocument(
      user,
      file,
    );
    return {
      kind,
      storagePath: uploaded.storagePath,
      publicUrl: uploaded.publicUrl,
      mimeType: uploaded.mimeType,
      uploadedAt: new Date().toISOString(),
    };
  }

  async create(user: AuthenticatedUser, dto: SubmitMerchantApplicationDto) {
    const documents = this.normalizeDocuments(dto);
    this.validateIdentityDocuments(dto.identityDocumentType, documents);

    const { data, error } = await this.client(user).rpc(
      'submit_merchant_application',
      {
        p_store_name: dto.storeName.trim(),
        p_business_description: dto.businessDescription?.trim() || undefined,
        p_country: dto.country?.trim() || undefined,
        p_documents: documents as unknown as Json,
        p_phone: dto.phone?.trim() || undefined,
        p_address: dto.address?.trim() || undefined,
        p_identity_document_type: dto.identityDocumentType,
        p_logo: dto.logo?.trim() || undefined,
      },
    );
    return assertSupabase({ data, error });
  }

  async mine(user: AuthenticatedUser) {
    const { data, error } = await this.client(user).rpc(
      'my_merchant_applications',
    );
    return assertSupabase({ data, error }) ?? [];
  }

  async latest(user: AuthenticatedUser) {
    const rows = await this.mine(user);
    const application = rows[0];
    if (!application) {
      throw new NotFoundException('Store application not found');
    }
    return application;
  }

  private normalizeDocuments(dto: SubmitMerchantApplicationDto) {
    const structured = (dto.documents ?? []).map((document) => ({
      kind: document.kind,
      storagePath: document.storagePath.trim(),
      publicUrl: document.publicUrl?.trim() || null,
      mimeType: document.mimeType?.trim() || null,
      uploadedAt: new Date().toISOString(),
    }));

    const legacy = (dto.documentPaths ?? []).map((path) => ({
      kind: 'other' as const,
      storagePath: path.trim(),
      publicUrl: null,
      mimeType: null,
      uploadedAt: new Date().toISOString(),
    }));

    return [...structured, ...legacy];
  }

  private validateIdentityDocuments(
    identityDocumentType: SubmitMerchantApplicationDto['identityDocumentType'],
    documents: Array<{ kind: string }>,
  ) {
    if (identityDocumentType === 'passport') {
      if (!documents.some((document) => document.kind === 'passport')) {
        throw new UnprocessableEntityException('Passport document is required');
      }
      return;
    }

    const hasFront = documents.some(
      (document) => document.kind === 'national_id_front',
    );
    const hasBack = documents.some(
      (document) => document.kind === 'national_id_back',
    );
    if (!hasFront || !hasBack) {
      throw new UnprocessableEntityException(
        'National ID front and back documents are required',
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

import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  ApplicationDocumentDto,
  SubmitMerchantApplicationDto,
  UpdateMerchantStoreDto,
} from './dto/merchant.dto';
import { MerchantStoreService } from './merchant-store.service';
import { StoreApplicationsService } from './store-applications.service';

@Controller('store-applications')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('customer')
export class StoreApplicationsController {
  constructor(
    private readonly storeApplicationsService: StoreApplicationsService,
  ) {}

  @Post('documents/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile()
    file: { originalname: string; mimetype: string; buffer: Buffer },
    @Body('kind') kind: ApplicationDocumentDto['kind'],
  ) {
    return this.storeApplicationsService.uploadDocument(user, file, kind);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitMerchantApplicationDto,
  ) {
    return this.storeApplicationsService.create(user, dto);
  }

  @Get('me')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.storeApplicationsService.mine(user);
  }
}

@Controller('merchant')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('merchant')
export class MerchantStoreController {
  constructor(private readonly merchantStoreService: MerchantStoreService) {}

  @Get('store')
  getStore(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantStoreService.getStore(user);
  }

  @Patch('store')
  updateStore(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMerchantStoreDto,
  ) {
    return this.merchantStoreService.updateStore(user, dto);
  }

  @Post('store/logo/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadLogo(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile()
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ) {
    return this.merchantStoreService.uploadLogo(user, file);
  }

  @Get('shop-details')
  shopDetails(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantStoreService.shopDetails(user);
  }

  @Get('shop-statistics')
  shopStatistics(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantStoreService.shopStatistics(user);
  }
}

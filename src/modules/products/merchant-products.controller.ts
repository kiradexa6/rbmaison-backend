import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  CreateListingDto,
  PreviewListingDto,
  SearchCatalogueQueryDto,
} from './dto/product.dto';
import { MerchantListingsService } from './merchant-listings.service';

@Controller('merchant')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('merchant')
export class MerchantProductsController {
  constructor(
    private readonly merchantListingsService: MerchantListingsService,
  ) {}

  @Get('wholesale/products')
  wholesaleCatalogue(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchCatalogueQueryDto,
  ) {
    return this.merchantListingsService.wholesaleCatalogue(user, query);
  }

  @Post('wholesale/preview')
  previewListing(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PreviewListingDto,
  ) {
    return this.merchantListingsService.previewListing(user, dto);
  }

  @Post('listings')
  createListing(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateListingDto,
  ) {
    return this.merchantListingsService.createListing(user, dto);
  }

  @Delete('listings/:listingId')
  removeListing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    return this.merchantListingsService.removeListing(user, listingId);
  }

  @Get('products')
  myProducts(@CurrentUser() user: AuthenticatedUser) {
    return this.merchantListingsService.myProducts(user);
  }

  @Get('products/:listingId')
  getListedProduct(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId', ParseUUIDPipe) listingId: string,
  ) {
    return this.merchantListingsService.getListedProduct(user, listingId);
  }
}

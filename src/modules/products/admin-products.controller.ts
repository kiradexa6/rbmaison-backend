import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
import { AdminProductsService } from './admin-products.service';
import {
  AdjustInventoryDto,
  CreateBrandDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateProductImageDto,
  CreateVariantDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/product.dto';

@Controller('admin')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class AdminProductsController {
  constructor(private readonly adminProductsService: AdminProductsService) {}

  @Get('products')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.adminProductsService.listProducts(user);
  }

  @Post('products')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProductDto,
  ) {
    return this.adminProductsService.createProduct(user, dto);
  }

  @Patch('products/:id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.adminProductsService.updateProduct(user, id, dto);
  }

  @Post('products/:id/publish')
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminProductsService.publish(user, id);
  }

  @Post('products/:id/unpublish')
  unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminProductsService.unpublish(user, id);
  }

  @Delete('products/:id')
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.adminProductsService.archive(user, id);
  }

  @Post('products/:id/images')
  addImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateProductImageDto,
  ) {
    return this.adminProductsService.addImage(user, id, dto);
  }

  @Post('products/:id/images/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile()
    file: { originalname: string; mimetype: string; buffer: Buffer },
    @Body() body: { altText?: string; isPrimary?: string },
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Image file is required');
    }
    return this.adminProductsService.uploadImage(user, id, file, {
      altText: body.altText,
      isPrimary: body.isPrimary === 'true',
    });
  }

  @Post('products/:id/images/:imageId/primary')
  setPrimary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.adminProductsService.setPrimaryImage(user, id, imageId);
  }

  @Delete('products/:id/images/:imageId')
  deleteImage(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.adminProductsService.deleteImage(user, id, imageId);
  }

  @Post('products/:id/variants')
  addVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.adminProductsService.addVariant(user, id, dto);
  }

  @Patch('variants/:id')
  updateVariant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.adminProductsService.updateVariant(user, id, dto);
  }

  @Post('variants/:id/inventory')
  adjustInventory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustInventoryDto,
  ) {
    return this.adminProductsService.adjustInventory(user, id, dto);
  }

  @Get('inventory-transactions')
  inventoryTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('variantId') variantId?: string,
  ) {
    return this.adminProductsService.listInventoryTransactions(
      user,
      variantId,
    );
  }

  @Post('brands')
  createBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBrandDto,
  ) {
    return this.adminProductsService.createBrand(user, dto);
  }

  @Patch('brands/:id')
  updateBrand(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.adminProductsService.updateBrand(user, id, dto);
  }

  @Post('categories')
  createCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.adminProductsService.createCategory(user, dto);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.adminProductsService.updateCategory(user, id, dto);
  }
}

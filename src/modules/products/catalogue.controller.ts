import { Controller, Get, Param, Query } from '@nestjs/common';
import { CatalogueService } from './catalogue.service';
import { SearchCatalogueQueryDto } from './dto/product.dto';

@Controller('catalogue')
export class CatalogueController {
  constructor(private readonly catalogueService: CatalogueService) {}

  @Get('products')
  search(@Query() query: SearchCatalogueQueryDto) {
    return this.catalogueService.search(query);
  }

  @Get('products/:idOrSlug')
  getOne(@Param('idOrSlug') idOrSlug: string) {
    return this.catalogueService.getByIdOrSlug(idOrSlug);
  }

  @Get('brands')
  brands() {
    return this.catalogueService.listBrands();
  }

  @Get('categories')
  categories() {
    return this.catalogueService.listCategories();
  }
}

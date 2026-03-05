import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query('category') categorySlug?: string) {
    return this.productsService.findAll(categorySlug);
  }

  @Get(':asin')
  findOne(@Param('asin') asin: string) {
    return this.productsService.findByAsin(asin);
  }
}

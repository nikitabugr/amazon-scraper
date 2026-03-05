import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ScrapingModule } from './scraping/scraping.module';
import { ProductsModule } from './products/products.module';
import { ReviewsModule } from './reviews/reviews.module';

@Module({
  imports: [
    DatabaseModule,
    ScrapingModule,
    ProductsModule,
    ReviewsModule,
  ],
})
export class AppModule {}

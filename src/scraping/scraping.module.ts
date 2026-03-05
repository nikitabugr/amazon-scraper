import { Module } from '@nestjs/common';
import { HttpService } from './http.service';
import { CategoryParser } from './parsers/category.parser';
import { ReviewsParser } from './parsers/reviews.parser';
import { ScrapingService } from './scraping.service';
import { ScrapingController } from './scraping.controller';

@Module({
  providers: [HttpService, CategoryParser, ReviewsParser, ScrapingService],
  controllers: [ScrapingController],
  exports: [ScrapingService],
})
export class ScrapingModule {}

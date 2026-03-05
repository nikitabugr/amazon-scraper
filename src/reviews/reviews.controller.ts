import { Controller, Get, Param, Query } from '@nestjs/common';
import { ReviewsService } from './reviews.service';

@Controller('products/:asin/reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  findAll(
    @Param('asin') asin: string,
    @Query('limit') limit = 20,
    @Query('page') page = 1,
  ) {
    return this.reviewsService.findByAsin(asin, +limit, +page);
  }
}

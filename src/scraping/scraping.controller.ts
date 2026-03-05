import { Controller, Post, Param, Get, Logger } from '@nestjs/common';
import { ScrapingService } from './scraping.service';
import { PrismaService } from '../database/prisma.service';

@Controller('scrape')
export class ScrapingController {
  private readonly logger = new Logger(ScrapingController.name);

  constructor(
    private readonly scrapingService: ScrapingService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('category/:slug')
  async scrapeCategory(@Param('slug') slug: string) {
    this.logger.log(`Scrape triggered for category: ${slug}`);
    this.scrapingService.scrapeCategory(slug).catch(err =>
      this.logger.error(`Scrape failed: ${err}`)
    );
    return { message: `Scraping started for category: ${slug}`, status: 'running' };
  }

  @Post('reviews/:asin')
  async scrapeReviews(@Param('asin') asin: string) {
    const product = await this.prisma.product.findUnique({
      where: { asin },
      select: { id: true, asin: true, lastScrapedAt: true },
    });

    if (!product) {
      return { error: `Product ${asin} not found. Scrape a category first.` };
    }

    this.logger.log(`Review scrape triggered for ASIN: ${asin}`);
    this.scrapingService.scrapeProductReviews(product.id, product.asin, product.lastScrapedAt).catch(err =>
      this.logger.error(`Review scrape failed: ${err}`),
    );
    return { message: `Review scraping started for ASIN: ${asin}`, status: 'running' };
  }

  @Get('jobs')
  async getJobs() {
    return this.prisma.scrapeJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}

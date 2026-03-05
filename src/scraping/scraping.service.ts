import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { CategoryParser } from './parsers/category.parser';
import { ReviewsParser } from './parsers/reviews.parser';
import { JobStatus, ScrapeType } from '@prisma/client';

@Injectable()
export class ScrapingService {
  private readonly logger = new Logger(ScrapingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryParser: CategoryParser,
    private readonly reviewsParser: ReviewsParser,
  ) {}

  async scrapeCategory(categorySlug: string): Promise<void> {
    let category = await this.prisma.category.findUnique({
      where: { slug: categorySlug },
    });

    if (!category) {
      const amazonPath = `/s?k=${encodeURIComponent(categorySlug)}`;
      category = await this.prisma.category.create({
        data: {
          name: categorySlug,
          slug: categorySlug,
          amazonPath,
        },
      });
      this.logger.log(`Created category ${categorySlug} with amazonPath ${amazonPath}`);
    } else if (!category.amazonPath) {
      const amazonPath = `/s?k=${encodeURIComponent(categorySlug)}`;
      category = await this.prisma.category.update({
        where: { id: category.id },
        data: { amazonPath },
      });
      this.logger.log(`Updated category ${categorySlug} with amazonPath ${amazonPath}`);
    }

    const job = await this.prisma.scrapeJob.create({
      data: { type: ScrapeType.CATEGORY, status: JobStatus.RUNNING, categorySlug, startedAt: new Date() },
    });

    this.logger.log(`Starting category scrape: ${categorySlug}`);

    try {
      const url = `https://www.amazon.com${category.amazonPath}`;
      const products = await this.categoryParser.parseCategory(url, 10);

      this.logger.log(`Parsed ${products.length} products, saving to DB...`);

      let saved = 0;
      for (const p of products) {
        await this.upsertProduct(p, category.id);
        saved++;
      }

      await this.prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.DONE,
          itemsFound: products.length,
          itemsSaved: saved,
          finishedAt: new Date(),
        },
      });

      this.logger.log(`Category scrape done. Saved ${saved}/${products.length} products`);

      await this.scrapeReviewsForCategory(categorySlug);

    } catch (error) {
      await this.prisma.scrapeJob.update({
        where: { id: job.id },
        data: { status: JobStatus.FAILED, errorMessage: String(error), finishedAt: new Date() },
      });
      this.logger.error(`Category scrape failed: ${error}`);
      throw error;
    }
  }

  private async upsertProduct(parsed: any, categoryId: string): Promise<void> {
    await this.prisma.product.upsert({
      where: { asin: parsed.asin },
      update: {
        title: parsed.title,
        price: parsed.price,
        imageUrl: parsed.imageUrl,
        amazonUrl: parsed.amazonUrl,
        updatedAt: new Date(),
      },
      create: {
        asin: parsed.asin,
        title: parsed.title,
        price: parsed.price,
        currency: parsed.currency || 'USD',
        imageUrl: parsed.imageUrl,
        amazonUrl: parsed.amazonUrl,
        categoryId,
      },
    });
  }

  async scrapeReviewsForCategory(categorySlug: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { slug: categorySlug } });
    if (!category) return;

    const products = await this.prisma.product.findMany({
      where: { categoryId: category.id },
      select: { id: true, asin: true, lastScrapedAt: true },
    });

    this.logger.log(`Scraping reviews for ${products.length} products in ${categorySlug}`);

    for (const product of products) {
      await this.scrapeProductReviews(product.id, product.asin, product.lastScrapedAt);
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    }
  }

  async scrapeProductReviews(productId: string, asin: string, lastScrapedAt: Date | null): Promise<void> {
    const job = await this.prisma.scrapeJob.create({
      data: { type: ScrapeType.REVIEWS, status: JobStatus.RUNNING, productId, startedAt: new Date() },
    });

    try {
      const reviews = await this.reviewsParser.parseReviews(asin, {
        newerThan: lastScrapedAt ?? undefined,
      });

      let saved = 0;
      let skipped = 0;

      for (const review of reviews) {
        const wasNew = await this.upsertReview(review, productId);
        wasNew ? saved++ : skipped++;
      }

      await this.recalculateProductMetrics(productId);

      await this.prisma.product.update({
        where: { id: productId },
        data: { lastScrapedAt: new Date() },
      });

      await this.prisma.scrapeJob.update({
        where: { id: job.id },
        data: {
          status: reviews.length === 0 ? JobStatus.SKIPPED : JobStatus.DONE,
          itemsFound: reviews.length,
          itemsSaved: saved,
          finishedAt: new Date(),
        },
      });

      this.logger.log(`Reviews for ${asin}: ${saved} new, ${skipped} existing`);

    } catch (error) {
      await this.prisma.scrapeJob.update({
        where: { id: job.id },
        data: { status: JobStatus.FAILED, errorMessage: String(error), finishedAt: new Date() },
      });
      this.logger.error(`Failed to scrape reviews for ${asin}: ${error}`);
    }
  }

  private async upsertReview(review: any, productId: string): Promise<boolean> {
    const existing = await this.prisma.review.findUnique({
      where: { amazonReviewId: review.amazonReviewId },
      select: { id: true },
    });

    if (existing) {
      await this.prisma.review.update({
        where: { amazonReviewId: review.amazonReviewId },
        data: { helpfulVotes: review.helpfulVotes },
      });
      return false;
    }

    await this.prisma.review.create({
      data: {
        amazonReviewId: review.amazonReviewId,
        productId,
        rating: review.rating,
        title: review.title,
        content: review.content,
        reviewDate: review.reviewDate,
        isVerified: review.isVerified,
        reviewerName: review.reviewerName,
        reviewerProfile: review.reviewerProfile,
        helpfulVotes: review.helpfulVotes,
      },
    });
    return true;
  }

  private async recalculateProductMetrics(productId: string): Promise<void> {
    const agg = await this.prisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { id: true },
    });

    await this.prisma.product.update({
      where: { id: productId },
      data: {
        avgRating: agg._avg.rating ?? 0,
        totalReviews: agg._count.id,
      },
    });
  }
}

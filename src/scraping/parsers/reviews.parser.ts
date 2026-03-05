import { Injectable, Logger } from '@nestjs/common';
import { CheerioAPI } from 'cheerio';
import { HttpService } from '../http.service';

export interface ParsedReview {
  amazonReviewId: string;
  rating: number;
  title: string | null;
  content: string | null;
  reviewDate: Date | null;
  isVerified: boolean;
  reviewerName: string | null;
  reviewerProfile: string | null;
  helpfulVotes: number;
}

@Injectable()
export class ReviewsParser {
  private readonly logger = new Logger(ReviewsParser.name);

  constructor(private readonly httpService: HttpService) {}

  // Amazon требует Sign-In для /product-reviews/ без логина.
  // Вместо этого парсим отзывы со страницы товара /dp/{asin} —
  // она отдаёт ~8 top-reviews без авторизации.
  async parseReviews(
    asin: string,
    options: { newerThan?: Date } = {},
  ): Promise<ParsedReview[]> {
    const { newerThan } = options;
    const url = `https://www.amazon.com/dp/${asin}`;
    this.logger.debug(`Parsing reviews from product page for ASIN ${asin}`);

    const $ = await this.httpService.fetchPage(url);

    if (!$) {
      this.logger.warn(`Product page blocked for ${asin}`);
      return [];
    }

    const reviews = this.extractReviews($);

    if (reviews.length === 0) {
      this.logger.debug(`No reviews found on product page for ${asin}`);
      return [];
    }

    // Фильтруем по дате если задана (инкрементальное обновление)
    const result = newerThan
      ? reviews.filter(r => r.reviewDate && r.reviewDate > newerThan)
      : reviews;

    this.logger.log(`Parsed ${result.length} reviews for ASIN ${asin} (${reviews.length} total on page)`);
    return result;
  }

  private extractReviews($: CheerioAPI): ParsedReview[] {
    const reviews: ParsedReview[] = [];

    $('[data-hook="review"]').each((_, el) => {
      const reviewEl = $(el);
      const amazonReviewId = reviewEl.attr('id');
      if (!amazonReviewId || !amazonReviewId.startsWith('R')) return;

      // Рейтинг
      let rating = 0;
      const starAlt = reviewEl.find('.a-icon-alt').first().text();
      if (starAlt) {
        const match = starAlt.match(/(\d+(\.\d+)?)/);
        rating = match ? Math.round(parseFloat(match[1])) : 0;
      }
      if (!rating) return;

      const title = reviewEl
        .find('[data-hook="review-title"] span:not(.a-icon-alt), .review-title span:not(.a-icon-alt)')
        .first()
        .text()
        .trim() || null;

      const content = reviewEl
        .find('[data-hook="review-body"] span, .review-text span')
        .first()
        .text()
        .trim() || null;

      let reviewDate: Date | null = null;
      const dateText = reviewEl
        .find('[data-hook="review-date"], .review-date')
        .first()
        .text();
      if (dateText) {
        const dateMatch = dateText.match(/on (.+)$/);
        if (dateMatch) {
          const parsed = new Date(dateMatch[1]);
          if (!isNaN(parsed.getTime())) reviewDate = parsed;
        }
      }

      const isVerified = reviewEl.find('[data-hook="avp-badge"], .avp-badge').length > 0;

      const reviewerName = reviewEl
        .find('.a-profile-name')
        .first()
        .text()
        .trim() || null;

      const profileHref = reviewEl
        .find('.a-profile')
        .first()
        .attr('href');
      const reviewerProfile = profileHref
        ? `https://www.amazon.com${profileHref}`
        : null;

      let helpfulVotes = 0;
      const helpfulText = reviewEl.find('[data-hook="helpful-vote-statement"]').text();
      if (helpfulText) {
        const match = helpfulText.match(/(\d+)/);
        helpfulVotes = match ? parseInt(match[1], 10) : 0;
      }

      reviews.push({
        amazonReviewId,
        rating,
        title,
        content,
        reviewDate,
        isVerified,
        reviewerName,
        reviewerProfile,
        helpfulVotes,
      });
    });

    return reviews;
  }
}

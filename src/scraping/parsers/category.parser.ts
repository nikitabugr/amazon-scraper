import { Injectable, Logger } from '@nestjs/common';
import { CheerioAPI } from 'cheerio';
import { HttpService } from '../http.service';

export interface ParsedProduct {
  asin: string;
  title: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  amazonUrl: string;
  rating: number | null;
  reviewCount: number | null;
}

@Injectable()
export class CategoryParser {
  private readonly logger = new Logger(CategoryParser.name);

  constructor(private readonly httpService: HttpService) {}

  async parseCategory(categoryUrl: string, maxPages = 3): Promise<ParsedProduct[]> {
    const products: ParsedProduct[] = [];
    let currentUrl: string | null = categoryUrl;
    let pageNum = 1;

    while (currentUrl && pageNum <= maxPages) {
      this.logger.log(`Parsing category page ${pageNum}: ${currentUrl}`);

      const $ = await this.httpService.fetchPage(currentUrl);

      if (!$) {
        this.logger.warn(`Page ${pageNum} blocked or failed, stopping`);
        break;
      }

      const pageProducts = this.extractProducts($);
      products.push(...pageProducts);
      this.logger.log(`Found ${pageProducts.length} products on page ${pageNum}`);

      currentUrl = this.getNextPageUrl($);
      pageNum++;

      if (currentUrl) {
        await this.httpService.randomDelay(2000, 5000);
      }
    }

    return products;
  }

  private extractProducts($: CheerioAPI): ParsedProduct[] {
    const products: ParsedProduct[] = [];

    $('[data-component-type="s-search-result"], .s-result-item[data-asin]').each((_, el) => {
      const card = $(el);
      const asin = card.attr('data-asin');
      if (!asin || asin.length !== 10) return;

      const title = card.find('h2 a span, h2 span.a-text-normal, h2 span').first().text().trim();
      if (!title) return;

      const href = card.find('h2 a[href], a.a-link-normal[href*="/dp/"]').first().attr('href');
      const amazonUrl = href ? `https://www.amazon.com${href}` : `https://www.amazon.com/dp/${asin}`;

      let price: number | null = null;
      const priceText = card.find('.a-price .a-offscreen, .a-price-whole').first().text();
      if (priceText) {
        const raw = priceText.replace(/[^0-9.]/g, '');
        price = raw ? parseFloat(raw) : null;
      }

      let rating: number | null = null;
      const ratingLabel = card.find('[aria-label*="out of 5 stars"]').attr('aria-label');
      if (ratingLabel) {
        const match = ratingLabel.match(/(\d+(\.\d+)?)/);
        rating = match ? parseFloat(match[1]) : null;
      }

      let reviewCount: number | null = null;
      const countText = card.find('[aria-label*="ratings"], .a-size-base.s-underline-text').first().text();
      if (countText) {
        const raw = countText.replace(/[^0-9]/g, '');
        reviewCount = raw ? parseInt(raw, 10) : null;
      }

      const imageUrl = card.find('.s-image').attr('src') || null;

      products.push({ asin, title, price, currency: 'USD', imageUrl, amazonUrl, rating, reviewCount });
    });

    return products;
  }

  private getNextPageUrl($: CheerioAPI): string | null {
    const nextLink = $('.s-pagination-next:not(.s-pagination-disabled)');
    if (!nextLink.length) return null;
    const href = nextLink.attr('href');
    return href ? `https://www.amazon.com${href}` : null;
  }
}

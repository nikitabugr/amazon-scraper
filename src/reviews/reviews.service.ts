import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByAsin(asin: string, limit = 20, page = 1) {
    const product = await this.prisma.product.findUnique({
      where: { asin },
      select: { id: true },
    });
    if (!product) throw new NotFoundException(`Product ${asin} not found`);

    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { productId: product.id },
        orderBy: { reviewDate: 'desc' },
        take: limit,
        skip: (page - 1) * limit,
      }),
      this.prisma.review.count({ where: { productId: product.id } }),
    ]);

    return { reviews, total, page, limit };
  }
}

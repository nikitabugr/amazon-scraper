import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(categorySlug?: string) {
    return this.prisma.product.findMany({
      where: categorySlug
        ? { category: { slug: categorySlug } }
        : undefined,
      include: { category: { select: { name: true, slug: true } } },
      orderBy: { totalReviews: 'desc' },
    });
  }

  async findByAsin(asin: string) {
    const product = await this.prisma.product.findUnique({
      where: { asin },
      include: {
        category: true,
      },
    });
    if (!product) throw new NotFoundException(`Product ${asin} not found`);
    return product;
  }
}

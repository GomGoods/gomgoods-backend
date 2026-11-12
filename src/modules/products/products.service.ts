import { HttpStatus, Injectable } from '@nestjs/common';

import {
  type PaginatedResult,
  paginationParams,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import {
  CategoryStatus,
  ListingStatus,
  ProductStatus,
  StoreStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { StoresService } from '../stores/stores.service.js';
import type { SafeUser } from '../users/user.select.js';
import type { CreateProductDto } from './dto/create-product.dto.js';
import type { ProductQueryDto } from './dto/product-query.dto.js';
import type { UpdateProductDto } from './dto/update-product.dto.js';
import {
  productDetailSelect,
  productListSelect,
  type ProductListItem,
} from './product.select.js';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
  ) {}

  async findAll(
    query: ProductQueryDto,
  ): Promise<PaginatedResult<ProductListItem>> {
    const { page, limit, skip, take } = paginationParams(query);
    const where = {
      status: ProductStatus.ACTIVE,
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.search
        ? {
            OR: [
              {
                name: { contains: query.search, mode: 'insensitive' as const },
              },
              {
                description: {
                  contains: query.search,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
      store: { status: StoreStatus.ACTIVE },
      category: { status: CategoryStatus.ACTIVE },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: productListSelect,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        id,
        status: ProductStatus.ACTIVE,
        store: { status: StoreStatus.ACTIVE },
        category: { status: CategoryStatus.ACTIVE },
      },
      select: productDetailSelect,
    });
    if (!product) throw this.notFound();
    return product;
  }

  async create(user: SafeUser, input: CreateProductDto) {
    const store = await this.stores.requireActiveOwnedStore(user.id);
    await this.requireActiveCategory(input.categoryId);
    return this.prisma.product.create({
      data: {
        storeId: store.id,
        categoryId: input.categoryId,
        name: input.name,
        description: input.description,
        status: ProductStatus.ACTIVE,
      },
      select: productDetailSelect,
    });
  }

  async update(id: string, user: SafeUser, input: UpdateProductDto) {
    const product = await this.findOwnedProduct(id, user.id);
    this.assertProductEditable(product.status);
    if (input.categoryId) await this.requireActiveCategory(input.categoryId);
    return this.prisma.$transaction(async tx => {
    await this.lockAuctionProduct(tx,id);
    return tx.product.update({
      where: { id: product.id },
      data: {
        categoryId: input.categoryId,
        name: input.name,
        description: input.description,
      },
      select: productDetailSelect,
    });
    });
  }

  async archive(id: string, user: SafeUser) {
    const product = await this.findOwnedProduct(id, user.id);
    return this.prisma.$transaction(async (transaction) => {
      await this.lockAuctionProduct(transaction,id);
      await transaction.listing.updateMany({
        where: {
          productId: product.id,
          status: {
            in: [
              ListingStatus.DRAFT,
              ListingStatus.ACTIVE,
              ListingStatus.INACTIVE,
            ],
          },
        },
        data: { status: ListingStatus.REMOVED },
      });
      return transaction.product.update({
        where: { id: product.id },
        data: { status: ProductStatus.ARCHIVED },
        select: productDetailSelect,
      });
    });
  }

  private async lockAuctionProduct(tx:Prisma.TransactionClient,id:string){
    // Same listing -> product order as auction creation/bidding. Lock every
    // listing before checking so a concurrent conversion cannot slip past archive.
    await tx.$queryRaw`SELECT listing_id FROM "LISTING" WHERE product_id=${id}::uuid ORDER BY listing_id FOR UPDATE`;
    await tx.$queryRaw`SELECT product_id FROM "PRODUCT" WHERE product_id=${id}::uuid FOR UPDATE`;
    if(await tx.auction.findFirst({where:{managed:true,status:{in:['SCHEDULED','LIVE','AWAITING_PAYMENT']},listing:{productId:id}},select:{id:true}}))throw new ApiException('RESOURCE_CONFLICT','Product is committed to an auction; use its audited lifecycle',409);
  }

  private async requireActiveCategory(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findFirst({
      where: { id: categoryId, status: CategoryStatus.ACTIVE },
      select: { id: true },
    });
    if (!category) {
      throw new ApiException(
        'RESOURCE_NOT_FOUND',
        'Category not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private async findOwnedProduct(id: string, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        store: { select: { userId: true, status: true } },
      },
    });
    if (!product) throw this.notFound();
    if (product.store.userId !== userId) {
      throw new ApiException(
        'FORBIDDEN',
        'You do not have permission to modify this product',
        HttpStatus.FORBIDDEN,
      );
    }
    if (product.store.status !== StoreStatus.ACTIVE) {
      throw new ApiException(
        'STORE_NOT_ACTIVE',
        'Store must be active before modifying products',
        HttpStatus.FORBIDDEN,
      );
    }
    return product;
  }

  private assertProductEditable(status: ProductStatus): void {
    if (status !== ProductStatus.ACTIVE) {
      throw new ApiException(
        'PRODUCT_NOT_ACTIVE',
        'Archived products cannot be modified in Phase 3',
        HttpStatus.CONFLICT,
      );
    }
  }

  private notFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Product not found',
      HttpStatus.NOT_FOUND,
    );
  }
}

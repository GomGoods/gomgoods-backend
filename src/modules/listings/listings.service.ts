import { HttpStatus, Injectable } from '@nestjs/common';

import {
  type PaginatedResult,
  paginationParams,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import {
  ListingStatus,
  ProductStatus,
  StoreStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SafeUser } from '../users/user.select.js';
import type { CreateListingDto } from './dto/create-listing.dto.js';
import type { ListingQueryDto } from './dto/listing-query.dto.js';
import type { UpdateListingStatusDto } from './dto/update-listing-status.dto.js';
import type { UpdateListingDto } from './dto/update-listing.dto.js';
import { listingSelect, type ListingResponse } from './listing.select.js';
import { listingOrderBy, publicListingWhere } from './public-listing-query.js';

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListingQueryDto,
  ): Promise<PaginatedResult<ListingResponse>> {
    this.validatePriceRange(query);
    const { page, limit, skip, take } = paginationParams(query);
    const where = this.publicWhere(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        orderBy: listingOrderBy(query.sort),
        skip,
        take,
        select: listingSelect,
      }),
      this.prisma.listing.count({ where }),
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

  async findOne(id: string): Promise<ListingResponse> {
    const listing = await this.prisma.listing.findFirst({
      where: this.publicWhere({ id } as ListingQueryDto & { id: string }),
      select: listingSelect,
    });
    if (!listing) throw this.notFound();
    return listing;
  }

  createPersonal(user: SafeUser, input: CreateListingDto) {
    return this.prisma.listing.create({
      data: {
        sellerUserId: user.id,
        price: input.price,
        quantity: input.quantity,
        condition: input.condition,
        description: input.description,
        status: ListingStatus.DRAFT,
      },
      select: listingSelect,
    });
  }

  async createForProduct(
    productId: string,
    user: SafeUser,
    input: CreateListingDto,
  ) {
    const product = await this.findOwnedActiveProduct(productId, user.id);
    return this.prisma.listing.create({
      data: {
        productId: product.id,
        price: input.price,
        quantity: input.quantity,
        condition: input.condition,
        description: input.description,
        status: ListingStatus.DRAFT,
      },
      select: listingSelect,
    });
  }

  async update(id: string, user: SafeUser, input: UpdateListingDto) {
    const listing = await this.requireOwnedListing(id, user.id);
    this.assertListingEditable(listing.status);
    return this.prisma.listing.update({
      where: { id },
      data: {
        price: input.price,
        quantity: input.quantity,
        condition: input.condition,
        description: input.description,
      },
      select: listingSelect,
    });
  }

  async updateStatus(
    id: string,
    user: SafeUser,
    input: UpdateListingStatusDto,
  ) {
    const listing = await this.requireOwnedListing(id, user.id);
    this.assertListingEditable(listing.status);
    if (!this.isAllowedStatusTransition(listing.status, input.status)) {
      throw new ApiException(
        'INVALID_LISTING_STATUS_TRANSITION',
        'This listing status transition is not supported in Phase 3',
        HttpStatus.CONFLICT,
      );
    }
    return this.prisma.listing.update({
      where: { id },
      data: { status: input.status },
      select: listingSelect,
    });
  }

  remove(id: string, user: SafeUser) {
    return this.updateStatus(id, user, { status: ListingStatus.REMOVED });
  }

  private publicWhere(query: ListingQueryDto & { id?: string }) {
    return publicListingWhere(query);
  }

  private async requireOwnedListing(id: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        sellerUserId: true,
        product: {
          select: {
            store: { select: { userId: true, status: true } },
            status: true,
          },
        },
      },
    });
    if (!listing) throw this.notFound();
    if (listing.sellerUserId === userId) return listing;
    if (listing.product?.store.userId !== userId) {
      throw new ApiException(
        'FORBIDDEN',
        'You do not have permission to modify this listing',
        HttpStatus.FORBIDDEN,
      );
    }
    if (listing.product.store.status !== StoreStatus.ACTIVE) {
      throw new ApiException(
        'STORE_NOT_ACTIVE',
        'Store must be active before modifying store-backed listings',
        HttpStatus.FORBIDDEN,
      );
    }
    if (listing.product.status !== ProductStatus.ACTIVE) {
      throw new ApiException(
        'PRODUCT_NOT_ACTIVE',
        'Product must be active before modifying store-backed listings',
        HttpStatus.FORBIDDEN,
      );
    }
    return listing;
  }

  private async findOwnedActiveProduct(productId: string, userId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        status: true,
        store: { select: { userId: true, status: true } },
      },
    });
    if (!product) {
      throw new ApiException(
        'RESOURCE_NOT_FOUND',
        'Product not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (product.store.userId !== userId) {
      throw new ApiException(
        'FORBIDDEN',
        'You do not have permission to create a listing for this product',
        HttpStatus.FORBIDDEN,
      );
    }
    if (product.store.status !== StoreStatus.ACTIVE) {
      throw new ApiException(
        'STORE_NOT_ACTIVE',
        'Store must be active before creating store-backed listings',
        HttpStatus.FORBIDDEN,
      );
    }
    if (product.status !== ProductStatus.ACTIVE) {
      throw new ApiException(
        'PRODUCT_NOT_ACTIVE',
        'Product must be active before creating store-backed listings',
        HttpStatus.FORBIDDEN,
      );
    }
    return product;
  }

  private isAllowedStatusTransition(
    current: ListingStatus,
    target: ListingStatus,
  ): boolean {
    if (current === target) return true;
    if (target === ListingStatus.REMOVED) {
      return (
        current === ListingStatus.DRAFT ||
        current === ListingStatus.ACTIVE ||
        current === ListingStatus.INACTIVE
      );
    }
    if (current === ListingStatus.DRAFT && target === ListingStatus.ACTIVE) {
      return true;
    }
    if (current === ListingStatus.ACTIVE && target === ListingStatus.INACTIVE) {
      return true;
    }
    return (
      current === ListingStatus.INACTIVE && target === ListingStatus.ACTIVE
    );
  }

  private validatePriceRange(query: ListingQueryDto): void {
    if (
      query.minPrice &&
      query.maxPrice &&
      Number(query.minPrice) > Number(query.maxPrice)
    ) {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Request validation failed',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [
          {
            field: 'minPrice',
            errors: ['minPrice must be less than or equal to maxPrice'],
          },
        ],
      );
    }
  }

  private assertListingEditable(status: ListingStatus): void {
    if (
      status !== ListingStatus.DRAFT &&
      status !== ListingStatus.ACTIVE &&
      status !== ListingStatus.INACTIVE
    ) {
      throw new ApiException(
        'LISTING_NOT_EDITABLE',
        'This listing cannot be modified in Phase 3',
        HttpStatus.CONFLICT,
      );
    }
  }

  private notFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Listing not found',
      HttpStatus.NOT_FOUND,
    );
  }
}

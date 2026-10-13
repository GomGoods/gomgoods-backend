import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { listingSelect, type ListingResponse } from '../listings/listing.select.js';
import { publicListingWhere } from '../listings/public-listing-query.js';
import type { DiscoveryListingQueryDto } from './dto/discovery-listing-query.dto.js';

interface DiscoveryCursor {
  createdAt: string;
  id: string;
  filters: NormalizedDiscoveryFilters;
}

interface NormalizedDiscoveryFilters {
  sellerType: 'personal' | 'store' | null;
  categoryId: string | null;
  minPrice: string | null;
  maxPrice: string | null;
}

export interface DiscoveryListingResult {
  items: ListingResponse[];
  pageInfo: {
    hasNextPage: boolean;
    nextCursor: string | null;
  };
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async findListings(
    query: DiscoveryListingQueryDto,
  ): Promise<DiscoveryListingResult> {
    this.validatePriceRange(query);
    const filters = this.normalizeFilters(query);
    const cursor = query.cursor
      ? this.decodeCursor(query.cursor, filters)
      : undefined;
    const where = this.discoveryWhere(query, cursor);
    const records = await this.prisma.listing.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      select: listingSelect,
    });
    const hasNextPage = records.length > query.limit;
    const items = records.slice(0, query.limit);
    return {
      items,
      pageInfo: {
        hasNextPage,
        nextCursor:
          hasNextPage && items.length > 0
            ? this.encodeCursor(items[items.length - 1], filters)
            : null,
      },
    };
  }

  private discoveryWhere(
    query: DiscoveryListingQueryDto,
    cursor?: DiscoveryCursor,
  ): Prisma.ListingWhereInput {
    const and: Prisma.ListingWhereInput[] = [
      publicListingWhere({
        sellerType: query.sellerType,
        categoryId: query.categoryId,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
      }),
    ];
    if (cursor) {
      const createdAt = new Date(cursor.createdAt);
      and.push({
        OR: [
          { createdAt: { lt: createdAt } },
          { createdAt, id: { lt: cursor.id } },
        ],
      });
    }
    return { AND: and };
  }

  private normalizeFilters(
    query: DiscoveryListingQueryDto,
  ): NormalizedDiscoveryFilters {
    return {
      sellerType: query.sellerType ?? null,
      categoryId: query.categoryId ?? null,
      minPrice: query.minPrice ?? null,
      maxPrice: query.maxPrice ?? null,
    };
  }

  private encodeCursor(
    listing: ListingResponse,
    filters: NormalizedDiscoveryFilters,
  ): string {
    const cursor: DiscoveryCursor = {
      createdAt: listing.createdAt.toISOString(),
      id: listing.id,
      filters,
    };
    return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
  }

  private decodeCursor(
    value: string,
    expectedFilters: NormalizedDiscoveryFilters,
  ): DiscoveryCursor {
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as Partial<DiscoveryCursor>;
      if (
        typeof parsed.createdAt !== 'string' ||
        Number.isNaN(new Date(parsed.createdAt).getTime()) ||
        typeof parsed.id !== 'string' ||
        !uuidPattern.test(parsed.id) ||
        !this.filtersMatch(parsed.filters, expectedFilters)
      ) {
        throw new Error('invalid cursor');
      }
      return parsed as DiscoveryCursor;
    } catch {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Request validation failed',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ field: 'cursor', errors: ['cursor is invalid for this query'] }],
      );
    }
  }

  private filtersMatch(
    actual: unknown,
    expected: NormalizedDiscoveryFilters,
  ): boolean {
    if (!actual || typeof actual !== 'object') return false;
    const filters = actual as Partial<NormalizedDiscoveryFilters>;
    return (
      filters.sellerType === expected.sellerType &&
      filters.categoryId === expected.categoryId &&
      filters.minPrice === expected.minPrice &&
      filters.maxPrice === expected.maxPrice
    );
  }

  private validatePriceRange(query: DiscoveryListingQueryDto): void {
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
}

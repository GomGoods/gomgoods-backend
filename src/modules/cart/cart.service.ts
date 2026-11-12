import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import {
  CategoryStatus,
  ListingStatus,
  ProductStatus,
  StoreStatus,
  UserStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SafeUser } from '../users/user.select.js';
import type { AddCartItemDto } from './dto/add-cart-item.dto.js';
import type { UpdateCartItemDto } from './dto/update-cart-item.dto.js';
import { cartItemSelect, type CartItemResponse } from './cart.select.js';
import { lockCart } from './cart-lock.js';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentCart(user: SafeUser) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await lockCart(tx, user.id);
      const items = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        orderBy: { createdAt: 'asc' },
        select: cartItemSelect,
      });
      return {
        id: cart.id,
        userId: user.id,
        items: items.map((item) => this.withAvailability(item)),
      };
    });
  }

  async addItem(user: SafeUser, input: AddCartItemDto) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await lockCart(tx, user.id);
      await tx.$queryRaw`SELECT listing_id FROM "LISTING" WHERE listing_id=${input.listingId}::uuid FOR SHARE`;
      const listing = await tx.listing.findUnique({
        where: { id: input.listingId },
        select: {
          id: true,
          sellerUserId: true,
          status: true,
          quantity: true,
          sellingMode: true,
          sellerUser: { select: { status: true } },
          product: {
            select: {
              status: true,
              category: { select: { status: true } },
              store: { select: { userId: true, status: true } },
            },
          },
        },
      });
      if (!listing || listing.sellingMode !== 'FIXED_PRICE' || !this.isListingAvailable(listing)) {
        throw new ApiException(
          'RESOURCE_NOT_FOUND',
          'Listing is not available',
          HttpStatus.NOT_FOUND,
        );
      }
      if (
        listing.sellerUserId === user.id ||
        listing.product?.store.userId === user.id
      ) {
        throw new ApiException(
          'RESOURCE_CONFLICT',
          'You cannot add your own listing to cart',
          HttpStatus.CONFLICT,
        );
      }

      const current = await tx.cartItem.findUnique({
        where: {
          cartId_listingId: { cartId: cart.id, listingId: input.listingId },
        },
        select: { quantity: true },
      });
      if ((current?.quantity ?? 0) + input.quantity > 2_147_483_647) {
        throw new ApiException(
          'VALIDATION_FAILED',
          'Cart quantity exceeds the supported inventory range',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const item = await tx.cartItem.upsert({
        where: {
          cartId_listingId: { cartId: cart.id, listingId: input.listingId },
        },
        update: { quantity: { increment: input.quantity } },
        create: {
          cartId: cart.id,
          listingId: input.listingId,
          quantity: input.quantity,
        },
        select: cartItemSelect,
      });
      return this.withAvailability(item);
    });
  }

  async updateItem(user: SafeUser, itemId: string, input: UpdateCartItemDto) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await lockCart(tx, user.id);
      const item = await tx.cartItem.findFirst({
        where: { id: itemId, cartId: cart.id },
        select: { id: true },
      });
      if (!item) throw this.cartItemNotFound();
      const updated = await tx.cartItem.update({
        where: { id: itemId },
        data: { quantity: input.quantity },
        select: cartItemSelect,
      });
      return this.withAvailability(updated);
    });
  }

  async removeItem(user: SafeUser, itemId: string) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await lockCart(tx, user.id);
      await tx.cartItem.deleteMany({
        where: { id: itemId, cartId: cart.id },
      });
      return { removed: true };
    });
  }

  async clear(user: SafeUser) {
    return this.prisma.$transaction(async (tx) => {
      const cart = await lockCart(tx, user.id);
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return { cleared: true };
    });
  }

  private withAvailability(
    item: Omit<CartItemResponse, 'available' | 'unavailableReason'>,
  ): CartItemResponse {
    const reason = this.unavailableReason(item.listing);
    return {
      ...item,
      available: reason === null,
      unavailableReason: reason,
    };
  }

  private unavailableReason(
    listing: Omit<
      CartItemResponse,
      'available' | 'unavailableReason'
    >['listing'],
  ): string | null {
    if (listing.status !== ListingStatus.ACTIVE) return 'LISTING_NOT_ACTIVE';
    if (listing.quantity <= 0) return 'OUT_OF_STOCK';
    if (listing.product) {
      if (listing.product.status !== ProductStatus.ACTIVE)
        return 'PRODUCT_NOT_ACTIVE';
      if (listing.product.store.status !== StoreStatus.ACTIVE)
        return 'STORE_NOT_ACTIVE';
      if (listing.product.category.status !== CategoryStatus.ACTIVE)
        return 'CATEGORY_NOT_ACTIVE';
      return null;
    }
    if (listing.sellerUser?.status !== UserStatus.ACTIVE)
      return 'SELLER_NOT_ACTIVE';
    return null;
  }

  private isListingAvailable(listing: {
    status: ListingStatus;
    quantity: number;
    sellerUser: { status: UserStatus } | null;
    product: {
      status: ProductStatus;
      category: { status: CategoryStatus };
      store: { status: StoreStatus };
    } | null;
  }) {
    if (listing.status !== ListingStatus.ACTIVE || listing.quantity <= 0) {
      return false;
    }
    if (listing.product) {
      return (
        listing.product.status === ProductStatus.ACTIVE &&
        listing.product.category.status === CategoryStatus.ACTIVE &&
        listing.product.store.status === StoreStatus.ACTIVE
      );
    }
    return listing.sellerUser?.status === UserStatus.ACTIVE;
  }

  private cartItemNotFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Cart item not found',
      HttpStatus.NOT_FOUND,
    );
  }
}

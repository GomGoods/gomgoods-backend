import { createHash } from 'node:crypto';

import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  CategoryStatus,
  ListingStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  ProductStatus,
  StoreStatus,
  UserStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { lockCart } from '../cart/cart-lock.js';
import { orderSelect } from '../orders/order.select.js';
import type { SafeUser } from '../users/user.select.js';
import type { CheckoutDto } from './dto/checkout.dto.js';

import { PREPAID_EXPIRY_MINUTES } from '../orders/order-policy.js';

type CheckoutListing = Awaited<
  ReturnType<CheckoutService['loadCheckoutItems']>
>[number]['listing'];

@Injectable()
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async checkout(user: SafeUser, input: CheckoutDto) {
    this.assertSupportedPaymentMethod(input.paymentMethod);
    const requestHash = this.hashRequest(input);
    return this.prisma.$transaction(async (tx) => {
      await lockCart(tx, user.id);
      // Recheck after waiting for a concurrent checkout, before reading cart.
      const existing = await tx.checkoutGroup.findUnique({
        where: {
          userId_idempotencyKey: {
            userId: user.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: { id: true, requestHash: true },
      });
      if (existing) return this.resolveExisting(tx, existing, requestHash);
      const address = await tx.address.findFirst({
        where: { id: input.addressId, userId: user.id },
        select: {
          id: true,
          recipient: true,
          phone: true,
          addressLine: true,
          city: true,
          district: true,
          ward: true,
        },
      });
      if (!address) {
        throw new ApiException(
          'RESOURCE_NOT_FOUND',
          'Shipping address not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const cartItems = await this.loadCheckoutItems(tx, user.id, input);
      if (
        input.cartItemIds &&
        new Set(cartItems.map((item) => item.id)).size !==
          new Set(input.cartItemIds).size
      ) {
        throw new ApiException(
          'RESOURCE_NOT_FOUND',
          'One or more cart items were not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (cartItems.length === 0) {
        throw new ApiException(
          'VALIDATION_FAILED',
          'Checkout requires at least one cart item',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      for (const item of cartItems) {
        this.assertCheckoutEligible(item.listing, user.id);
      }

      const checkoutTotal = this.centsToMoney(
        cartItems.reduce(
          (sum, item) =>
            sum + this.moneyToCents(item.listing.price) * BigInt(item.quantity),
          0n,
        ),
      );

      const group = await tx.checkoutGroup.create({
        data: {
          userId: user.id,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          total: checkoutTotal,
        },
        select: { id: true },
      });

      for (const item of [...cartItems].sort((a, b) =>
        a.listingId.localeCompare(b.listingId),
      )) {
        const decremented = await tx.listing.updateMany({
          where: {
            id: item.listingId,
            status: ListingStatus.ACTIVE,
            sellingMode: 'FIXED_PRICE',
            quantity: { gte: item.quantity },
          },
          data: { quantity: { decrement: item.quantity } },
        });
        if (decremented.count !== 1) {
          throw new ApiException(
            'INSUFFICIENT_STOCK',
            'Listing stock is no longer sufficient',
            HttpStatus.CONFLICT,
          );
        }
      }

      const grouped = this.groupItemsBySeller(cartItems);
      const expiresAt =
        input.paymentMethod === PaymentMethod.COD
          ? null
          : new Date(Date.now() + PREPAID_EXPIRY_MINUTES * 60 * 1000);

      for (const sellerGroup of grouped) {
        const total = this.centsToMoney(
          sellerGroup.items.reduce(
            (sum, item) =>
              sum +
              this.moneyToCents(item.listing.price) * BigInt(item.quantity),
            0n,
          ),
        );
        const order = await tx.order.create({
          data: {
            checkoutGroupId: group.id,
            userId: user.id,
            addressId: address.id,
            sellerUserId: sellerGroup.sellerUserId,
            storeId: sellerGroup.storeId,
            total,
            paymentMethod: input.paymentMethod,
            status:
              input.paymentMethod === PaymentMethod.COD
                ? OrderStatus.CONFIRMED
                : OrderStatus.PENDING,
            note: input.note,
            expiresAt,
            shippingRecipient: address.recipient,
            shippingPhone: address.phone,
            shippingAddressLine: address.addressLine,
            shippingCity: address.city,
            shippingDistrict: address.district,
            shippingWard: address.ward,
            items: {
              create: sellerGroup.items.map((item) =>
                this.toOrderItemCreateInput(item),
              ),
            },
          },
          select: { id: true },
        });
        await tx.payment.create({
          data: {
            orderId: order.id,
            amount: total,
            method: input.paymentMethod,
            status: PaymentStatus.PENDING,
          },
        });
      }

      const claimed = await tx.cartItem.deleteMany({
        where: { id: { in: cartItems.map((item) => item.id) } },
      });
      if (claimed.count !== cartItems.length) {
        throw new ApiException(
          'RESOURCE_CONFLICT',
          'Cart changed during checkout',
          HttpStatus.CONFLICT,
        );
      }

      return this.getCheckoutGroup(tx, group.id);
    });
  }

  private async loadCheckoutItems(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CheckoutDto,
  ) {
    const cart = await tx.cart.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!cart) return [];
    // Lock in a stable order before reading price/status/stock snapshots.
    // This also serializes checkout with seller edits to the listing.
    await tx.$queryRaw(Prisma.sql`
      SELECT l."listing_id" FROM "LISTING" l
      JOIN "CART_ITEM" ci ON ci."listing_id" = l."listing_id"
      WHERE ci."cart_id" = ${cart.id}::uuid
      ${input.cartItemIds ? Prisma.sql`AND ci."cart_item_id" IN (${Prisma.join(input.cartItemIds.map((id) => Prisma.sql`${id}::uuid`))})` : Prisma.empty}
      ORDER BY l."listing_id" FOR UPDATE OF l
    `);
    return tx.cartItem.findMany({
      where: {
        cartId: cart.id,
        ...(input.cartItemIds ? { id: { in: input.cartItemIds } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        listingId: true,
        quantity: true,
        listing: {
          select: {
            id: true,
            productId: true,
            sellerUserId: true,
            price: true,
            quantity: true,
            condition: true,
            description: true,
            status: true,
            sellingMode: true,
            sellerUser: {
              select: { id: true, username: true, status: true },
            },
            product: {
              select: {
                id: true,
                name: true,
                description: true,
                status: true,
                category: { select: { status: true } },
                store: {
                  select: {
                    id: true,
                    name: true,
                    userId: true,
                    status: true,
                    user: { select: { id: true, username: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  private assertCheckoutEligible(listing: CheckoutListing, buyerId: string) {
    if (listing.status !== ListingStatus.ACTIVE || listing.quantity <= 0 || listing.sellingMode !== 'FIXED_PRICE') {
      throw new ApiException(
        'RESOURCE_NOT_FOUND',
        'Listing is not available for checkout',
        HttpStatus.NOT_FOUND,
      );
    }
    if (listing.product) {
      if (listing.product.store.userId === buyerId) {
        throw new ApiException(
          'RESOURCE_CONFLICT',
          'You cannot checkout your own store listing',
          HttpStatus.CONFLICT,
        );
      }
      if (
        listing.product.status !== ProductStatus.ACTIVE ||
        listing.product.store.status !== StoreStatus.ACTIVE ||
        listing.product.category.status !== CategoryStatus.ACTIVE
      ) {
        throw new ApiException(
          'RESOURCE_NOT_FOUND',
          'Listing is not available for checkout',
          HttpStatus.NOT_FOUND,
        );
      }
      return;
    }
    if (listing.sellerUserId === buyerId) {
      throw new ApiException(
        'RESOURCE_CONFLICT',
        'You cannot checkout your own listing',
        HttpStatus.CONFLICT,
      );
    }
    if (listing.sellerUser?.status !== UserStatus.ACTIVE) {
      throw new ApiException(
        'RESOURCE_NOT_FOUND',
        'Listing is not available for checkout',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  private groupItemsBySeller(
    cartItems: Awaited<ReturnType<CheckoutService['loadCheckoutItems']>>,
  ) {
    const groups = new Map<
      string,
      {
        sellerUserId: string | null;
        storeId: string | null;
        items: typeof cartItems;
      }
    >();
    for (const item of cartItems) {
      const key = item.listing.product
        ? `store:${item.listing.product.store.id}`
        : `user:${item.listing.sellerUserId}`;
      const current = groups.get(key) ?? {
        sellerUserId: item.listing.product ? null : item.listing.sellerUserId,
        storeId: item.listing.product?.store.id ?? null,
        items: [],
      };
      current.items.push(item);
      groups.set(key, current);
    }
    return [...groups.values()];
  }

  private toOrderItemCreateInput(
    item: Awaited<ReturnType<CheckoutService['loadCheckoutItems']>>[number],
  ) {
    return {
      listingId: item.listingId,
      quantity: item.quantity,
      unitPrice: item.listing.price,
      subtotal: this.centsToMoney(
        this.moneyToCents(item.listing.price) * BigInt(item.quantity),
      ),
      listingDescriptionSnapshot: item.listing.description,
      productIdSnapshot: item.listing.product?.id,
      productNameSnapshot: item.listing.product?.name,
      storeNameSnapshot: item.listing.product?.store.name,
      sellerUsernameSnapshot:
        item.listing.sellerUser?.username ??
        item.listing.product?.store.user.username,
    };
  }

  private resolveExisting(
    tx: Prisma.TransactionClient,
    existing: { id: string; requestHash: string },
    requestHash: string,
  ) {
    if (existing.requestHash !== requestHash) {
      throw new ApiException(
        'RESOURCE_CONFLICT',
        'Idempotency key was already used with a different checkout payload',
        HttpStatus.CONFLICT,
      );
    }
    return this.getCheckoutGroup(tx, existing.id);
  }

  private getCheckoutGroup(
    client: Prisma.TransactionClient | PrismaService,
    id: string,
  ) {
    return client.checkoutGroup.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        userId: true,
        idempotencyKey: true,
        total: true,
        createdAt: true,
        orders: {
          orderBy: { createdAt: 'asc' },
          select: orderSelect,
        },
      },
    });
  }

  private hashRequest(input: CheckoutDto): string {
    const normalized = {
      addressId: input.addressId,
      cartItemIds: input.cartItemIds ? [...input.cartItemIds].sort() : null,
      note: input.note ?? null,
      paymentMethod: input.paymentMethod,
    };
    return createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
  }

  private assertSupportedPaymentMethod(method: PaymentMethod) {
    if (
      method !== PaymentMethod.COD &&
      method !== PaymentMethod.BANK_TRANSFER
    ) {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Phase 5 checkout supports COD and BANK_TRANSFER only',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  private moneyToCents(value: { toString(): string }): bigint {
    const [whole, fraction = ''] = value.toString().split('.');
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  }

  private centsToMoney(cents: bigint): string {
    if (cents < 0n || cents > 99_999_999_999_999n) {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Checkout amount exceeds the supported monetary range',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
  }
}

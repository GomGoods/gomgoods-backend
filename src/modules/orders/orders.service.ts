import { HttpStatus, Injectable } from '@nestjs/common';

import {
  type PaginatedResult,
  paginationParams,
  type PaginationQueryDto,
} from '../../common/dto/pagination.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  OrderStatus,
  PaymentStatus,
  ShipmentStatus,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SafeUser } from '../users/user.select.js';
import type { CancelOrderDto } from './dto/cancel-order.dto.js';
import { orderSelect, type OrderResponse } from './order.select.js';
import { lockOrderForMutation } from './order-lock.js';
import { PREPAID_EXPIRY_MINUTES } from './order-policy.js';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  // Internal transaction seam: the auction row and its reserved listing are
  // already locked. Price/identity/shipping come only from the persisted bid.
  async createAuctionWinner(tx: Prisma.TransactionClient, auctionId: string, bidId: string, now: Date) {
    const auction = await tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
    if (auction.orderId) return tx.order.findUniqueOrThrow({ where: { id: auction.orderId }, select: { id: true } });
    const bid = await tx.bid.findFirstOrThrow({ where: { id: bidId, auctionId } });
    const listing = await tx.listing.findUniqueOrThrow({ where: { id: auction.listingId }, include: { sellerUser: true, product: { include: { store: { include: { user: true } } } } } });
    if (listing.sellingMode !== 'AUCTION' || listing.status !== 'RESERVED' || listing.quantity !== 0 || !bid.addressId || !bid.amount.isInteger()) throw this.notCancellable();
    const s = bid.shippingSnapshot;
    if (!s || typeof s !== 'object' || Array.isArray(s)) throw this.notCancellable();
    const text = (key: string) => { const value = s[key]; if (typeof value !== 'string') throw this.notCancellable(); return value; };
    const order = await tx.order.create({ data: {
      userId: bid.userId, addressId: bid.addressId, sellerUserId: listing.product ? null : listing.sellerUserId,
      storeId: listing.product?.storeId, total: bid.amount, paymentMethod: 'BANK_TRANSFER', status: 'PENDING',
      expiresAt: new Date(+now + PREPAID_EXPIRY_MINUTES * 60000),
      shippingRecipient: text('recipient'), shippingPhone: text('phone'), shippingAddressLine: text('addressLine'), shippingCity: text('city'), shippingDistrict: text('district'), shippingWard: text('ward'),
      items: { create: { listingId: listing.id, quantity: 1, unitPrice: bid.amount, subtotal: bid.amount, listingDescriptionSnapshot: listing.description, productIdSnapshot: listing.productId, productNameSnapshot: listing.product?.name, storeNameSnapshot: listing.product?.store.name, sellerUsernameSnapshot: listing.sellerUser?.username ?? listing.product?.store.user.username } },
      payments: { create: { amount: bid.amount, method: 'BANK_TRANSFER', status: 'PENDING' } },
    }, select: { id: true } });
    return order;
  }

  async expireAuctionOrder(tx: Prisma.TransactionClient, id: string, now: Date) {
    await lockOrderForMutation(tx, id);
    const updated = await tx.order.updateMany({ where: { id, status: 'PENDING', cancelledAt: null, expiresAt: { lte: now }, payments: { every: { status: 'PENDING' } } }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: 'Auction winner payment expired' } });
    if (updated.count) {
      await this.releaseOrderInventory(tx, id);
      await tx.payment.updateMany({ where: { orderId: id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    }
    return tx.order.findUniqueOrThrow({ where: { id }, select: { status: true, expiresAt: true, cancelledAt: true, payments: { select: { status: true } } } });
  }

  async findBuyerOrders(
    user: SafeUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<OrderResponse>> {
    const { page, limit, skip, take } = paginationParams(query);
    const where = { userId: user.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: orderSelect,
      }),
      this.prisma.order.count({ where }),
    ]);
    return this.paginated(items, page, limit, total);
  }

  async findBuyerOrder(user: SafeUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      select: orderSelect,
    });
    if (!order) throw this.notFound();
    return order;
  }

  async findSellerOrders(
    user: SafeUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<OrderResponse>> {
    const { page, limit, skip, take } = paginationParams(query);
    const storeId = user.store?.id;
    const where = {
      OR: [{ sellerUserId: user.id }, ...(storeId ? [{ storeId }] : [])],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: orderSelect,
      }),
      this.prisma.order.count({ where }),
    ]);
    return this.paginated(items, page, limit, total);
  }

  async findSellerOrder(user: SafeUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: this.sellerOrderWhere(user, orderId),
      select: orderSelect,
    });
    if (!order) throw this.notFound();
    return order;
  }

  async cancelBuyerOrder(
    user: SafeUser,
    orderId: string,
    input: CancelOrderDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrderForMutation(tx, orderId);
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          userId: user.id,
          status: OrderStatus.PENDING,
          cancelledAt: null,
          payments: { every: { status: PaymentStatus.PENDING } },
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: input.reason ?? 'Buyer cancelled pending order',
        },
      });
      if (updated.count !== 1) throw this.notCancellable();
      await this.releaseOrderInventory(tx, orderId);
      await tx.shipment.updateMany({
        where: { orderId, status: ShipmentStatus.PENDING },
        data: { status: ShipmentStatus.CANCELLED },
      });
      await tx.payment.updateMany({
        where: { orderId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELLED },
      });
      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: orderSelect,
      });
    });
  }

  async cancelSellerOrder(
    user: SafeUser,
    orderId: string,
    input: CancelOrderDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrderForMutation(tx, orderId);
      const order = await tx.order.findFirst({
        where: this.sellerOrderWhere(user, orderId),
        select: {
          id: true,
          status: true,
          shipments: { select: { status: true } },
          payments: { select: { status: true } },
        },
      });
      if (!order) throw this.notFound();
      if (
        order.status !== OrderStatus.CONFIRMED ||
        order.shipments.some(
          (shipment) => shipment.status !== ShipmentStatus.PENDING,
        ) ||
        order.payments.some(
          (payment) =>
            payment.status !== PaymentStatus.PENDING &&
            payment.status !== PaymentStatus.CANCELLED,
        )
      ) {
        throw this.notCancellable();
      }
      const updated = await tx.order.updateMany({
        where: {
          id: orderId,
          status: OrderStatus.CONFIRMED,
          cancelledAt: null,
          shipments: { every: { status: ShipmentStatus.PENDING } },
          payments: {
            every: {
              status: { in: [PaymentStatus.PENDING, PaymentStatus.CANCELLED] },
            },
          },
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: input.reason ?? 'Seller cancelled before fulfillment',
        },
      });
      if (updated.count !== 1) throw this.notCancellable();
      await this.releaseOrderInventory(tx, orderId);
      await tx.shipment.updateMany({
        where: { orderId, status: ShipmentStatus.PENDING },
        data: { status: ShipmentStatus.CANCELLED },
      });
      await tx.payment.updateMany({
        where: { orderId, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELLED },
      });
      return tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: orderSelect,
      });
    });
  }

  async expirePendingOrders(now = new Date()) {
    const orders = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        expiresAt: { lte: now },
        cancelledAt: null,
        payments: { every: { status: PaymentStatus.PENDING } },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    let expired = 0;
    for (const order of orders) {
      // One transaction per order bounds lock duration and avoids holding
      // inventory locks while waiting on another order's payment callback.
      expired += await this.prisma.$transaction(async (tx) => {
        await lockOrderForMutation(tx, order.id);
        const updated = await tx.order.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.PENDING,
            cancelledAt: null,
            expiresAt: { lte: now },
            payments: { every: { status: PaymentStatus.PENDING } },
          },
          data: {
            status: OrderStatus.CANCELLED,
            cancelledAt: now,
            cancelReason: 'Pending prepaid order expired',
          },
        });
        if (updated.count === 1) {
          await this.releaseOrderInventory(tx, order.id);
          await tx.shipment.updateMany({
            where: { orderId: order.id, status: ShipmentStatus.PENDING },
            data: { status: ShipmentStatus.CANCELLED },
          });
          await tx.payment.updateMany({
            where: { orderId: order.id, status: PaymentStatus.PENDING },
            data: { status: PaymentStatus.CANCELLED },
          });
        }
        return updated.count;
      });
    }
    return { expired };
  }

  private async releaseOrderInventory(
    tx: Prisma.TransactionClient,
    orderId: string,
  ) {
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: { listingId: true, quantity: true },
      orderBy: { listingId: 'asc' },
    });
    for (const item of items) {
      await tx.listing.update({
        where: { id: item.listingId },
        data: { quantity: { increment: item.quantity } },
      });
    }
  }

  private sellerOrderWhere(user: SafeUser, orderId: string) {
    return {
      id: orderId,
      OR: [
        { sellerUserId: user.id },
        ...(user.store?.id ? [{ storeId: user.store.id }] : []),
      ],
    };
  }

  private paginated<T>(
    items: T[],
    page: number,
    limit: number,
    total: number,
  ): PaginatedResult<T> {
    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  private notFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Order not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private notCancellable() {
    return new ApiException(
      'ORDER_NOT_CANCELLABLE',
      'Order cannot be cancelled in its current state',
      HttpStatus.CONFLICT,
    );
  }
}

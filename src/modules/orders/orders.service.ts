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

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

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

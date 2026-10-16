import { HttpStatus, Injectable } from '@nestjs/common';

import { ApiException } from '../../common/exceptions/api.exception.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { OrderStatus, ShipmentStatus } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { SafeUser } from '../users/user.select.js';
import { lockOrderForMutation } from '../orders/order-lock.js';
import type { CreateShipmentDto } from './dto/create-shipment.dto.js';

const shippedStatuses: ShipmentStatus[] = [
  ShipmentStatus.SHIPPED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.DELIVERED,
];

@Injectable()
export class ShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createShipment(
    user: SafeUser,
    orderId: string,
    input: CreateShipmentDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrderForMutation(tx, orderId);
      const order = await tx.order.findFirst({
        where: this.sellerOrderWhere(user, orderId),
        select: {
          id: true,
          sellerUserId: true,
          storeId: true,
          status: true,
          items: {
            select: {
              id: true,
              quantity: true,
              shipmentItems: {
                select: { quantity: true },
              },
            },
          },
        },
      });
      if (!order) throw this.orderNotFound();
      if (!this.canFulfill(order.status)) {
        throw new ApiException(
          'PAYMENT_NOT_CONFIRMED',
          'Shipment cannot start before the order is confirmed',
          HttpStatus.CONFLICT,
        );
      }

      const requestedByItem = new Map<string, number>();
      for (const item of input.items) {
        requestedByItem.set(
          item.orderItemId,
          (requestedByItem.get(item.orderItemId) ?? 0) + item.quantity,
        );
      }
      for (const [orderItemId, quantity] of requestedByItem) {
        const orderItem = order.items.find((item) => item.id === orderItemId);
        if (!orderItem) {
          throw new ApiException(
            'VALIDATION_FAILED',
            'Shipment item must belong to the order',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const allocatedQuantity = orderItem.shipmentItems.reduce(
          (sum, item) => sum + item.quantity,
          0,
        );
        if (allocatedQuantity + quantity > orderItem.quantity) {
          throw new ApiException(
            'VALIDATION_FAILED',
            'Shipment quantity exceeds remaining order item quantity',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }

      const shipment = await tx.shipment.create({
        data: {
          orderId: order.id,
          sellerUserId: order.sellerUserId,
          storeId: order.storeId,
          carrier: input.carrier,
          trackingNo: input.trackingNo,
          shippingFee: '0.00',
          status: ShipmentStatus.PENDING,
          items: {
            create: [...requestedByItem.entries()].map(
              ([orderItemId, quantity]) => ({ orderItemId, quantity }),
            ),
          },
        },
        select: shipmentSelect,
      });
      return shipment;
    });
  }

  async markReady(user: SafeUser, shipmentId: string) {
    return this.transition(
      user,
      shipmentId,
      ShipmentStatus.PENDING,
      ShipmentStatus.READY_TO_SHIP,
    );
  }

  async markShipped(user: SafeUser, shipmentId: string) {
    return this.transition(
      user,
      shipmentId,
      ShipmentStatus.READY_TO_SHIP,
      ShipmentStatus.SHIPPED,
    );
  }

  async confirmDelivered(user: SafeUser, shipmentId: string) {
    return this.transition(
      user,
      shipmentId,
      ShipmentStatus.SHIPPED,
      ShipmentStatus.DELIVERED,
      true,
    );
  }

  private async transition(
    user: SafeUser,
    shipmentId: string,
    from: ShipmentStatus,
    to: ShipmentStatus,
    buyer = false,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const where = {
        id: shipmentId,
        order: buyer ? { userId: user.id } : this.sellerOrderWhere(user),
      };
      const initial = await tx.shipment.findFirst({
        where,
        select: { orderId: true },
      });
      if (!initial) throw this.shipmentNotFound();
      await lockOrderForMutation(tx, initial.orderId);
      // Re-read both authorization and state after acquiring the order lock.
      const shipment = await tx.shipment.findFirst({
        where,
        select: { status: true, order: { select: { status: true } } },
      });
      if (!shipment) throw this.shipmentNotFound();
      if (shipment.status !== from || !this.canFulfill(shipment.order.status)) {
        throw this.invalidTransition();
      }
      const updated = await tx.shipment.updateMany({
        where: { ...where, status: from },
        data: {
          status: to,
          ...(to === ShipmentStatus.SHIPPED ? { shippedAt: new Date() } : {}),
          ...(to === ShipmentStatus.DELIVERED
            ? { deliveredAt: new Date() }
            : {}),
        },
      });
      if (updated.count !== 1) throw this.invalidTransition();
      if (to === ShipmentStatus.SHIPPED || to === ShipmentStatus.DELIVERED) {
        await this.updateFulfillmentStatus(tx, initial.orderId);
      }
      return tx.shipment.findUniqueOrThrow({
        where: { id: shipmentId },
        select: shipmentSelect,
      });
    });
  }

  private async updateFulfillmentStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
  ) {
    const items = await tx.orderItem.findMany({
      where: { orderId },
      select: {
        quantity: true,
        shipmentItems: {
          select: { quantity: true, shipment: { select: { status: true } } },
        },
      },
    });
    const quantities = items.map((item) => ({
      ordered: item.quantity,
      shipped: item.shipmentItems.reduce(
        (sum, part) =>
          sum +
          (shippedStatuses.includes(part.shipment.status)
            ? part.quantity
            : 0),
        0,
      ),
      delivered: item.shipmentItems.reduce(
        (sum, part) =>
          sum +
          (part.shipment.status === ShipmentStatus.DELIVERED
            ? part.quantity
            : 0),
        0,
      ),
    }));
    const allDelivered =
      quantities.length > 0 &&
      quantities.every((item) => item.delivered === item.ordered);
    const allShipped =
      quantities.length > 0 &&
      quantities.every((item) => item.shipped === item.ordered);
    const status = allDelivered
      ? OrderStatus.DELIVERED
      : allShipped
        ? OrderStatus.SHIPPED
        : OrderStatus.PARTIALLY_SHIPPED;
    await tx.order.update({ where: { id: orderId }, data: { status } });
  }

  private sellerOrderWhere(user: SafeUser, orderId?: string) {
    return {
      id: orderId,
      OR: [
        { sellerUserId: user.id },
        ...(user.store?.id ? [{ storeId: user.store.id }] : []),
      ],
    };
  }

  private canFulfill(status: OrderStatus) {
    return (
      [
        OrderStatus.CONFIRMED,
        OrderStatus.PARTIALLY_SHIPPED,
        OrderStatus.SHIPPED,
      ] as OrderStatus[]
    ).includes(status);
  }

  private shipmentNotFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Shipment not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private orderNotFound() {
    return new ApiException(
      'RESOURCE_NOT_FOUND',
      'Order not found',
      HttpStatus.NOT_FOUND,
    );
  }

  private invalidTransition() {
    return new ApiException(
      'INVALID_SHIPMENT_STATUS_TRANSITION',
      'Shipment status transition is not allowed',
      HttpStatus.CONFLICT,
    );
  }
}

const shipmentSelect = {
  id: true,
  orderId: true,
  sellerUserId: true,
  storeId: true,
  carrier: true,
  trackingNo: true,
  shippingFee: true,
  status: true,
  shippedAt: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
  items: {
    select: {
      id: true,
      orderItemId: true,
      quantity: true,
    },
  },
};

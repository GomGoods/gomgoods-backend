import { describe, expect, it, vi } from 'vitest';

import {
  OrderStatus,
  PaymentMethod,
  ShipmentStatus,
} from '../../generated/prisma/enums.js';
import { ShipmentsService } from './shipments.service.js';

const seller = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'seller@gomgoods.local',
  username: 'seller',
  accountType: 'USER',
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
  store: null,
} as const;

describe('ShipmentsService', () => {
  it('blocks shipment creation for pending prepaid orders', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      order: {
        findFirst: vi.fn().mockResolvedValue({
          id: '00000000-0000-4000-8000-000000000010',
          sellerUserId: seller.id,
          storeId: null,
          status: OrderStatus.PENDING,
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          items: [],
        }),
      },
      shipment: { create: vi.fn() },
    };
    const prisma = { $transaction: vi.fn((callback) => callback(tx)) };
    const service = new ShipmentsService(prisma as never);

    await expect(
      service.createShipment(seller, '00000000-0000-4000-8000-000000000010', {
        carrier: 'Manual',
        items: [
          {
            orderItemId: '00000000-0000-4000-8000-000000000020',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_CONFIRMED', status: 409 });
    expect(tx.shipment.create).not.toHaveBeenCalled();
  });

  it('scopes delivery confirmation to the buyer and rechecks state under lock', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      shipment: {
        findFirst: vi.fn().mockResolvedValue({
          orderId: '00000000-0000-4000-8000-000000000030',
          status: ShipmentStatus.SHIPPED,
          order: { status: OrderStatus.SHIPPED },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ status: ShipmentStatus.DELIVERED }),
      },
      orderItem: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              quantity: 1,
              shipmentItems: [
                { quantity: 1, shipment: { status: ShipmentStatus.DELIVERED } },
              ],
            },
          ]),
      },
      order: { update: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: vi.fn((callback) => callback(tx)),
    };
    const service = new ShipmentsService(prisma as never);

    await expect(
      service.confirmDelivered(seller, '00000000-0000-4000-8000-000000000010'),
    ).resolves.toMatchObject({ status: ShipmentStatus.DELIVERED });
    expect(tx.shipment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: '00000000-0000-4000-8000-000000000010',
          order: { userId: seller.id },
        },
      }),
    );
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-4000-8000-000000000030' },
      data: { status: OrderStatus.DELIVERED },
    });
  });

  it.each([OrderStatus.CANCELLED, OrderStatus.REFUNDED, OrderStatus.DISPUTED])(
    'rejects a stale ready shipment when order is %s',
    async (status) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        shipment: {
          findFirst: vi.fn().mockResolvedValue({
            orderId: '00000000-0000-4000-8000-000000000030',
            status: ShipmentStatus.READY_TO_SHIP,
            order: { status },
          }),
          updateMany: vi.fn(),
        },
      };
      const service = new ShipmentsService({
        $transaction: vi.fn((callback) => callback(tx)),
      } as never);
      await expect(
        service.markShipped(seller, '00000000-0000-4000-8000-000000000010'),
      ).rejects.toMatchObject({ code: 'INVALID_SHIPMENT_STATUS_TRANSITION' });
      expect(tx.shipment.updateMany).not.toHaveBeenCalled();
    },
  );
});

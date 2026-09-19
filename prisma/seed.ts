import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

// Stable IDs make this seed safe to run repeatedly via upsert.
const id = {
  storeOwner: "00000000-0000-4000-8000-000000000001",
  personalSeller: "00000000-0000-4000-8000-000000000002",
  buyer: "00000000-0000-4000-8000-000000000003",
  address: "00000000-0000-4000-8000-000000000010",
  store: "00000000-0000-4000-8000-000000000020",
  category: "00000000-0000-4000-8000-000000000030",
  subcategory: "00000000-0000-4000-8000-000000000031",
  product: "00000000-0000-4000-8000-000000000040",
  storeListing: "00000000-0000-4000-8000-000000000050",
  personalListing: "00000000-0000-4000-8000-000000000051",
  collection: "00000000-0000-4000-8000-000000000060",
  order: "00000000-0000-4000-8000-000000000070",
  storeOrderItem: "00000000-0000-4000-8000-000000000071",
  personalOrderItem: "00000000-0000-4000-8000-000000000072",
  payment: "00000000-0000-4000-8000-000000000080",
  storeShipment: "00000000-0000-4000-8000-000000000090",
  personalShipment: "00000000-0000-4000-8000-000000000091",
  auction: "00000000-0000-4000-8000-000000000100",
  dispute: "00000000-0000-4000-8000-000000000110",
  campaign: "00000000-0000-4000-8000-000000000120",
  post: "00000000-0000-4000-8000-000000000130",
  conversation: "00000000-0000-4000-8000-000000000140",
};

async function main() {
  await prisma.user.upsert({
    where: { id: id.storeOwner },
    update: { status: "ACTIVE" },
    create: {
      id: id.storeOwner,
      email: "store-owner@gomgoods.local",
      username: "otaku_store",
      passwordHash: "seed-only-not-a-real-password",
    },
  });
  await prisma.user.upsert({
    where: { id: id.personalSeller },
    update: { status: "ACTIVE" },
    create: {
      id: id.personalSeller,
      email: "seller@gomgoods.local",
      username: "minh_collects",
      passwordHash: "seed-only-not-a-real-password",
    },
  });
  await prisma.user.upsert({
    where: { id: id.buyer },
    update: { status: "ACTIVE" },
    create: {
      id: id.buyer,
      email: "buyer@gomgoods.local",
      username: "anime_buyer",
      passwordHash: "seed-only-not-a-real-password",
    },
  });

  await prisma.address.upsert({
    where: { id: id.address },
    update: { isDefault: true },
    create: {
      id: id.address,
      userId: id.buyer,
      recipient: "Anime Buyer",
      phone: "0900000000",
      addressLine: "1 Nguyen Hue",
      ward: "Ben Nghe",
      district: "District 1",
      city: "Ho Chi Minh City",
      isDefault: true,
    },
  });
  await prisma.store.upsert({
    where: { id: id.store },
    update: { status: "ACTIVE" },
    create: {
      id: id.store,
      userId: id.storeOwner,
      name: "Otaku Corner",
      description: "Seed store for official pop-culture goods.",
      status: "ACTIVE",
    },
  });
  await prisma.follow.upsert({
    where: { userId_storeId: { userId: id.buyer, storeId: id.store } },
    update: {},
    create: { userId: id.buyer, storeId: id.store },
  });
  await prisma.category.upsert({
    where: { id: id.category },
    update: { name: "Figures" },
    create: { id: id.category, name: "Figures" },
  });
  await prisma.category.upsert({
    where: { id: id.subcategory },
    update: { name: "Nendoroid", parentId: id.category },
    create: { id: id.subcategory, parentId: id.category, name: "Nendoroid" },
  });
  await prisma.product.upsert({
    where: { id: id.product },
    update: { name: "Nendoroid Tanjiro Kamado" },
    create: {
      id: id.product,
      storeId: id.store,
      categoryId: id.subcategory,
      name: "Nendoroid Tanjiro Kamado",
      description: "Official Good Smile Company figure.",
    },
  });
  await prisma.listing.upsert({
    where: { id: id.storeListing },
    update: { price: "1250000", quantity: 8, status: "ACTIVE" },
    create: {
      id: id.storeListing,
      productId: id.product,
      price: "1250000",
      quantity: 8,
      condition: "NEW",
      status: "ACTIVE",
    },
  });
  await prisma.listing.upsert({
    where: { id: id.personalListing },
    update: { price: "450000", quantity: 1, status: "ACTIVE" },
    create: {
      id: id.personalListing,
      sellerUserId: id.personalSeller,
      price: "450000",
      quantity: 1,
      condition: "GOOD",
      description: "Pre-owned manga set, carefully kept.",
      status: "ACTIVE",
    },
  });
  await prisma.listingImage.upsert({
    where: { listingId_sortOrder: { listingId: id.storeListing, sortOrder: 0 } },
    update: { imageUrl: "https://example.com/seed/nendoroid-tanjiro.jpg" },
    create: {
      listingId: id.storeListing,
      imageUrl: "https://example.com/seed/nendoroid-tanjiro.jpg",
      sortOrder: 0,
    },
  });
  await prisma.collection.upsert({
    where: { id: id.collection },
    update: { name: "My figure wishlist" },
    create: { id: id.collection, userId: id.buyer, name: "My figure wishlist" },
  });
  await prisma.collectionItem.upsert({
    where: { collectionId_listingId: { collectionId: id.collection, listingId: id.storeListing } },
    update: {},
    create: { collectionId: id.collection, listingId: id.storeListing },
  });

  await prisma.order.upsert({
    where: { id: id.order },
    update: { total: "1700000", status: "DELIVERED" },
    create: {
      id: id.order,
      userId: id.buyer,
      addressId: id.address,
      total: "1700000",
      status: "DELIVERED",
      note: "Please call before delivery.",
    },
  });
  await prisma.orderItem.upsert({
    where: { id: id.storeOrderItem },
    update: { quantity: 1, unitPrice: "1250000", subtotal: "1250000" },
    create: {
      id: id.storeOrderItem,
      orderId: id.order,
      listingId: id.storeListing,
      quantity: 1,
      unitPrice: "1250000",
      subtotal: "1250000",
    },
  });
  await prisma.orderItem.upsert({
    where: { id: id.personalOrderItem },
    update: { quantity: 1, unitPrice: "450000", subtotal: "450000" },
    create: {
      id: id.personalOrderItem,
      orderId: id.order,
      listingId: id.personalListing,
      quantity: 1,
      unitPrice: "450000",
      subtotal: "450000",
    },
  });
  await prisma.payment.upsert({
    where: { id: id.payment },
    update: { amount: "1700000", status: "PAID", paidAt: new Date("2026-09-15T09:00:00Z") },
    create: {
      id: id.payment,
      orderId: id.order,
      amount: "1700000",
      method: "E_WALLET",
      status: "PAID",
      paidAt: new Date("2026-09-15T09:00:00Z"),
    },
  });
  await prisma.transaction.upsert({
    where: { transactionCode: "SEED-FAILED-ATTEMPT-001" },
    update: { status: "FAILED" },
    create: { paymentId: id.payment, transactionCode: "SEED-FAILED-ATTEMPT-001", amount: "1700000", status: "FAILED" },
  });
  await prisma.transaction.upsert({
    where: { transactionCode: "SEED-PAID-ATTEMPT-002" },
    update: { status: "SUCCEEDED" },
    create: { paymentId: id.payment, transactionCode: "SEED-PAID-ATTEMPT-002", amount: "1700000", status: "SUCCEEDED" },
  });
  await prisma.shipment.upsert({
    where: { id: id.storeShipment },
    update: { status: "DELIVERED" },
    create: {
      id: id.storeShipment,
      orderId: id.order,
      storeId: id.store,
      carrier: "GHN",
      trackingNo: "SEED-GHN-001",
      shippingFee: "30000",
      status: "DELIVERED",
      shippedAt: new Date("2026-09-15T10:00:00Z"),
      deliveredAt: new Date("2026-09-16T10:00:00Z"),
    },
  });
  await prisma.shipment.upsert({
    where: { id: id.personalShipment },
    update: { status: "DELIVERED" },
    create: {
      id: id.personalShipment,
      orderId: id.order,
      sellerUserId: id.personalSeller,
      carrier: "J&T Express",
      trackingNo: "SEED-JT-001",
      shippingFee: "25000",
      status: "DELIVERED",
      shippedAt: new Date("2026-09-15T11:00:00Z"),
      deliveredAt: new Date("2026-09-16T12:00:00Z"),
    },
  });
  await prisma.shipmentItem.upsert({
    where: { shipmentId_orderItemId: { shipmentId: id.storeShipment, orderItemId: id.storeOrderItem } },
    update: { quantity: 1 },
    create: { shipmentId: id.storeShipment, orderItemId: id.storeOrderItem, quantity: 1 },
  });
  await prisma.shipmentItem.upsert({
    where: { shipmentId_orderItemId: { shipmentId: id.personalShipment, orderItemId: id.personalOrderItem } },
    update: { quantity: 1 },
    create: { shipmentId: id.personalShipment, orderItemId: id.personalOrderItem, quantity: 1 },
  });
  await prisma.review.upsert({
    where: { orderItemId: id.storeOrderItem },
    update: { productRating: 5, sellerRating: 5 },
    create: {
      orderItemId: id.storeOrderItem,
      userId: id.buyer,
      productRating: 5,
      sellerRating: 5,
      comment: "Fast shipping and authentic product.",
    },
  });

  await prisma.auction.upsert({
    where: { listingId: id.personalListing },
    update: { status: "ENDED", winnerId: id.buyer, winningBid: "550000" },
    create: {
      id: id.auction,
      listingId: id.personalListing,
      startingPrice: "400000",
      bidStep: "25000",
      startsAt: new Date("2026-09-10T08:00:00Z"),
      endsAt: new Date("2026-09-11T08:00:00Z"),
      winnerId: id.buyer,
      winningBid: "550000",
      status: "ENDED",
    },
  });
  await prisma.bid.upsert({
    where: { id: "00000000-0000-4000-8000-000000000101" },
    update: { amount: "500000" },
    create: { id: "00000000-0000-4000-8000-000000000101", auctionId: id.auction, userId: id.storeOwner, amount: "500000" },
  });
  await prisma.bid.upsert({
    where: { id: "00000000-0000-4000-8000-000000000102" },
    update: { amount: "550000" },
    create: { id: "00000000-0000-4000-8000-000000000102", auctionId: id.auction, userId: id.buyer, amount: "550000" },
  });
  await prisma.dispute.upsert({
    where: { id: id.dispute },
    update: { status: "OPEN" },
    create: {
      id: id.dispute,
      orderId: id.order,
      orderItemId: id.personalOrderItem,
      userId: id.buyer,
      reason: "Item condition differs from listing",
      status: "OPEN",
    },
  });
  await prisma.disputeEvidence.upsert({
    where: { id: "00000000-0000-4000-8000-000000000111" },
    update: { evidenceUrl: "https://example.com/seed/dispute-photo.jpg" },
    create: {
      id: "00000000-0000-4000-8000-000000000111",
      disputeId: id.dispute,
      evidenceUrl: "https://example.com/seed/dispute-photo.jpg",
    },
  });

  await prisma.campaign.upsert({
    where: { id: id.campaign },
    update: { status: "ACTIVE" },
    create: {
      id: id.campaign,
      name: "GomGoods Figure Week",
      startsAt: new Date("2026-09-01T00:00:00Z"),
      endsAt: new Date("2026-09-30T23:59:59Z"),
      status: "ACTIVE",
    },
  });
  await prisma.campaignParticipant.upsert({
    where: { campaignId_userId: { campaignId: id.campaign, userId: id.buyer } },
    update: { score: 10 },
    create: { campaignId: id.campaign, userId: id.buyer, score: 10 },
  });
  await prisma.post.upsert({
    where: { id: id.post },
    update: { status: "PUBLISHED" },
    create: {
      id: id.post,
      userId: id.buyer,
      title: "My first Nendoroid",
      content: "The order arrived safely. Any display tips?",
      status: "PUBLISHED",
    },
  });
  await prisma.comment.upsert({
    where: { id: "00000000-0000-4000-8000-000000000131" },
    update: { content: "Keep it away from direct sunlight." },
    create: { id: "00000000-0000-4000-8000-000000000131", postId: id.post, userId: id.storeOwner, content: "Keep it away from direct sunlight." },
  });
  await prisma.reaction.upsert({
    where: { postId_userId: { postId: id.post, userId: id.storeOwner } },
    update: { type: "LIKE" },
    create: { postId: id.post, userId: id.storeOwner, type: "LIKE" },
  });
  await prisma.conversation.upsert({
    where: { id: id.conversation },
    update: {},
    create: { id: id.conversation },
  });
  for (const userId of [id.buyer, id.personalSeller]) {
    await prisma.conversationParticipant.upsert({
      where: { conversationId_userId: { conversationId: id.conversation, userId } },
      update: {},
      create: { conversationId: id.conversation, userId },
    });
  }
  await prisma.message.upsert({
    where: { id: "00000000-0000-4000-8000-000000000141" },
    update: { status: "READ" },
    create: {
      id: "00000000-0000-4000-8000-000000000141",
      conversationId: id.conversation,
      senderId: id.buyer,
      content: "Hi, when can you ship my order?",
      status: "READ",
    },
  });
  await prisma.report.upsert({
    where: { id: "00000000-0000-4000-8000-000000000150" },
    update: { status: "OPEN" },
    create: {
      id: "00000000-0000-4000-8000-000000000150",
      userId: id.buyer,
      targetType: "LISTING",
      targetId: id.personalListing,
      reason: "Example report",
    },
  });
  await prisma.supportTicket.upsert({
    where: { id: "00000000-0000-4000-8000-000000000160" },
    update: { status: "OPEN" },
    create: {
      id: "00000000-0000-4000-8000-000000000160",
      userId: id.buyer,
      subject: "How do I update my delivery address?",
      description: "Sample support ticket for local development.",
    },
  });

  console.log("Seed data created or updated.");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

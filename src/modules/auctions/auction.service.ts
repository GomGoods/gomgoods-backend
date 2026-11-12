import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccessTokenService } from '../auth/access-token.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { decodeForumCursor,encodeForumCursor } from '../forum/forum-policy.js';
import { AuctionRateLimit } from './auction-rate-limit.js';
import { effectiveEnd,MAX_VND,type AuctionAddressDto,type AuctionPageDto,type CreateAuctionDto,type PlaceBidDto } from './auction.dto.js';

type Tx=Prisma.TransactionClient;
const listingInclude={sellerUser:{select:{id:true,username:true,status:true}},product:{include:{category:{select:{id:true,status:true}},store:{include:{user:{select:{id:true,username:true,status:true}}}}}}} satisfies Prisma.ListingInclude;
const publicSelect={
 id:true,listingId:true,startingPrice:true,bidStep:true,startsAt:true,endsAt:true,originalEndsAt:true,status:true,version:true,createdAt:true,winnerId:true,winningBid:true,
 listing:{select:{id:true,description:true,condition:true,sellerUser:{select:{id:true,username:true}},product:{select:{name:true,store:{select:{user:{select:{id:true,username:true}}}}}}}}
} satisfies Prisma.AuctionSelect;
const bidSelect={id:true,amount:true,createdAt:true,sequence:true,user:{select:{id:true,username:true}}} satisfies Prisma.BidSelect;
@Injectable()
export class AuctionService {
 constructor(private readonly prisma:PrismaService,private readonly tokens:AccessTokenService,private readonly limits:AuctionRateLimit,private readonly orders:OrdersService){}
 private conflict(message='Auction state does not allow this action'){return new ApiException('RESOURCE_CONFLICT',message,409);}
 private missing(){return new ApiException('RESOURCE_NOT_FOUND','Auction resource not found',404);}
 async clock(tx:Tx|PrismaService=this.prisma){return (await tx.$queryRaw<{now:Date}[]>`SELECT date_trunc('milliseconds',clock_timestamp()) AS now`)[0].now;}
 async identity(token:string,tx?:Tx,role?:'USER'|'ADMIN'){
  let payload;try{payload=await this.tokens.verify(token);}catch{throw new ApiException('INVALID_ACCESS_TOKEN','Invalid auction session',401);}
  const db=tx??this.prisma;
  if(tx)await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${payload.sub}::uuid FOR SHARE`;
  const user=await db.user.findUnique({where:{id:payload.sub},select:{id:true,status:true,accountType:true}});
  if(!user||user.status!=='ACTIVE'||role&&user.accountType!==role)throw new ApiException('FORBIDDEN','Account is not eligible',403);
  if(!('exp'in payload)||typeof payload.exp!=='number')throw new ApiException('INVALID_ACCESS_TOKEN','Invalid auction session',401);
  const valid=tx?await tx.$queryRaw`SELECT session_id FROM "AUTH_SESSION" WHERE session_id=${payload.sid}::uuid AND user_id=${user.id}::uuid AND revoked_at IS NULL AND expires_at>clock_timestamp() AND ${payload.exp}>extract(epoch FROM clock_timestamp()) FOR SHARE`:await db.authSession.findFirst({where:{id:payload.sid,userId:user.id,revokedAt:null,expiresAt:{gt:await this.clock()}}});
  if(Array.isArray(valid)?!valid.length:!valid)throw new ApiException('INVALID_ACCESS_TOKEN','Invalid auction session',401);
  return user;
 }
 private async locked(tx:Tx,id:string){await tx.$queryRaw`SELECT auction_id FROM "AUCTION" WHERE auction_id=${id}::uuid FOR UPDATE`;const auction=await tx.auction.findFirst({where:{id,managed:true}});if(!auction)throw this.missing();return auction;}
 private owner(listing:Prisma.ListingGetPayload<{include:typeof listingInclude}>){return listing.product?.store.userId??listing.sellerUserId!;}
 private async listing(tx:Tx,id:string){
  await tx.$queryRaw`SELECT listing_id FROM "LISTING" WHERE listing_id=${id}::uuid FOR UPDATE`;
  const row=await tx.listing.findUnique({where:{id},include:listingInclude});if(!row)throw this.missing();
  const owner=this.owner(row);await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${owner}::uuid FOR SHARE`;
  if(row.product){await tx.$queryRaw`SELECT product_id FROM "PRODUCT" WHERE product_id=${row.product.id}::uuid FOR SHARE`;await tx.$queryRaw`SELECT store_id FROM "STORE" WHERE store_id=${row.product.storeId}::uuid FOR SHARE`;await tx.$queryRaw`SELECT category_id FROM "CATEGORY" WHERE category_id=${row.product.categoryId}::uuid FOR SHARE`;}
  return tx.listing.findUniqueOrThrow({where:{id},include:listingInclude});
 }
 private eligible(row:Prisma.ListingGetPayload<{include:typeof listingInclude}>){return row.product?row.product.status==='ACTIVE'&&row.product.store.status==='ACTIVE'&&row.product.store.user.status==='ACTIVE'&&row.product.category.status==='ACTIVE':row.sellerUser?.status==='ACTIVE';}
 private async event(tx:Tx,id:string,action:string,note:string,actorId?:string){const row=await tx.auction.update({where:{id},data:{version:{increment:1}},select:{version:true}});await tx.auctionEvent.create({data:{auctionId:id,version:row.version,actorId,action,note,createdAt:await this.clock(tx)}});return row.version;}
 async create(token:string,input:CreateAuctionDto){
  const caller=await this.identity(token);await this.limits.consume(caller.id,'mutation');
  const start=new Date(input.startsAt),end=new Date(input.endsAt),duration=+end-+start;
  if(duration<3600000||duration>604800000)throw new ApiException('VALIDATION_FAILED','Auction duration must be 1 hour to 7 days',422);
  const id=await this.prisma.$transaction(async tx=>{
   const listing=await this.listing(tx,input.listingId),user=await this.identity(token,tx,'USER');
   if(this.owner(listing)!==user.id)throw new ApiException('FORBIDDEN','Only the listing owner can create an auction',403);
   const now=await this.clock(tx);if(start<now)throw this.conflict('Start time must not be in the past');
   if(!this.eligible(listing)||listing.status!=='ACTIVE'||listing.sellingMode!=='FIXED_PRICE'||listing.quantity!==1||await tx.auction.findUnique({where:{listingId:listing.id}}))throw this.conflict('Auction requires an active single-unit fixed-price listing without an auction');
   if(await tx.orderItem.findFirst({where:{listingId:listing.id,order:{status:{notIn:['CANCELLED','REFUNDED']}}},select:{id:true}}))throw this.conflict('Listing has an existing reservation or sale');
   const auction=await tx.auction.create({data:{listingId:listing.id,startingPrice:String(input.startingPrice),bidStep:String(input.bidStep),startsAt:start,endsAt:end,originalEndsAt:end,managed:true,status:'SCHEDULED',version:1,createdAt:now}});
   await tx.listing.update({where:{id:listing.id},data:{sellingMode:'AUCTION',status:'RESERVED',quantity:0}});
   await tx.auctionEvent.create({data:{auctionId:auction.id,actorId:user.id,version:1,action:'CREATE',note:'Single item reserved for auction',createdAt:now}});return auction.id;
  });return this.detail(id);
 }
 async detail(id:string){
  return this.prisma.$transaction(async tx=>{
  const row=await tx.auction.findFirst({where:{id,managed:true},select:publicSelect});if(!row)throw this.missing();
  const highest=await tx.bid.findFirst({where:{auctionId:id,sequence:{not:null}},orderBy:{sequence:'desc'},select:bidSelect});const now=await this.clock(tx);
  return {...row,status:row.status==='SCHEDULED'&&row.startsAt<=now&&row.endsAt>now?'LIVE' as const:row.status,version:row.version.toString(),highestBid:highest?{...highest,sequence:highest.sequence!.toString()}:null,currentPrice:highest?.amount??row.startingPrice,minimumBid:highest?String(Math.min(MAX_VND+1,Number(highest.amount)+Number(row.bidStep))):row.startingPrice.toString(),serverNow:now,acceptsBids:['SCHEDULED','LIVE'].includes(row.status)&&row.startsAt<=now&&row.endsAt>now,seller:row.listing.product?.store.user??row.listing.sellerUser};
  },{isolationLevel:'RepeatableRead'});
 }
 private paging(scope:string,query:AuctionPageDto){const key='auction:'+scope,p=query.cursor?decodeForumCursor(key,query.cursor):undefined,asOf=p?.asOf??new Date().toISOString();return{where:{createdAt:{lte:new Date(asOf)},...(p?{OR:[{createdAt:{lt:new Date(p.createdAt)}},{createdAt:new Date(p.createdAt),id:{lt:p.id}}]}:{})},finish:<T extends{id:string;createdAt:Date}>(rows:T[])=>({items:rows.slice(0,query.limit),nextCursor:rows.length>query.limit?encodeForumCursor(key,{id:rows[query.limit-1].id,createdAt:rows[query.limit-1].createdAt.toISOString(),asOf,score:0,watermark:'0'}):null})};}
 async feed(query:AuctionPageDto,token?:string){const user=token?await this.identity(token):null,page=this.paging(user?'mine:'+user.id:'public',query);const rows=await this.prisma.auction.findMany({where:{managed:true,AND:[page.where,...(user?[{OR:[{listing:{sellerUserId:user.id}},{listing:{product:{store:{userId:user.id}}}},{bids:{some:{userId:user.id}}}]}]:[])]},select:{id:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:query.limit+1});const result=page.finish(rows);return{...result,items:await Promise.all(result.items.map(r=>this.detail(r.id)))};}
 async history(id:string,query:AuctionPageDto){await this.detail(id);const page=this.paging('bids:'+id,query),rows=await this.prisma.bid.findMany({where:{auctionId:id,sequence:{not:null},...page.where},orderBy:[{createdAt:'desc'},{id:'desc'}],take:query.limit+1,select:bidSelect});const result=page.finish(rows);return{...result,items:result.items.map(r=>({...r,sequence:r.sequence!.toString()}))};}
 async bid(token:string,id:string,input:PlaceBidDto){
  const caller=await this.identity(token);await this.limits.consume(caller.id,'bid');
  const result=await this.prisma.$transaction(async tx=>{
   const auction=await this.locked(tx,id),listing=await this.listing(tx,auction.listingId),user=await this.identity(token,tx,'USER');
   if(this.owner(listing)===user.id)throw new ApiException('FORBIDDEN','Self bidding is forbidden',403);
   const previous=await tx.bid.findUnique({where:{auctionId_userId_idempotencyKey:{auctionId:id,userId:user.id,idempotencyKey:input.idempotencyKey}}});
   if(previous){if(!previous.amount.equals(input.amount)||previous.addressId!==input.addressId)throw this.conflict('Idempotency key has conflicting bid payload');return previous.id;}
   if(!['SCHEDULED','LIVE'].includes(auction.status)||!this.eligible(listing))throw this.conflict('Auction is not accepting bids');
   const highest=await tx.bid.findFirst({where:{auctionId:id,sequence:{not:null}},orderBy:{sequence:'desc'}}),minimum=highest?Number(highest.amount)+Number(auction.bidStep):Number(auction.startingPrice);
   if(input.amount<minimum)throw this.conflict('Bid is below the required minimum');
   await tx.$queryRaw`SELECT address_id FROM "ADDRESS" WHERE address_id=${input.addressId}::uuid AND user_id=${user.id}::uuid FOR SHARE`;
   const address=await tx.address.findFirst({where:{id:input.addressId,userId:user.id},select:{recipient:true,phone:true,addressLine:true,city:true,district:true,ward:true}});if(!address)throw this.missing();
   await this.identity(token,tx,'USER');const now=await this.clock(tx);if(auction.startsAt>now||auction.endsAt<=now)throw this.conflict('Auction is outside its bid interval');
   const version=await this.event(tx,id,'BID',highest?.userId===user.id?'Repeated consecutive bid by current leader':'Accepted bid',user.id);
   const bid=await tx.bid.create({data:{auctionId:id,userId:user.id,amount:String(input.amount),idempotencyKey:input.idempotencyKey,sequence:version,addressId:input.addressId,shippingSnapshot:address,createdAt:now}});
   await tx.auction.update({where:{id},data:{status:'LIVE',endsAt:effectiveEnd(now,auction.endsAt,auction.originalEndsAt!)}});return bid.id;
  });return{bidId:result,auction:await this.detail(id)};
 }
 async cancel(token:string,id:string,reason:string){const caller=await this.identity(token);await this.limits.consume(caller.id,'mutation');await this.prisma.$transaction(async tx=>{
  const auction=await this.locked(tx,id),listing=await this.listing(tx,auction.listingId),user=await this.identity(token,tx);
  if(user.accountType!=='ADMIN'&&this.owner(listing)!==user.id)throw new ApiException('FORBIDDEN','Auction cancellation denied',403);
  if(auction.status==='CANCELLED')return;
  if(!['SCHEDULED','LIVE'].includes(auction.status))throw this.conflict('Cannot cancel an auction after closing');
  if(auction.endsAt<=await this.clock(tx))throw this.conflict('Bidding deadline has passed; cancellation is closed');
  if(user.accountType!=='ADMIN'&&await tx.bid.count({where:{auctionId:id}}))throw this.conflict('Seller cannot cancel after an accepted bid');
  await tx.auction.update({where:{id},data:{status:'CANCELLED'}});await tx.listing.update({where:{id:listing.id},data:{status:'INACTIVE',quantity:{increment:1}}});await this.event(tx,id,'CANCEL',reason,user.id);
 });return this.detail(id);}
 async close(id:string){return this.prisma.$transaction(async tx=>{
  const a=await this.locked(tx,id);if(!['SCHEDULED','LIVE'].includes(a.status))return;
  const now=await this.clock(tx);if(a.endsAt>now)return;
  const listing=await this.listing(tx,a.listingId),bid=await tx.bid.findFirst({where:{auctionId:id,sequence:{not:null}},orderBy:{sequence:'desc'}});
  if(bid)await tx.$queryRaw`SELECT user_id FROM "USER" WHERE user_id=${bid.userId}::uuid FOR SHARE`;
  const buyer=bid?await tx.user.findUnique({where:{id:bid.userId},select:{status:true}}):null;
  if(!bid||!this.eligible(listing)||buyer?.status!=='ACTIVE'){
   await tx.auction.update({where:{id},data:{status:bid?'CANCELLED':'CLOSED_UNSOLD'}});await tx.listing.update({where:{id:listing.id},data:{quantity:{increment:1},status:'INACTIVE'}});await this.event(tx,id,bid?'INELIGIBLE_AT_CLOSE':'CLOSED_UNSOLD',bid?'Winner or seller no longer eligible; no second chance':'No bids at effective deadline');return;
  }
  const order=await this.orders.createAuctionWinner(tx,id,bid.id,now);
  await tx.auction.update({where:{id},data:{status:'AWAITING_PAYMENT',winnerId:bid.userId,winningBid:bid.amount,orderId:order.id}});await this.event(tx,id,'WINNER_ORDER','Winner order created with existing 30-minute prepaid expiry');
 });}
 async reconcile(id:string){return this.prisma.$transaction(async tx=>{
  const a=await this.locked(tx,id);if(a.status!=='AWAITING_PAYMENT'||!a.orderId)return;
  const order=await this.orders.expireAuctionOrder(tx,a.orderId,await this.clock(tx));
  if(order.payments.some(p=>p.status==='PAID')&&order.status!=='CANCELLED'){
   await tx.listing.update({where:{id:a.listingId},data:{status:'SOLD'}});await tx.auction.update({where:{id},data:{status:'SETTLED'}});await this.event(tx,id,'PAID','Existing payment pipeline confirmed winner order');
  }else if(order.status==='CANCELLED'){
   await tx.listing.update({where:{id:a.listingId},data:{status:'INACTIVE'}});await tx.auction.update({where:{id},data:{status:'DEFAULTED'}});await this.event(tx,id,'NON_PAYMENT','Winner order cancelled or expired; inventory released by OrdersService; no second-highest promotion');
  }
 });}
 async outcome(token:string,id:string){const user=await this.identity(token);const a=await this.prisma.auction.findFirst({where:{id,managed:true},select:{winnerId:true,orderId:true,status:true,order:{select:{expiresAt:true,total:true,status:true}}}});if(!a)throw this.missing();return{status:a.status,isWinner:a.winnerId===user.id,orderId:a.winnerId===user.id?a.orderId:null,order:a.winnerId===user.id?a.order:null};}
 async audit(token:string,id:string,query:AuctionPageDto){const user=await this.identity(token),a=await this.prisma.auction.findFirst({where:{id,managed:true},include:{listing:{include:listingInclude}}});if(!a)throw this.missing();if(user.accountType!=='ADMIN'&&this.owner(a.listing)!==user.id)throw new ApiException('FORBIDDEN','Audit is private to seller and ADMIN',403);const page=this.paging('audit:'+id,query),result=page.finish(await this.prisma.auctionEvent.findMany({where:{auctionId:id,...page.where},orderBy:[{createdAt:'desc'},{id:'desc'}],take:query.limit+1}));return{...result,items:result.items.map(r=>({...r,version:r.version.toString()}))};}
 async addresses(token:string){const user=await this.identity(token);return this.prisma.address.findMany({where:{userId:user.id},take:50,orderBy:[{createdAt:'desc'},{id:'desc'}],select:{id:true,recipient:true,phone:true,addressLine:true,city:true,district:true,ward:true}});}
 async addAddress(token:string,input:AuctionAddressDto){const user=await this.identity(token);await this.limits.consume(user.id,'mutation');return this.prisma.$transaction(async tx=>{await this.identity(token,tx,'USER');return tx.address.create({data:{userId:user.id,recipient:input.recipient,phone:input.phone,addressLine:input.addressLine,city:input.city,district:input.district,ward:input.ward},select:{id:true}});});}
}

import { createHash,randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { io,type Socket } from 'socket.io-client';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import { AuctionService } from '../src/modules/auctions/auction.service.js';
import { AuctionWorker } from '../src/modules/auctions/auction.worker.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';

describe('Phase7D real PostgreSQL/HTTP/Socket.IO auctions',()=>{
 let app:INestApplication,prisma:PrismaService,base:string,before:string;
 const users:string[]=[],listingIds:string[]=[],auctionIds:string[]=[],storeIds:string[]=[],productIds:string[]=[],sockets:Socket[]=[],apps:INestApplication[]=[];
 const oldMode=process.env.PAYMENT_MODE;
 const api=()=>request(app.getHttpServer());
 const tables=['CATEGORY','LISTING','PRODUCT','STORE','ORDER','ORDER_ITEM','CHECKOUT_GROUP','PAYMENT','PAYMENT_EVENT','TRANSACTION','SHIPMENT','SHIPMENT_ITEM','CONVERSATION','CONVERSATION_PARTICIPANT','MESSAGE','POST','COMMENT','REPORT','REACTION','CAMPAIGN','CAMPAIGN_PARTICIPANT','CAMPAIGN_AUDIT','CAMPAIGN_ACHIEVEMENT'];
 async function snapshot(){const rows=[];for(const table of tables)rows.push(await prisma.$queryRawUnsafe(`SELECT to_jsonb(t)::text data FROM "${table}" t ORDER BY to_jsonb(t)::text`));return createHash('sha256').update(JSON.stringify(rows)).digest('hex');}
 beforeAll(async()=>{process.env.PAYMENT_MODE='mock';app=await createTestApp();app.get(ConfigService).set('PAYMENT_MODE','mock');prisma=app.get(PrismaService);const url=new URL(app.get(ConfigService).getOrThrow<string>('DATABASE_URL'));expect(['127.0.0.1','localhost']).toContain(url.hostname);expect(url.port).toBe('55432');expect(url.pathname).toBe('/gomgoods_test');expect(await prisma.$queryRaw`SELECT current_database() db,current_schema() schema`).toEqual([{db:'gomgoods_test',schema:'public'}]);before=await snapshot();await app.listen(0,'127.0.0.1');base=await app.getUrl();});
 afterAll(async()=>{
  for(const socket of sockets)socket.disconnect();for(const other of apps)await other.close();
  if(!app)return;
  await app.get(AuctionWorker).onModuleDestroy();
  try{
   const orders=await prisma.order.findMany({where:{items:{some:{listingId:{in:listingIds}}}},select:{id:true}}),ids=orders.map(o=>o.id);
   await prisma.paymentEvent.deleteMany({where:{payment:{orderId:{in:ids}}}});
   await prisma.auctionEvent.deleteMany({where:{auctionId:{in:auctionIds}}});await prisma.bid.deleteMany({where:{auctionId:{in:auctionIds}}});await prisma.auction.deleteMany({where:{id:{in:auctionIds}}});
   await prisma.order.deleteMany({where:{id:{in:ids}}});await prisma.cart.deleteMany({where:{userId:{in:users}}});
   await prisma.listing.deleteMany({where:{id:{in:listingIds}}});await prisma.product.deleteMany({where:{id:{in:productIds}}});await prisma.store.deleteMany({where:{id:{in:storeIds}}});
   await prisma.auctionRateLimit.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});expect(await snapshot()).toBe(before);
  }finally{await app.close();if(oldMode===undefined)delete process.env.PAYMENT_MODE;else process.env.PAYMENT_MODE=oldMode;}
 });
 async function actor(admin=false){const id=randomUUID();users.push(id);await prisma.user.create({data:{id,email:id+'@auction.e2e.gomgoods.local',username:'a_'+id.slice(0,24),passwordHash:'unused-auction-fixture',accountType:admin?'ADMIN':'USER'}});const session=await prisma.authSession.create({data:{userId:id,expiresAt:new Date(Date.now()+3600000)}});const signed=await app.get(AccessTokenService).sign({sub:id,sid:session.id,accountType:admin?'ADMIN':'USER'});const address=await prisma.address.create({data:{userId:id,recipient:'Bạn đọc Việt Nam 👩🏽‍💻',phone:'0900000000',addressLine:'12 Đường Sách',city:'Hồ Chí Minh',district:'Quận 1',ward:'Bến Nghé'}});return{id,token:signed.accessToken,sessionId:session.id,addressId:address.id};}
 type Actor=Awaited<ReturnType<typeof actor>>;
 async function listing(seller:Actor,store=false){let productId:string|undefined;if(store){const s=await prisma.store.create({data:{userId:seller.id,name:'Cửa hàng sưu tầm 😀',status:'ACTIVE'}});storeIds.push(s.id);const category=await prisma.category.findFirstOrThrow({where:{status:'ACTIVE'}});const p=await prisma.product.create({data:{storeId:s.id,categoryId:category.id,name:'Manga tiếng Việt'}});productIds.push(p.id);productId=p.id;}const row=await prisma.listing.create({data:{sellerUserId:store?null:seller.id,productId,price:'100000',quantity:1,condition:'GOOD',description:'Manga có chữ ký 🇻🇳',status:'ACTIVE'}});listingIds.push(row.id);return row;}
 async function create(seller:Actor,listingId?:string){listingId??=(await listing(seller)).id;const row=(await api().post('/api/auctions').auth(seller.token,{type:'bearer'}).send({listingId,startingPrice:100000,bidStep:10000,startsAt:new Date(Date.now()+3000).toISOString(),endsAt:new Date(Date.now()+3604000).toISOString()}).expect(201)).body.data;auctionIds.push(row.id);await window(row.id,300000);return row;}
 async function window(id:string,remaining:number){await prisma.$executeRaw`WITH t AS (SELECT date_trunc('milliseconds',clock_timestamp()) AS now) UPDATE "AUCTION" SET start_time=t.now-interval '2 hours',original_end_time=t.now+${remaining}*interval '1 millisecond',end_time=t.now+${remaining}*interval '1 millisecond' FROM t WHERE auction_id=${id}::uuid`;}
 const payload=(user:Actor,amount=100000,key=randomUUID())=>({amount,idempotencyKey:key,addressId:user.addressId});
 async function bid(user:Actor,id:string,amount=100000){return(await api().post(`/api/auctions/${id}/bids`).auth(user.token,{type:'bearer'}).send(payload(user,amount)).expect(200)).body.data;}
 async function connect(user:Actor,target=base){const socket=io(target+'/auctions',{transports:['websocket'],auth:{accessToken:user.token},extraHeaders:{Origin:'http://localhost:3001'},forceNew:true,reconnection:false});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});return socket;}
 const emit=(socket:Socket,event:string,data:unknown)=>new Promise<{success:boolean;data?:Record<string,unknown>;error?:{code:string}}>((resolve,reject)=>{socket.timeout(4000).emit(event,data,(error:Error|null,value:{success:boolean})=>error?reject(error):resolve(value));});
 it('resolves personal/store ownership, reserves exactly one unit and fences fixed-price checkout and edits',async()=>{
  const seller=await actor(),buyer=await actor(),other=await actor(),l=await listing(seller,true);
  await api().post('/api/auctions').auth(other.token,{type:'bearer'}).send({listingId:l.id,startingPrice:100000,bidStep:10000,startsAt:new Date(Date.now()+5000).toISOString(),endsAt:new Date(Date.now()+3606000).toISOString()}).expect(403);
  const cart=(await api().post('/api/cart/items').auth(buyer.token,{type:'bearer'}).send({listingId:l.id,quantity:1}).expect(201)).body.data;
  const a=await create(seller,l.id);expect((await prisma.listing.findUniqueOrThrow({where:{id:l.id}}))).toMatchObject({quantity:0,status:'RESERVED',sellingMode:'AUCTION'});
  await api().post('/api/cart/items').auth(other.token,{type:'bearer'}).send({listingId:l.id,quantity:1}).expect(404);
  await api().post('/api/checkout').auth(buyer.token,{type:'bearer'}).send({addressId:buyer.addressId,paymentMethod:'BANK_TRANSFER',cartItemIds:[cart.id],idempotencyKey:randomUUID()}).expect(404);
  await api().patch(`/api/listings/${l.id}`).auth(seller.token,{type:'bearer'}).send({price:'1',quantity:1}).expect(409);
  await api().post(`/api/auctions/${a.id}/bids`).auth(seller.token,{type:'bearer'}).send(payload(seller)).expect(403);
  await bid(buyer,a.id);
  await api().delete(`/api/products/${l.productId}`).auth(seller.token,{type:'bearer'}).expect(409);
  await api().patch(`/api/products/${l.productId}`).auth(seller.token,{type:'bearer'}).send({name:'Changed after bids'}).expect(409);
 });
 it('serializes competing bids and selects exactly one highest valid persisted bid',async()=>{
  const seller=await actor(),one=await actor(),two=await actor(),a=await create(seller);
  const responses=await Promise.all([one,two].map(user=>api().post(`/api/auctions/${a.id}/bids`).auth(user.token,{type:'bearer'}).send(payload(user))));expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
  expect(await prisma.bid.count({where:{auctionId:a.id}})).toBe(1);expect(responses.find(r=>r.status===200)!.body.data.auction.currentPrice).toBe('100000');
 });
 it('persists idempotent retries once, rejects conflicting payload and extends only a newly accepted bid',async()=>{
  const seller=await actor(),buyer=await actor(),a=await create(seller);await window(a.id,30000);const body=payload(buyer);
  const first=await api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send(body).expect(200);
  const end=first.body.data.auction.endsAt;expect(Date.parse(end)-Date.now()).toBeGreaterThan(118000);
  const retry=await api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send(body).expect(200);expect(retry.body.data.bidId).toBe(first.body.data.bidId);expect(retry.body.data.auction.endsAt).toBe(end);
  await api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send({...body,amount:110000}).expect(409);expect(await prisma.bid.count({where:{auctionId:a.id}})).toBe(1);
 });
 it('caps repeated soft-close extensions and rejects bids at the persisted deadline',async()=>{
  const seller=await actor(),buyer=await actor(),a=await create(seller);await window(a.id,10000);
  await prisma.$executeRaw`UPDATE "AUCTION" SET original_end_time=clock_timestamp()-interval '29 minutes 50 seconds' WHERE auction_id=${a.id}::uuid`;
  await bid(buyer,a.id);const row=await prisma.auction.findUniqueOrThrow({where:{id:a.id}});expect(+row.endsAt-+row.originalEndsAt!).toBe(1800000);
  await window(a.id,0);await api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send(payload(buyer,110000)).expect(409);
 });
 it('closes concurrently into one winner/order/payment with persisted amount and no client price override',async()=>{
  const seller=await actor(),buyer=await actor(),a=await create(seller);await bid(buyer,a.id,125000);await window(a.id,-1000);
  await Promise.all([1,2,3].map(()=>app.get(AuctionService).close(a.id)));
  const row=await prisma.auction.findUniqueOrThrow({where:{id:a.id},include:{order:{include:{items:true,payments:true}}}});expect(row.status).toBe('AWAITING_PAYMENT');expect(row.winnerId).toBe(buyer.id);expect(row.order!.total.toString()).toBe('125000');expect(row.order!.payments[0].amount.toString()).toBe('125000');expect(row.order!.items[0].unitPrice.toString()).toBe('125000');expect(+row.order!.expiresAt!-+row.order!.createdAt).toBeGreaterThan(1790000);expect(await prisma.order.count({where:{items:{some:{listingId:a.listingId}}}})).toBe(1);
  const stranger=await actor();expect((await api().get(`/api/auctions/${a.id}/outcome`).auth(stranger.token,{type:'bearer'}).expect(200)).body.data.orderId).toBeNull();
  await api().post(`/api/payments/${row.order!.payments[0].id}/mock-confirm`).auth(buyer.token,{type:'bearer'}).send({idempotencyKey:randomUUID(),amount:1}).expect(422);
  await api().post(`/api/payments/${row.order!.payments[0].id}/mock-confirm`).auth(buyer.token,{type:'bearer'}).send({idempotencyKey:randomUUID()}).expect(200);await app.get(AuctionService).reconcile(a.id);
  expect((await prisma.auction.findUniqueOrThrow({where:{id:a.id}})).status).toBe('SETTLED');expect((await prisma.listing.findUniqueOrThrow({where:{id:a.listingId}}))).toMatchObject({quantity:0,status:'SOLD'});
 });
 it('expires unpaid winner orders once, returns inventory and never promotes the second bidder',async()=>{
  const seller=await actor(),first=await actor(),winner=await actor(),a=await create(seller);await bid(first,a.id);await bid(winner,a.id,110000);await window(a.id,-1000);await app.get(AuctionService).close(a.id);
  const row=await prisma.auction.findUniqueOrThrow({where:{id:a.id}});await prisma.order.update({where:{id:row.orderId!},data:{expiresAt:new Date(Date.now()-1000)}});
  await Promise.all([1,2,3].map(()=>app.get(AuctionService).reconcile(a.id)));const end=await prisma.auction.findUniqueOrThrow({where:{id:a.id},include:{order:{include:{payments:true}}}});
  expect(end.status).toBe('DEFAULTED');expect(end.winnerId).toBe(winner.id);expect(end.order!.status).toBe('CANCELLED');expect(end.order!.payments[0].status).toBe('CANCELLED');expect((await prisma.listing.findUniqueOrThrow({where:{id:a.listingId}}))).toMatchObject({quantity:1,status:'INACTIVE',sellingMode:'AUCTION'});expect(await prisma.auctionEvent.count({where:{auctionId:a.id,action:'NON_PAYMENT'}})).toBe(1);
 });
 it('worker reconciles persisted due auctions on another instance/restart and unsold state releases stock',async()=>{
  const seller=await actor(),a=await create(seller);await window(a.id,-1000);const other=await createTestApp();apps.push(other);await other.get(AuctionWorker).tick();expect((await prisma.auction.findUniqueOrThrow({where:{id:a.id}})).status).toBe('CLOSED_UNSOLD');expect((await prisma.listing.findUniqueOrThrow({where:{id:a.listingId}})).quantity).toBe(1);
 });
 it('audits ADMIN cancellation, disallows seller cancellation after bids and retains immutable bids',async()=>{
  const seller=await actor(),buyer=await actor(),admin=await actor(true),a=await create(seller);await bid(buyer,a.id);
  await api().post(`/api/auctions/${a.id}/cancel`).auth(seller.token,{type:'bearer'}).send({reason:'Đổi ý'}).expect(409);await api().post(`/api/auctions/${a.id}/cancel`).auth(buyer.token,{type:'bearer'}).send({reason:'IDOR'}).expect(403);
  await api().post(`/api/auctions/${a.id}/cancel`).auth(admin.token,{type:'bearer'}).send({reason:'Minh chứng vi phạm 🇻🇳 <script>inert</script>'}).expect(200);expect(await prisma.bid.count({where:{auctionId:a.id}})).toBe(1);expect(await prisma.auctionEvent.findFirstOrThrow({where:{auctionId:a.id,action:'CANCEL'}})).toMatchObject({actorId:admin.id,note:'Minh chứng vi phạm 🇻🇳 <script>inert</script>'});await api().get(`/api/auctions/${a.id}/audit`).auth(buyer.token,{type:'bearer'}).expect(403);
 });
 it('shares bid quota across REST, Socket.IO and app instances; emits authoritative version/end time',async()=>{
  const seller=await actor(),buyer=await actor(),a=await create(seller),socket=await connect(buyer);expect((await emit(socket,'auction.subscribe',{auctionId:a.id})).success).toBe(true);
  const update=new Promise<Record<string,unknown>>(resolve=>socket.once('auction.updated',resolve));expect((await emit(socket,'bid.place',{auctionId:a.id,...payload(buyer)})).success).toBe(true);const snapshot=await update;expect(snapshot.id).toBe(a.id);expect(snapshot.version).toBe('2');expect(snapshot.endsAt).toBeTruthy();
  const other=await createTestApp();apps.push(other);for(let i=0;i<19;i++)await request(other.getHttpServer()).post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send(payload(buyer,1)).expect(409);
  const denied=await emit(socket,'bid.place',{auctionId:a.id,...payload(buyer,110000)});expect(denied).toMatchObject({success:false,error:{code:'RATE_LIMIT_EXCEEDED'}});expect(await prisma.bid.count({where:{auctionId:a.id}})).toBe(1);
 });
 it('enforces session revocation, strict identities, private addresses, integer/time validation and public serialization',async()=>{
  const seller=await actor(),buyer=await actor(),other=await actor(),a=await create(seller);
  for(const extra of [{amount:1.1},{amount:1e15},{amount:'100000'},{userId:other.id},{status:'LIVE'},{amount:null}])await api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send({...payload(buyer),...extra}).expect(422);
  await api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send({...payload(buyer),addressId:other.addressId}).expect(404);
  await api().post(`/api/auctions/${a.id}/bids`).send(payload(buyer)).expect(401);
  const socket=await connect(buyer);expect((await emit(socket,'bid.place',{auctionId:a.id,...payload(buyer),userId:other.id})).success).toBe(false);
  await prisma.authSession.update({where:{id:buyer.sessionId},data:{revokedAt:new Date(),revocationReason:'LOGOUT'}});await api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send(payload(buyer)).expect(401);
  const data=await api().get(`/api/auctions/${a.id}`).expect(200);expect(JSON.stringify(data.body)).not.toMatch(/email|password|sessionId|shippingSnapshot|phone|addressId/);expect(await prisma.bid.count({where:{auctionId:a.id}})).toBe(0);
 });
 it('rejects post-deadline ADMIN cancellation, validates duration and exposes scheduled-start LIVE consistently',async()=>{
  const seller=await actor(),buyer=await actor(),admin=await actor(true),l=await listing(seller);
  for(const hours of [0.5,169])await api().post('/api/auctions').auth(seller.token,{type:'bearer'}).send({listingId:l.id,startingPrice:1,bidStep:1,startsAt:new Date(Date.now()+5000).toISOString(),endsAt:new Date(Date.now()+5000+hours*3600000).toISOString()}).expect(422);
  const a=await create(seller,l.id);expect((await api().get(`/api/auctions/${a.id}`).expect(200)).body.data).toMatchObject({status:'LIVE',acceptsBids:true});await bid(buyer,a.id);await window(a.id,-1);
  await api().post(`/api/auctions/${a.id}/cancel`).auth(admin.token,{type:'bearer'}).send({reason:'Late intervention'}).expect(409);
  await app.get(AuctionService).close(a.id);expect((await prisma.auction.findUniqueOrThrow({where:{id:a.id}})).winnerId).toBe(buyer.id);
 });
 it('serializes stale-cart checkout and bidding without user/listing deadlock',async()=>{
  const seller=await actor(),buyer=await actor(),l=await listing(seller);
  const cart=(await api().post('/api/cart/items').auth(buyer.token,{type:'bearer'}).send({listingId:l.id,quantity:1}).expect(201)).body.data;
  const a=await create(seller,l.id);
  const [checkout,bidding]=await Promise.all([api().post('/api/checkout').auth(buyer.token,{type:'bearer'}).send({addressId:buyer.addressId,cartItemIds:[cart.id],paymentMethod:'BANK_TRANSFER',idempotencyKey:randomUUID()}),api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send(payload(buyer))]);
  expect(checkout.status).toBe(404);expect(bidding.status).toBe(200);expect(await prisma.order.count({where:{items:{some:{listingId:l.id}}}})).toBe(0);
 });
 it('rechecks token/session after an auction-lock wait and leaves no forged or expired bid',async()=>{
  const seller=await actor(),buyer=await actor(),a=await create(seller);
  let release!:()=>void,locked!:()=>void;const ready=new Promise<void>(r=>locked=r),hold=new Promise<void>(r=>release=r);
  const blocker=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT auction_id FROM "AUCTION" WHERE auction_id=${a.id}::uuid FOR UPDATE`;locked();await hold;});await ready;
  const pending=api().post(`/api/auctions/${a.id}/bids`).auth(buyer.token,{type:'bearer'}).send(payload(buyer)).then(r=>r);
  try{let waiting=false;for(let i=0;i<40;i++){const rows=await prisma.$queryRaw<{count:number}[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%SELECT auction_id FROM "AUCTION"%'`;if(rows[0].count){waiting=true;break;}await new Promise(r=>setTimeout(r,25));}expect(waiting).toBe(true);await prisma.authSession.update({where:{id:buyer.sessionId},data:{revokedAt:new Date(),revocationReason:'LOGOUT'}});}finally{release();await blocker;}
  expect((await pending).status).toBe(401);expect(await prisma.bid.count({where:{auctionId:a.id}})).toBe(0);
 });
});

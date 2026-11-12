import {randomUUID} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import type {INestApplication} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import request from 'supertest';
import {io,type Socket} from 'socket.io-client';
import {AccessTokenService} from '../src/modules/auth/access-token.service.js';
import {AuctionService} from '../src/modules/auctions/auction.service.js';
import {AuctionWorker} from '../src/modules/auctions/auction.worker.js';
import {PrismaService} from '../src/prisma/prisma.service.js';
import {createTestApp} from './helpers/create-test-app.js';

describe('Phase7 final cross-phase acceptance',()=>{
 let app:INestApplication,prisma:PrismaService,base:string;
 const users:string[]=[],campaigns:string[]=[],listings:string[]=[],auctions:string[]=[],conversations:string[]=[],sockets:Socket[]=[];
 const text='Tiếng Việt 👩🏽‍💻 🇻🇳\r\n<script>window.__phase7=1</script>';
 const oldPaymentMode=process.env.PAYMENT_MODE;
 const api=()=>request(app.getHttpServer());
 function capture(kind:string,id:string){if(process.env.GOMGOODS_PHASE7_FIXTURE_LOG)appendFileSync(process.env.GOMGOODS_PHASE7_FIXTURE_LOG,JSON.stringify({kind,id})+'\n');}
 beforeAll(async()=>{app=await createTestApp();prisma=app.get(PrismaService);const config=app.get(ConfigService),target=new URL(config.getOrThrow<string>('DATABASE_URL'));expect(['127.0.0.1','localhost']).toContain(target.hostname);expect(target.port).toBe('55432');expect(target.pathname).toBe('/gomgoods_test');expect(await prisma.$queryRaw`SELECT current_database() db,current_schema() schema`).toEqual([{db:'gomgoods_test',schema:'public'}]);config.set('PAYMENT_MODE','mock');await app.listen(0,'127.0.0.1');base=await app.getUrl();});
 afterAll(async()=>{if(!app)return;for(const socket of sockets)socket.disconnect();await app.get(AuctionWorker).onModuleDestroy();try{
  const orders=await prisma.order.findMany({where:{items:{some:{listingId:{in:listings}}}},select:{id:true}}),ids=orders.map(o=>o.id);
  await prisma.paymentEvent.deleteMany({where:{payment:{orderId:{in:ids}}}});await prisma.auctionEvent.deleteMany({where:{auctionId:{in:auctions}}});await prisma.bid.deleteMany({where:{auctionId:{in:auctions}}});await prisma.auction.deleteMany({where:{id:{in:auctions}}});await prisma.order.deleteMany({where:{id:{in:ids}}});await prisma.cart.deleteMany({where:{userId:{in:users}}});
  await prisma.message.deleteMany({where:{conversationId:{in:conversations}}});await prisma.conversation.deleteMany({where:{id:{in:conversations}}});await prisma.listing.deleteMany({where:{id:{in:listings}}});
  await prisma.campaignAchievement.deleteMany({where:{participant:{campaignId:{in:campaigns}}}});await prisma.campaignAudit.deleteMany({where:{campaignId:{in:campaigns}}});await prisma.campaignParticipant.deleteMany({where:{campaignId:{in:campaigns}}});await prisma.campaign.deleteMany({where:{id:{in:campaigns}}});
  await prisma.post.deleteMany({where:{userId:{in:users}}});await prisma.forumRateLimit.deleteMany({where:{userId:{in:users}}});await prisma.campaignRateLimit.deleteMany({where:{userId:{in:users}}});await prisma.auctionRateLimit.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});
 }finally{await app.close();if(oldPaymentMode===undefined)delete process.env.PAYMENT_MODE;else process.env.PAYMENT_MODE=oldPaymentMode;}});
 async function actor(admin=false){const id=randomUUID();users.push(id);capture('user',id);await prisma.user.create({data:{id,email:id+'@phase7-final.e2e.gomgoods.local',username:'final_'+id.slice(0,20),passwordHash:'unused-final-fixture',accountType:admin?'ADMIN':'USER'}});const session=await prisma.authSession.create({data:{userId:id,expiresAt:new Date(Date.now()+3600000)}});const signed=await app.get(AccessTokenService).sign({sub:id,sid:session.id,accountType:admin?'ADMIN':'USER'});const address=await prisma.address.create({data:{userId:id,recipient:'Bạn đọc Việt',phone:'0900000000',addressLine:'12 Đường Sách',city:'Hồ Chí Minh',district:'Quận 1',ward:'Bến Nghé'}});return{id,token:signed.accessToken,sessionId:session.id,addressId:address.id};}
 it.each(['SUSPENDED','DELETED'] as const)('does not newly award a %s participant, allows moderation/revocation and preserves Forum/Campaign boundaries',async status=>{
  const admin=await actor(true),user=await actor();
  const input={title:'Hoạt động nghiệm thu '+randomUUID(),description:text,type:'COMMUNITY_CHALLENGE',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),instructions:'Gửi minh chứng riêng tư',completionCriteria:'ADMIN kiểm tra hoàn thành',eligibility:'USER đang hoạt động',note:'Nghiệm thu Phase7'};
  const campaign=(await api().post('/api/campaigns/admin').auth(admin.token,{type:'bearer'}).send(input).expect(201)).body.data;campaigns.push(campaign.id);capture('campaign',campaign.id);
  await api().post(`/api/campaigns/admin/${campaign.id}/publish`).auth(admin.token,{type:'bearer'}).send({note:'Công bố'}).expect(200);
  const participation=(await api().post(`/api/campaigns/${campaign.id}/register`).auth(user.token,{type:'bearer'}).expect(200)).body.data;
  await api().post(`/api/campaigns/participations/${participation.id}/start`).auth(user.token,{type:'bearer'}).expect(200);
  await api().post(`/api/campaigns/participations/${participation.id}/evidence`).auth(user.token,{type:'bearer'}).send({submissionKey:randomUUID(),text}).expect(200);
  const topic=await prisma.forumTopic.findFirstOrThrow({where:{active:true}});
  const post=(await api().post('/api/forum/posts').auth(user.token,{type:'bearer'}).send({title:'Nghiệm thu '+randomUUID(),content:text,topicId:topic.id}).expect(201)).body.data;
  expect((await api().get(`/api/forum/posts/${post.id}`).expect(200)).body.data.content).toBe(text);
  await api().post(`/api/campaigns/admin/participations/${participation.id}/verify`).auth(user.token,{type:'bearer'}).send({note:'Tự trao huy hiệu'}).expect(403);
  await prisma.user.update({where:{id:user.id},data:{status}});
  await api().post(`/api/campaigns/participations/${participation.id}/evidence`).auth(user.token,{type:'bearer'}).send({submissionKey:randomUUID(),text:'Forged'}).expect(403);
  await api().post('/api/forum/posts').auth(user.token,{type:'bearer'}).send({title:'Bypass',content:'Bypass',topicId:topic.id}).expect(403);
  const auditBefore=await prisma.campaignAudit.count({where:{campaignId:campaign.id}});
  await api().post(`/api/campaigns/admin/participations/${participation.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Không cấp mới khi tài khoản bất hoạt'}).expect(409);
  expect(await prisma.campaignAchievement.count({where:{participantId:participation.id}})).toBe(0);expect(await prisma.campaignAudit.count({where:{campaignId:campaign.id}})).toBe(auditBefore);
  await api().get(`/api/campaigns/users/${user.id}/achievements`).expect(404);
  await prisma.user.update({where:{id:user.id},data:{status:'ACTIVE'}});
  await api().post(`/api/campaigns/admin/participations/${participation.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Tài khoản đã khôi phục; đã đối chiếu minh chứng'}).expect(200);
  const badges=(await api().get(`/api/campaigns/users/${user.id}/achievements`).expect(200)).body.data;expect(badges.items).toHaveLength(1);expect(JSON.stringify(badges)).not.toMatch(/evidence|password|email|sessionId/);
  await prisma.user.update({where:{id:user.id},data:{status}});
  await api().post(`/api/campaigns/admin/participations/${participation.id}/revoke`).auth(admin.token,{type:'bearer'}).send({note:'Thu hồi vẫn được phép khi tài khoản bất hoạt'}).expect(200);
 });
 it('keeps authorized listing Chat through auction reservation and paid sale, isolates checkout, and revokes both REST and WS',async()=>{
  const seller=await actor(),buyer=await actor(),foreign=await actor();const listing=await prisma.listing.create({data:{sellerUserId:seller.id,quantity:1,price:'100000',condition:'GOOD',description:text,status:'ACTIVE'}});listings.push(listing.id);capture('listing',listing.id);
  const cart=(await api().post('/api/cart/items').auth(buyer.token,{type:'bearer'}).send({listingId:listing.id,quantity:1}).expect(201)).body.data;
  const conversation=(await api().post('/api/chat/conversations').auth(buyer.token,{type:'bearer'}).send({listingId:listing.id}).expect(201)).body.data.conversation;conversations.push(conversation.id);capture('conversation',conversation.id);
  const socket=io(base+'/chat',{auth:{accessToken:buyer.token},extraHeaders:{Origin:'http://localhost:3001'},transports:['websocket'],forceNew:true,reconnection:false});sockets.push(socket);await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  const ack=await socket.timeout(3000).emitWithAck('conversation.subscribe',{conversationId:conversation.id});expect(ack.success).toBe(true);
  const auction=(await api().post('/api/auctions').auth(seller.token,{type:'bearer'}).send({listingId:listing.id,startingPrice:100000,bidStep:10000,startsAt:new Date(Date.now()+3000).toISOString(),endsAt:new Date(Date.now()+3604000).toISOString()}).expect(201)).body.data;auctions.push(auction.id);capture('auction',auction.id);
  await api().post('/api/checkout').auth(buyer.token,{type:'bearer'}).send({addressId:buyer.addressId,cartItemIds:[cart.id],paymentMethod:'BANK_TRANSFER',idempotencyKey:randomUUID()}).expect(404);
  await api().post('/api/chat/conversations').auth(foreign.token,{type:'bearer'}).send({listingId:listing.id}).expect(404);
  await api().get(`/api/chat/conversations/${conversation.id}`).auth(foreign.token,{type:'bearer'}).expect(404);
  await prisma.$executeRaw`WITH t AS(SELECT date_trunc('milliseconds',clock_timestamp()) AS now) UPDATE "AUCTION" SET start_time=t.now-interval '2 hours',original_end_time=t.now+interval '5 minutes',end_time=t.now+interval '5 minutes' FROM t WHERE auction_id=${auction.id}::uuid`;
  await api().post(`/api/auctions/${auction.id}/bids`).auth(buyer.token,{type:'bearer'}).send({amount:125000,addressId:buyer.addressId,idempotencyKey:randomUUID()}).expect(200);
  await prisma.$executeRaw`WITH t AS(SELECT date_trunc('milliseconds',clock_timestamp()) AS now) UPDATE "AUCTION" SET start_time=t.now-interval '2 hours',original_end_time=t.now-interval '1 second',end_time=t.now-interval '1 second' FROM t WHERE auction_id=${auction.id}::uuid`;
  await app.get(AuctionService).close(auction.id);const closed=await prisma.auction.findUniqueOrThrow({where:{id:auction.id},include:{order:{include:{payments:true}}}});expect(closed.order!.total.toString()).toBe('125000');expect(closed.order!.payments[0].amount.toString()).toBe('125000');
  await api().post(`/api/payments/${closed.order!.payments[0].id}/mock-confirm`).auth(buyer.token,{type:'bearer'}).send({idempotencyKey:randomUUID()}).expect(200);await app.get(AuctionService).reconcile(auction.id);
  expect((await prisma.listing.findUniqueOrThrow({where:{id:listing.id}}))).toMatchObject({quantity:0,status:'SOLD'});
  const sent=(await api().post(`/api/chat/conversations/${conversation.id}/messages`).auth(buyer.token,{type:'bearer'}).send({clientMessageId:randomUUID(),content:text}).expect(201)).body.data.message;expect(sent.content).toBe(text);
  await api().get(`/api/chat/conversations/${conversation.id}/messages`).auth(seller.token,{type:'bearer'}).expect(200);
  const count=await prisma.message.count({where:{conversationId:conversation.id}});await prisma.authSession.update({where:{id:buyer.sessionId},data:{revokedAt:new Date(),revocationReason:'LOGOUT'}});
  await api().post(`/api/chat/conversations/${conversation.id}/messages`).auth(buyer.token,{type:'bearer'}).send({clientMessageId:randomUUID(),content:'Denied'}).expect(401);
  if(socket.connected){try{const denied=await socket.timeout(3000).emitWithAck('message.send',{conversationId:conversation.id,clientMessageId:randomUUID(),content:'Denied WS'});expect(denied.success).toBe(false);}catch{expect(socket.connected).toBe(false);}}
  expect(await prisma.message.count({where:{conversationId:conversation.id}})).toBe(count);
 });
});

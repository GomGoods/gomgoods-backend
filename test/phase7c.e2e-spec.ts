import { createHash, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AccessTokenService } from '../src/modules/auth/access-token.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './helpers/create-test-app.js';

describe('Phase 7C community campaigns HTTP/PostgreSQL', () => {
  let app: INestApplication, prisma: PrismaService, before: string;
  const users: string[] = [], campaigns: string[] = [];
  const api = () => request(app.getHttpServer());
  const protectedTables = ['CATEGORY','LISTING','PRODUCT','STORE','ORDER','ORDER_ITEM','CHECKOUT_GROUP','PAYMENT','PAYMENT_EVENT','TRANSACTION','SHIPMENT','SHIPMENT_ITEM','CONVERSATION','CONVERSATION_PARTICIPANT','MESSAGE','POST','COMMENT','REPORT','REACTION','FORUM_MODERATION_ACTION'];
  async function protectedState() {
    const rows = [];
    for (const table of protectedTables) rows.push(await prisma.$queryRawUnsafe(`SELECT to_jsonb(t)::text data FROM "${table}" t ORDER BY to_jsonb(t)::text`));
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }
  beforeAll(async () => {
    app = await createTestApp(); prisma = app.get(PrismaService);
    const target = new URL(app.get(ConfigService).getOrThrow('DATABASE_URL'));
    expect(['localhost','127.0.0.1']).toContain(target.hostname); expect(target.port).toBe('55432'); expect(target.pathname).toBe('/gomgoods_test');
    expect(await prisma.$queryRaw`SELECT current_database() db,current_schema() schema`).toEqual([{ db: 'gomgoods_test', schema: 'public' }]);
    before = await protectedState();
  });
  async function cleanup() {
      await prisma.campaignAchievement.deleteMany({ where: { participant: { campaignId: { in: campaigns } } } });
      await prisma.campaignAudit.deleteMany({ where: { campaignId: { in: campaigns } } });
      await prisma.campaignParticipant.deleteMany({ where: { campaignId: { in: campaigns } } });
      await prisma.campaign.deleteMany({ where: { id: { in: campaigns } } });
      await prisma.campaignRateLimit.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      expect(await protectedState()).toBe(before);
  }
  afterEach(async () => { if (prisma) await cleanup(); });
  afterAll(async () => {
    if (!app) return;
    try { await cleanup(); } finally { await app.close(); }
  });
  async function actor(admin = false) {
    const id = randomUUID(); users.push(id);
    await prisma.user.create({ data: { id, email: `${id}@phase7c.e2e.gomgoods.local`, username: `c_${id.slice(0,24)}`, passwordHash: 'unused-campaign-fixture', accountType: admin ? 'ADMIN' : 'USER' } });
    const session = await prisma.authSession.create({ data: { userId: id, expiresAt: new Date(Date.now() + 3600000) } });
    const signed = await app.get(AccessTokenService).sign({ sub: id, sid: session.id, accountType: admin ? 'ADMIN' : 'USER' });
    return { id, token: signed.accessToken, sessionId: session.id };
  }
  type Actor = Awaited<ReturnType<typeof actor>>;
  function input(extra: Record<string, unknown> = {}) {
    return { title: 'Cùng trao manga 🇻🇳 ' + randomUUID(), description: 'Cộng đồng ACG — không tiền tệ', type: 'ITEM_DONATION', startsAt: new Date(Date.now()-3600000).toISOString(), endsAt: new Date(Date.now()+3600000).toISOString(), instructions: 'Đăng ký, bàn giao và gửi minh chứng.', completionCriteria: 'ADMIN kiểm tra minh chứng bàn giao.', eligibility: 'Tài khoản USER đang hoạt động', note: 'Lập hoạt động cộng đồng', ...extra };
  }
  async function campaign(admin: Actor, extra: Record<string, unknown> = {}, publish = true) {
    const row = (await api().post('/api/campaigns/admin').auth(admin.token,{type:'bearer'}).send(input(extra)).expect(201)).body.data;
    campaigns.push(row.id);
    if (publish) await api().post(`/api/campaigns/admin/${row.id}/publish`).auth(admin.token,{type:'bearer'}).send({note:'Công bố hoạt động'}).expect(200);
    return row;
  }
  async function register(user: Actor, campaignId: string) { return (await api().post(`/api/campaigns/${campaignId}/register`).auth(user.token,{type:'bearer'}).expect(200)).body.data; }
  async function submitted(user: Actor, campaignId: string) {
    const row = await register(user,campaignId);
    await api().post(`/api/campaigns/participations/${row.id}/start`).auth(user.token,{type:'bearer'}).expect(200);
    const evidence = {submissionKey:randomUUID(),text:'Bàn giao sách tiếng Việt 👩🏽‍💻\r\n<script>alert(1)</script>',url:'https://imgur.com/abc'};
    await api().post(`/api/campaigns/participations/${row.id}/evidence`).auth(user.token,{type:'bearer'}).send(evidence).expect(200);
    return { ...row, evidence };
  }
  it.each(['COMMUNITY_EVENT','ITEM_DONATION','COMMUNITY_CHALLENGE'])('publishes %s only through ADMIN with immutable published criteria and audit', async type => {
    const admin = await actor(true), user = await actor(); const row = await campaign(admin,{type},false);
    await api().get(`/api/campaigns/${row.id}`).expect(404);
    await api().post(`/api/campaigns/admin/${row.id}/publish`).auth(user.token,{type:'bearer'}).send({note:'forged'}).expect(403);
    await api().patch(`/api/campaigns/admin/${row.id}`).auth(admin.token,{type:'bearer'}).send(input({type,title:'Tên đã sửa 😀'})).expect(200);
    await api().post(`/api/campaigns/admin/${row.id}/publish`).auth(admin.token,{type:'bearer'}).send({note:'Công bố'}).expect(200);
    expect((await api().get(`/api/campaigns/${row.id}`).expect(200)).body.data).toMatchObject({title:'Tên đã sửa 😀',type,status:'ACTIVE'});
    await api().patch(`/api/campaigns/admin/${row.id}`).auth(admin.token,{type:'bearer'}).send(input()).expect(409);
    expect((await api().get(`/api/campaigns/admin/${row.id}/audit`).auth(admin.token,{type:'bearer'}).expect(200)).body.data.items.map((r:{action:string})=>r.action)).toEqual(['PUBLISH','EDIT','CREATE']);
  });
  it('serializes duplicate registrations and participation limits', async () => {
    const admin=await actor(true), user=await actor(), other=await actor(); const c=await campaign(admin,{participationLimit:1});
    const responses=await Promise.all(Array.from({length:5},()=>api().post(`/api/campaigns/${c.id}/register`).auth(user.token,{type:'bearer'})));
    expect(responses.map(r=>r.status)).toEqual([200,200,200,200,200]); expect(new Set(responses.map(r=>r.body.data.id)).size).toBe(1);
    await api().post(`/api/campaigns/${c.id}/register`).auth(other.token,{type:'bearer'}).expect(409);
    expect(await prisma.campaignParticipant.count({where:{campaignId:c.id}})).toBe(1);
    expect(await prisma.campaignAudit.count({where:{campaignId:c.id,action:'REGISTER'}})).toBe(1);
  });
  it('enforces account age, active accounts, USER participation and future start', async () => {
    const admin=await actor(true), user=await actor(); const c=await campaign(admin,{minimumAccountAgeDays:7});
    await api().post(`/api/campaigns/${c.id}/register`).auth(user.token,{type:'bearer'}).expect(403);
    await api().post(`/api/campaigns/${c.id}/register`).auth(admin.token,{type:'bearer'}).expect(403);
    const future=await campaign(admin,{startsAt:new Date(Date.now()+60000).toISOString()});
    await api().post(`/api/campaigns/${future.id}/register`).auth(user.token,{type:'bearer'}).expect(409);
    await prisma.user.update({where:{id:user.id},data:{status:'SUSPENDED'}});
    await api().post(`/api/campaigns/${future.id}/register`).auth(user.token,{type:'bearer'}).expect(403);
  });
  it('keeps tags unverified and evidence private while issuing exactly one badge from a real verification', async () => {
    const admin=await actor(true), user=await actor(); const c=await campaign(admin), p=await submitted(user,c.id);
    const tags=(await api().get(`/api/campaigns/users/${user.id}/participation-tags`).expect(200)).body.data;
    expect(tags.items[0]).toMatchObject({verified:false}); expect(JSON.stringify(tags)).not.toMatch(/evidence|script|submissionKey/);
    expect((await api().get(`/api/campaigns/users/${user.id}/achievements`).expect(200)).body.data.items).toEqual([]);
    const responses=await Promise.all([1,2,3].map(()=>api().post(`/api/campaigns/admin/participations/${p.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Đã xác minh bàn giao'})));
    expect(responses.map(r=>r.status)).toEqual([200,200,200]);
    const badge=await prisma.campaignAchievement.findUniqueOrThrow({where:{participantId:p.id},include:{verification:true}});
    expect(badge.verification).toMatchObject({actorId:admin.id,participantId:p.id,action:'VERIFY',fromStatus:'SUBMITTED',toStatus:'VERIFIED'});
    expect(await prisma.campaignAudit.count({where:{participantId:p.id,action:'VERIFY'}})).toBe(1);
    const publicBadges=(await api().get(`/api/campaigns/users/${user.id}/achievements`).expect(200)).body.data;
    expect(publicBadges.items[0]).toMatchObject({id:badge.id,verified:true}); expect(JSON.stringify(publicBadges)).not.toMatch(/evidence|script|email|password/);
  });
  it('makes evidence idempotent and rejects replacement, premature submission, unsafe URLs and forged fields', async () => {
    const admin=await actor(true), user=await actor(); const c=await campaign(admin), p=await register(user,c.id);
    const payload={submissionKey:randomUUID(),text:'Minh chứng sách 😀'};
    const endpoint=`/api/campaigns/participations/${p.id}/evidence`;
    await api().post(endpoint).auth(user.token,{type:'bearer'}).send(payload).expect(409);
    await api().post(`/api/campaigns/participations/${p.id}/start`).auth(user.token,{type:'bearer'}).expect(200);
    for (const extra of [{url:'javascript:alert(1)'},{url:'https://127.0.0.1/x'},{reviewerId:admin.id},{status:'VERIFIED'},{text:null}]) await api().post(endpoint).auth(user.token,{type:'bearer'}).send({...payload,...extra}).expect(422);
    const responses=await Promise.all([1,2,3].map(()=>api().post(endpoint).auth(user.token,{type:'bearer'}).send(payload)));
    expect(responses.map(r=>r.status)).toEqual([200,200,200]);
    await api().post(endpoint).auth(user.token,{type:'bearer'}).send({...payload,text:'Thay thế'}).expect(409);
    expect(await prisma.campaignAudit.count({where:{participantId:p.id,action:'SUBMIT'}})).toBe(1);
  });
  it('preserves rejection, withdrawal and revocation history and hides revoked badges', async () => {
    const admin=await actor(true), user=await actor(), other=await actor(); const c=await campaign(admin), p=await submitted(user,c.id), rejected=await submitted(other,c.id);
    await api().post(`/api/campaigns/admin/participations/${rejected.id}/reject`).auth(admin.token,{type:'bearer'}).send({note:'Không đủ minh chứng'}).expect(200);
    await api().post(`/api/campaigns/admin/participations/${rejected.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Không được mở lại'}).expect(409);
    await api().post(`/api/campaigns/admin/participations/${p.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Đủ điều kiện'}).expect(200);
    const badge=await prisma.campaignAchievement.findUniqueOrThrow({where:{participantId:p.id}});
    await api().put('/api/campaigns/me/featured-badges').auth(user.token,{type:'bearer'}).send({ids:[badge.id]}).expect(200);
    await api().post(`/api/campaigns/admin/participations/${p.id}/revoke`).auth(admin.token,{type:'bearer'}).send({note:'Minh chứng bị thu hồi'}).expect(200);
    const revoked=await prisma.campaignAchievement.findUniqueOrThrow({where:{id:badge.id}}); expect(revoked.revokedAt).not.toBeNull(); expect(revoked.featuredSlot).toBeNull(); expect(revoked.verificationId).toBe(badge.verificationId);
    expect((await api().get(`/api/campaigns/users/${user.id}/achievements`).expect(200)).body.data.items).toEqual([]);
    const c2=await campaign(admin), withdraw=await register(user,c2.id);
    await api().post(`/api/campaigns/participations/${withdraw.id}/withdraw`).auth(user.token,{type:'bearer'}).expect(200);
    expect((await register(user,c2.id)).status).toBe('WITHDRAWN');
    await api().post(`/api/campaigns/participations/${withdraw.id}/start`).auth(user.token,{type:'bearer'}).expect(409);
  });
  it('limits highlights to three own verified badges and serializes concurrent selections', async () => {
    const admin=await actor(true), user=await actor(), other=await actor(); const ids:string[]=[];
    for(let i=0;i<4;i++) {const c=await campaign(admin),p=await submitted(user,c.id); await api().post(`/api/campaigns/admin/participations/${p.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Đủ điều kiện'}).expect(200);ids.push((await prisma.campaignAchievement.findUniqueOrThrow({where:{participantId:p.id}})).id);}
    await api().put('/api/campaigns/me/featured-badges').auth(user.token,{type:'bearer'}).send({ids}).expect(422);
    await api().put('/api/campaigns/me/featured-badges').auth(other.token,{type:'bearer'}).send({ids:[ids[0]]}).expect(409);
    const responses=await Promise.all([ids.slice(0,3),ids.slice(1)].map(selected=>api().put('/api/campaigns/me/featured-badges').auth(user.token,{type:'bearer'}).send({ids:selected})));
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    const featured=await prisma.campaignAchievement.findMany({where:{participant:{userId:user.id},featuredSlot:{not:null}}}); expect(featured).toHaveLength(3);expect(new Set(featured.map(r=>r.featuredSlot)).size).toBe(3);
  });
  it('enforces USER/ADMIN, session, IDOR and self-review boundaries with unchanged target state', async () => {
    const admin=await actor(true), user=await actor(), other=await actor(); const c=await campaign(admin),p=await submitted(user,c.id);
    const before=await prisma.campaignParticipant.findUnique({where:{id:p.id}});
    for(const action of ['start','withdraw','evidence']) await api().post(`/api/campaigns/participations/${p.id}/${action}`).auth(other.token,{type:'bearer'}).send(action==='evidence'?{submissionKey:randomUUID(),text:'IDOR'}:{}).expect(404);
    for(const path of [`admin/${c.id}/submissions`,`admin/${c.id}/audit`,'admin']) {await api().get('/api/campaigns/'+path).expect(401);await api().get('/api/campaigns/'+path).auth(user.token,{type:'bearer'}).expect(403);}
    for(const action of ['verify','reject','revoke']) await api().post(`/api/campaigns/admin/participations/${p.id}/${action}`).auth(user.token,{type:'bearer'}).send({note:'Self award'}).expect(403);
    await prisma.user.update({where:{id:user.id},data:{accountType:'ADMIN'}});
    await api().post(`/api/campaigns/admin/participations/${p.id}/verify`).auth(user.token,{type:'bearer'}).send({note:'Self award'}).expect(403);
    await prisma.user.update({where:{id:admin.id},data:{accountType:'USER'}});
    await api().post(`/api/campaigns/admin/participations/${p.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Stale role'}).expect(403);
    await prisma.authSession.update({where:{id:other.sessionId},data:{revokedAt:new Date(),revocationReason:'LOGOUT'}});
    await api().get('/api/campaigns/me').auth(other.token,{type:'bearer'}).expect(401);
    expect(await prisma.campaignParticipant.findUnique({where:{id:p.id}})).toEqual(before);
    expect(await prisma.campaignAchievement.count({where:{participantId:p.id}})).toBe(0);
  });
  it('closes without automatic awards, rejects new work after closure and allows timely pending review', async () => {
    const admin=await actor(true), user=await actor(), other=await actor();const c=await campaign(admin),p=await submitted(user,c.id);
    await api().post(`/api/campaigns/admin/${c.id}/close`).auth(admin.token,{type:'bearer'}).send({note:'Kết thúc'}).expect(200);
    expect(await prisma.campaignAchievement.count({where:{participantId:p.id}})).toBe(0);
    await api().post(`/api/campaigns/${c.id}/register`).auth(other.token,{type:'bearer'}).expect(409);
    await api().post(`/api/campaigns/admin/participations/${p.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Xác minh minh chứng đúng hạn'}).expect(200);
  });
  it('uses database clock after waiting for campaign lock at the deadline', async () => {
    const admin=await actor(true), user=await actor();const c=await campaign(admin),p=await register(user,c.id);
    await api().post(`/api/campaigns/participations/${p.id}/start`).auth(user.token,{type:'bearer'}).expect(200);
    let release!:()=>void, locked!:()=>void;const ready=new Promise<void>(r=>locked=r), hold=new Promise<void>(r=>release=r);
    const blocker=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT campaign_id FROM "CAMPAIGN" WHERE campaign_id=${c.id}::uuid FOR UPDATE`;await tx.$executeRaw`UPDATE "CAMPAIGN" SET end_time=clock_timestamp()+interval '250 milliseconds' WHERE campaign_id=${c.id}::uuid`;locked();await hold;});
    await ready;
    const result=api().post(`/api/campaigns/participations/${p.id}/evidence`).auth(user.token,{type:'bearer'}).send({submissionKey:randomUUID(),text:'Trễ hạn'}).then(r=>r);
    await new Promise(r=>setTimeout(r,400));release();await blocker;
    expect((await result).status).toBe(409);expect((await prisma.campaignParticipant.findUniqueOrThrow({where:{id:p.id}})).status).toBe('IN_PROGRESS');
  });
  it('binds stable cursors to scope, validates limits and never leaks private fields', async () => {
    const admin=await actor(true),user=await actor(); const ids=[randomUUID(),randomUUID(),randomUUID()].sort();
    for(const id of ids){campaigns.push(id);await prisma.campaign.create({data:{id,name:'Trang ổn định',type:'COMMUNITY_CHALLENGE',organizerId:admin.id,instructions:'Tham gia',completionCriteria:'Xác minh',startsAt:new Date(Date.now()-60000),endsAt:new Date(Date.now()+60000),createdAt:new Date('2025-01-01T00:00:00Z'),status:'ACTIVE'}});await prisma.campaignAudit.create({data:{campaignId:id,actorId:admin.id,action:'PUBLISH',toStatus:'ACTIVE',note:'Published fixture'}});}
    const page=(await api().get('/api/campaigns').query({type:'COMMUNITY_CHALLENGE',limit:2}).expect(200)).body.data;
    expect(page.items.map((r:{id:string})=>r.id)).toEqual(ids.toReversed().slice(0,2));
    const next=(await api().get('/api/campaigns').query({type:'COMMUNITY_CHALLENGE',limit:2,cursor:page.nextCursor}).expect(200)).body.data;
    expect(next.items.map((r:{id:string})=>r.id)).toEqual([ids[0]]);expect(next.nextCursor).toBeNull();
    for(const query of [{limit:51},{limit:0},{cursor:'garbage'},{type:'ITEM_DONATION',cursor:page.nextCursor}]) await api().get('/api/campaigns').query(query).expect(422);
    for(const id of ids)await register(user,id);
    const mine=(await api().get('/api/campaigns/me?limit=2').auth(user.token,{type:'bearer'}).expect(200)).body.data;
    expect(mine.items).toHaveLength(2);expect((await api().get('/api/campaigns/me').query({limit:2,cursor:mine.nextCursor}).auth(user.token,{type:'bearer'}).expect(200)).body.data.items).toHaveLength(1);
    expect(JSON.stringify(page)).not.toMatch(/email|password|evidence|submissionKey/);
  });
  it('shares write rate budgets, includes retry hint, and does not award or submit on denial', async () => {
    const admin=await actor(true),user=await actor();const c=await campaign(admin),p=await register(user,c.id);
    for(let i=0;i<29;i++)await api().post(`/api/campaigns/${c.id}/register`).auth(user.token,{type:'bearer'}).expect(200);
    const denied=await api().post(`/api/campaigns/participations/${p.id}/start`).auth(user.token,{type:'bearer'}).expect(429);expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect((await prisma.campaignParticipant.findUniqueOrThrow({where:{id:p.id}})).status).toBe('REGISTERED');
    await prisma.$executeRaw`UPDATE "CAMPAIGN_RATE_LIMIT" SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=${user.id}::uuid`;
    await api().post(`/api/campaigns/participations/${p.id}/start`).auth(user.token,{type:'bearer'}).expect(200);
  });
  async function waitForCampaignWaiters(count: number) {
    for(let i=0;i<40;i++) {
      const rows=await prisma.$queryRaw<{count:number}[]>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%SELECT campaign_id FROM "CAMPAIGN"%'`;
      if(rows[0].count>=count)return;
      await new Promise(r=>setTimeout(r,25));
    }
    throw new Error('Expected queued HTTP campaign locks');
  }
  it('rejects queued verification when its authenticated session is revoked before the campaign lock is acquired',async()=>{
    const admin=await actor(true),user=await actor(),c=await campaign(admin),p=await submitted(user,c.id);
    let release!:()=>void,locked!:()=>void;const ready=new Promise<void>(r=>locked=r),hold=new Promise<void>(r=>release=r);
    const blocker=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT campaign_id FROM "CAMPAIGN" WHERE campaign_id=${c.id}::uuid FOR UPDATE`;locked();await hold;});
    await ready;
    const review=api().post(`/api/campaigns/admin/participations/${p.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Queued review'}).then(r=>r);
    try {await waitForCampaignWaiters(1);await prisma.authSession.update({where:{id:admin.sessionId},data:{revokedAt:new Date(),revocationReason:'LOGOUT'}});}finally{release();await blocker;}
    expect((await review).status).toBe(401);expect(await prisma.campaignAchievement.count({where:{participantId:p.id}})).toBe(0);expect(await prisma.campaignAudit.count({where:{participantId:p.id,action:'VERIFY'}})).toBe(0);
  });
  it('serializes concurrent withdrawal and verification without user/campaign lock deadlock',async()=>{
    const admin=await actor(true),user=await actor(),c=await campaign(admin),p=await submitted(user,c.id);
    let release!:()=>void,locked!:()=>void;const ready=new Promise<void>(r=>locked=r),hold=new Promise<void>(r=>release=r);
    const blocker=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT campaign_id FROM "CAMPAIGN" WHERE campaign_id=${c.id}::uuid FOR UPDATE`;locked();await hold;});
    await ready;
    const review=api().post(`/api/campaigns/admin/participations/${p.id}/verify`).auth(admin.token,{type:'bearer'}).send({note:'Concurrent review'}).then(r=>r);
    let withdrawal:Promise<request.Response>|undefined;
    try {await waitForCampaignWaiters(1);withdrawal=api().post(`/api/campaigns/participations/${p.id}/withdraw`).auth(user.token,{type:'bearer'}).then(r=>r);await waitForCampaignWaiters(2);}finally{release();await blocker;}
    expect((await review).status).toBe(200);expect((await withdrawal!).status).toBe(409);
    expect((await prisma.campaignParticipant.findUniqueOrThrow({where:{id:p.id}})).status).toBe('VERIFIED');
  });
  it('freezes public publication and audit cursors across later committed actions',async()=>{
    const admin=await actor(true),user=await actor();const late=await campaign(admin,{type:'COMMUNITY_CHALLENGE'},false);
    await prisma.campaign.update({where:{id:late.id},data:{createdAt:new Date('2020-01-01')}});
    const first=await campaign(admin,{type:'COMMUNITY_CHALLENGE'}),second=await campaign(admin,{type:'COMMUNITY_CHALLENGE'});
    const page=(await api().get('/api/campaigns').query({type:'COMMUNITY_CHALLENGE',limit:1}).expect(200)).body.data;
    await api().post(`/api/campaigns/admin/${late.id}/publish`).auth(admin.token,{type:'bearer'}).send({note:'Published after page one'}).expect(200);
    const next=(await api().get('/api/campaigns').query({type:'COMMUNITY_CHALLENGE',limit:1,cursor:page.nextCursor}).expect(200)).body.data;
    expect(new Set([...page.items,...next.items].map((r:{id:string})=>r.id))).toEqual(new Set([first.id,second.id]));expect(next.nextCursor).toBeNull();
    expect((await api().get('/api/campaigns').query({type:'COMMUNITY_CHALLENGE'}).expect(200)).body.data.items.map((r:{id:string})=>r.id)).toContain(late.id);
    const audit=(await api().get(`/api/campaigns/admin/${first.id}/audit?limit=1`).auth(admin.token,{type:'bearer'}).expect(200)).body.data;
    await register(user,first.id);
    const nextAudit=(await api().get(`/api/campaigns/admin/${first.id}/audit`).query({limit:1,cursor:audit.nextCursor}).auth(admin.token,{type:'bearer'}).expect(200)).body.data;
    expect(audit.items[0].action).toBe('PUBLISH');expect(nextAudit.items[0].action).toBe('CREATE');expect(nextAudit.nextCursor).toBeNull();
  });
});

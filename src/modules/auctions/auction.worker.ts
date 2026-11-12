import { Injectable,Logger,type OnModuleInit,type OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuctionService } from './auction.service.js';
@Injectable()
export class AuctionWorker implements OnModuleInit,OnModuleDestroy {
 private timer?:ReturnType<typeof setInterval>;private busy=false;private readonly logger=new Logger(AuctionWorker.name);
 constructor(private readonly prisma:PrismaService,private readonly auctions:AuctionService){}
 onModuleInit(){this.timer=setInterval(()=>{void this.tick().catch(()=>this.logger.warn('Auction reconciliation unavailable; durable state will be retried'));},1000);this.timer.unref();}
 async onModuleDestroy(){if(this.timer)clearInterval(this.timer);while(this.busy)await new Promise(resolve=>setTimeout(resolve,10));}
 async tick(){if(this.busy)return;this.busy=true;try{
  const due=await this.prisma.$queryRaw<{id:string}[]>`SELECT auction_id AS id FROM "AUCTION" WHERE managed AND status IN ('SCHEDULED','LIVE') AND end_time<=statement_timestamp() ORDER BY end_time,auction_id LIMIT 25`;
  for(const row of due)await this.auctions.close(row.id);
  const pending=await this.prisma.$queryRaw<{id:string}[]>`SELECT a.auction_id AS id FROM "AUCTION" a JOIN "ORDER" o ON o.order_id=a.order_id WHERE a.managed AND a.status::text='AWAITING_PAYMENT' AND (o.expires_at<=statement_timestamp() OR o.status<>'PENDING') ORDER BY o.expires_at,a.auction_id LIMIT 25`;for(const row of pending)await this.auctions.reconcile(row.id);
 }finally{this.busy=false;}}
}

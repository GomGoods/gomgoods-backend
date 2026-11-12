import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { PrismaService } from '../../prisma/prisma.service.js';
const budgets={bid:20,mutation:10,socket:60} as const;
@Injectable()
export class AuctionRateLimit {
 constructor(private readonly prisma:PrismaService){}
 async consume(userId:string,operation:keyof typeof budgets){
  try{
   const remaining=await this.prisma.$transaction(async tx=>{
    await tx.$executeRaw`SET LOCAL statement_timeout='1500ms'`;
    await tx.$executeRaw`WITH expired AS (SELECT user_id,operation FROM "AUCTION_RATE_LIMIT" WHERE expires_at<=statement_timestamp() ORDER BY expires_at LIMIT 1000 FOR UPDATE SKIP LOCKED) DELETE FROM "AUCTION_RATE_LIMIT" r USING expired e WHERE r.user_id=e.user_id AND r.operation=e.operation`;
    const rows=await tx.$queryRaw<{ok:boolean}[]>`INSERT INTO "AUCTION_RATE_LIMIT"(user_id,operation,count,expires_at) VALUES(${userId}::uuid,${operation},1,statement_timestamp()+interval '60 seconds') ON CONFLICT(user_id,operation) DO UPDATE SET count=CASE WHEN "AUCTION_RATE_LIMIT".expires_at<=statement_timestamp() THEN 1 ELSE "AUCTION_RATE_LIMIT".count+1 END,expires_at=CASE WHEN "AUCTION_RATE_LIMIT".expires_at<=statement_timestamp() THEN statement_timestamp()+interval '60 seconds' ELSE "AUCTION_RATE_LIMIT".expires_at END WHERE "AUCTION_RATE_LIMIT".expires_at<=statement_timestamp() OR "AUCTION_RATE_LIMIT".count<${budgets[operation]} RETURNING true AS ok`;
    if(rows.length)return 0;
    return (await tx.$queryRaw<{seconds:number}[]>`SELECT GREATEST(1,ceil(extract(epoch FROM(expires_at-statement_timestamp()))))::int AS seconds FROM "AUCTION_RATE_LIMIT" WHERE user_id=${userId}::uuid AND operation=${operation}`)[0]?.seconds??1;
   },{maxWait:1000,timeout:2500});
   if(remaining)throw new ApiException('RATE_LIMIT_EXCEEDED','Auction write limit exceeded',429,[{retryAfterSeconds:remaining}]);
  }catch(e){if(e instanceof ApiException)throw e;throw new ApiException('SERVICE_UNAVAILABLE','Auction admission unavailable',503);}
 }
}

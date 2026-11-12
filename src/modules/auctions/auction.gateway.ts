import { ConfigService } from '@nestjs/config';
import { type OnModuleDestroy } from '@nestjs/common';
import { ConnectedSocket,MessageBody,SubscribeMessage,WebSocketGateway,type OnGatewayInit } from '@nestjs/websockets';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Namespace,Socket } from 'socket.io';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { AuctionSubscribeDto,SocketBidDto } from './auction.dto.js';
import { AuctionService } from './auction.service.js';
import { AuctionRateLimit } from './auction-rate-limit.js';
type Connection={socket:Socket;token:string;userId:string;subscriptions:Map<string,string>};
@WebSocketGateway({namespace:'/auctions'})
export class AuctionGateway implements OnGatewayInit,OnModuleDestroy {
 private connections=new Map<string,Connection>();private timer?:ReturnType<typeof setInterval>;private polling=false;
 constructor(private readonly auctions:AuctionService,private readonly limits:AuctionRateLimit,private readonly config:ConfigService){}
 afterInit(server:Namespace){server.use(async(socket,next)=>{try{
  if(!this.config.getOrThrow<string[]>('CORS_ORIGINS').includes(socket.handshake.headers.origin??''))throw new ApiException('FORBIDDEN','Origin rejected',403);
  const token:unknown=socket.handshake.auth?.accessToken;if(typeof token!=='string'||token.length>4096)throw new ApiException('INVALID_ACCESS_TOKEN','Invalid session',401);
  const user=await this.auctions.identity(token);await this.limits.consume(user.id,'socket');
  if([...this.connections.values()].filter(c=>c.userId===user.id).length>=5)throw new ApiException('RATE_LIMIT_EXCEEDED','Too many connections',429);
  this.connections.set(socket.id,{socket,token,userId:user.id,subscriptions:new Map()});socket.once('disconnect',()=>this.connections.delete(socket.id));socket.conn.once('close',()=>this.connections.delete(socket.id));next();
 }catch(error){const rejected=new Error('Auction connection rejected');Object.assign(rejected,{data:this.failure(error)});next(rejected);}});
 this.timer=setInterval(()=>{void this.poll();},1000);this.timer.unref();}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);this.connections.clear();}
 private failure(error:unknown){return{success:false,error:error instanceof ApiException?{code:error.code,message:error.message,details:error.details}:{code:'SERVICE_UNAVAILABLE',message:'Auction command unavailable',details:[]}};}
 private async command<T extends object>(socket:Socket,body:unknown,type:new()=>T,run:(c:Connection,input:T)=>Promise<unknown>){try{const c=this.connections.get(socket.id);if(!c)throw new ApiException('INVALID_ACCESS_TOKEN','Invalid session',401);await this.limits.consume(c.userId,'socket');await this.auctions.identity(c.token);if(!body||typeof body!=='object'||Array.isArray(body))throw new ApiException('VALIDATION_FAILED','Invalid payload',422);const input=plainToInstance(type,body);if((await validate(input,{whitelist:true,forbidNonWhitelisted:true})).length)throw new ApiException('VALIDATION_FAILED','Invalid payload',422);return{success:true,data:await run(c,input)};}catch(error){return this.failure(error);}}
 @SubscribeMessage('auction.subscribe') subscribe(@ConnectedSocket() socket:Socket,@MessageBody() body:unknown){return this.command(socket,body,AuctionSubscribeDto,async(c,input)=>{if(c.subscriptions.size>=20&&!c.subscriptions.has(input.auctionId))throw new ApiException('RATE_LIMIT_EXCEEDED','Too many subscriptions',429);const snapshot=await this.auctions.detail(input.auctionId);c.subscriptions.set(input.auctionId,snapshot.version);return snapshot;});}
 @SubscribeMessage('auction.unsubscribe') unsubscribe(@ConnectedSocket() socket:Socket,@MessageBody() body:unknown){return this.command(socket,body,AuctionSubscribeDto,async(c,input)=>{c.subscriptions.delete(input.auctionId);return{auctionId:input.auctionId};});}
 @SubscribeMessage('bid.place') bid(@ConnectedSocket() socket:Socket,@MessageBody() body:unknown){return this.command(socket,body,SocketBidDto,(c,input)=>this.auctions.bid(c.token,input.auctionId,input));}
 private async poll(){if(this.polling)return;this.polling=true;try{for(const c of this.connections.values()){
  try{await this.auctions.identity(c.token);}catch{c.socket.emit('auth.expired',{reconnect:true});c.socket.disconnect(true);continue;}
  for(const [id,version]of c.subscriptions){try{const snapshot=await this.auctions.detail(id);if(snapshot.version!==version&&c.socket.connected){c.subscriptions.set(id,snapshot.version);c.socket.emit('auction.updated',snapshot);}}catch{c.socket.emit('auction.unavailable',{auctionId:id});}}
 }}finally{this.polling=false;}}
}

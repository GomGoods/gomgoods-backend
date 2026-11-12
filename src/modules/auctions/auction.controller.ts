import { ArgumentsHost,Body,Catch,Controller,Get,Headers,HttpCode,HttpException,Param,Post,Query,UseFilters,UseGuards,UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth,ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator.js';
import { UuidParamDto } from '../../common/dto/uuid-param.dto.js';
import { ApiException } from '../../common/exceptions/api.exception.js';
import { ApiExceptionFilter } from '../../common/filters/api-exception.filter.js';
import { ForumRequestGuard,ForumResponsePolicy } from '../forum/forum-http-policy.js';
import { AuctionAddressDto,AuctionCancelDto,AuctionPageDto,CreateAuctionDto,PlaceBidDto } from './auction.dto.js';
import { AuctionService } from './auction.service.js';
@Catch()
export class AuctionHttpFilter extends ApiExceptionFilter {
 override catch(error:unknown,host:ArgumentsHost){const response=host.switchToHttp().getResponse<Response>();response.setHeader('Cache-Control','private, no-store');response.setHeader('X-Content-Type-Options','nosniff');if(error instanceof ApiException&&error.code==='RATE_LIMIT_EXCEEDED')response.setHeader('Retry-After',String(error.details[0]?.retryAfterSeconds??60));super.catch(error instanceof HttpException?error:new ApiException('INTERNAL_SERVER_ERROR','Unexpected auction error',500),host);}
}
const token=(header:string)=>header.slice(7);
@ApiTags('Auctions') @UseGuards(ForumRequestGuard) @UseInterceptors(ForumResponsePolicy) @UseFilters(AuctionHttpFilter)
@Controller('auctions')
export class AuctionController {
 constructor(private readonly auctions:AuctionService){}
 @Public() @Get() feed(@Query() query:AuctionPageDto){return this.auctions.feed(query);}
 @Get('me') @ApiBearerAuth() mine(@Headers('authorization') auth:string,@Query() query:AuctionPageDto){return this.auctions.feed(query,token(auth));}
 @Get('me/addresses') @ApiBearerAuth() addresses(@Headers('authorization') auth:string){return this.auctions.addresses(token(auth));}
 @Post('me/addresses') @ApiBearerAuth() address(@Headers('authorization') auth:string,@Body() input:AuctionAddressDto){return this.auctions.addAddress(token(auth),input);}
 @Post() @ApiBearerAuth() create(@Headers('authorization') auth:string,@Body() input:CreateAuctionDto){return this.auctions.create(token(auth),input);}
 @Public() @Get(':id') detail(@Param() params:UuidParamDto){return this.auctions.detail(params.id);}
 @Public() @Get(':id/bids') bids(@Param() params:UuidParamDto,@Query() query:AuctionPageDto){return this.auctions.history(params.id,query);}
 @Post(':id/bids') @HttpCode(200) @ApiBearerAuth() bid(@Headers('authorization') auth:string,@Param() params:UuidParamDto,@Body() input:PlaceBidDto){return this.auctions.bid(token(auth),params.id,input);}
 @Post(':id/cancel') @HttpCode(200) @ApiBearerAuth() cancel(@Headers('authorization') auth:string,@Param() params:UuidParamDto,@Body() input:AuctionCancelDto){return this.auctions.cancel(token(auth),params.id,input.reason);}
 @Get(':id/outcome') @ApiBearerAuth() outcome(@Headers('authorization') auth:string,@Param() params:UuidParamDto){return this.auctions.outcome(token(auth),params.id);}
 @Get(':id/audit') @ApiBearerAuth() audit(@Headers('authorization') auth:string,@Param() params:UuidParamDto,@Query() query:AuctionPageDto){return this.auctions.audit(token(auth),params.id,query);}
}

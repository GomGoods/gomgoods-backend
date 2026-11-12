import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { effectiveEnd,MAX_VND,PlaceBidDto } from './auction.dto.js';
describe('Auction monetary and soft-close boundaries',()=>{
 const original=new Date('2026-11-12T12:00:00.000Z');
 it('does not extend at exactly two minutes, extends below two minutes',()=>{
  expect(effectiveEnd(new Date(+original-120000),original,original)).toEqual(original);
  expect(+effectiveEnd(new Date(+original-119999),original,original)).toBe(+original+1);
 });
 it('caps cumulative extension at thirty minutes and never shortens end',()=>{
  const end=new Date(+original+1800000);expect(effectiveEnd(new Date(+end-1),end,original)).toEqual(end);
  expect(+effectiveEnd(new Date(+original+1790000),new Date(+original+1799999),original)).toBe(+end);
 });
 it.each([0,-1,1.5,MAX_VND+1,Number.MAX_SAFE_INTEGER,NaN,Infinity,'1000'])('rejects non-integer or unsupported VND %s',async amount=>{
  expect((await validate(plainToInstance(PlaceBidDto,{amount,addressId:'00000000-0000-4000-8000-000000000001',idempotencyKey:'00000000-0000-4000-8000-000000000002'}))).length).toBeGreaterThan(0);
 });
});

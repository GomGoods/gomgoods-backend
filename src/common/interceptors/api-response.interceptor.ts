import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { map, type Observable } from 'rxjs';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const statusCode = context.switchToHttp().getResponse().statusCode;
    if (statusCode === 204) {
      return next.handle();
    }
    return next.handle().pipe(map((data) => ({ success: true, data })));
  }
}

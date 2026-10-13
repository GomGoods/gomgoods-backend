import { Module } from '@nestjs/common';

import { StoresModule } from '../stores/stores.module.js';
import { ProductsController } from './products.controller.js';
import { ProductsService } from './products.service.js';

@Module({
  imports: [StoresModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}

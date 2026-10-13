import { Module } from '@nestjs/common';

import { AdminStoresController } from './admin-stores.controller.js';
import { StoresController } from './stores.controller.js';
import { StoresService } from './stores.service.js';

@Module({
  controllers: [StoresController, AdminStoresController],
  providers: [StoresService],
  exports: [StoresService],
})
export class StoresModule {}

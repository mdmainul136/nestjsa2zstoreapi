import { Module } from '@nestjs/common';
import { OperationsController } from './operations.controller';
import { WmsController } from './wms.controller'; // 👉 যোগ
import { OperationsService } from './operations.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [OperationsController, WmsController], // 👉 যোগ
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}

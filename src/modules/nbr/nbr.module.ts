import { Module } from '@nestjs/common';
import { NbrController } from './nbr.controller';
import { NbrService } from './nbr.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NbrController],
  providers: [NbrService],
  exports: [NbrService],
})
export class NbrModule {}

import { Module } from '@nestjs/common';
import { CompetitorController } from './competitor.controller';
import { CompetitorService } from './competitor.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CompetitorController],
  providers: [CompetitorService],
  exports: [CompetitorService],
})
export class CompetitorModule {}

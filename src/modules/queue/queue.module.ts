import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUE_NAMES } from './queue.constants';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { ScraperProcessor } from './processors/scraper.processor';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: Number(configService.get<number>('REDIS_PORT', 6379)),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times) => Math.min(times * 1000, 10000),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: QUEUE_NAMES.SCRAPER_SYNC,
    }),
    forwardRef(() => CatalogModule),
  ],
  controllers: [QueueController],
  providers: [QueueService, ScraperProcessor],
  exports: [QueueService, BullModule],
})
export class QueueModule {}

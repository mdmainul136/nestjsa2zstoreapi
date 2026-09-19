import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { CatalogService } from '../../catalog/catalog.service';

@Processor(QUEUE_NAMES.SCRAPER_SYNC, { concurrency: 5 })
export class ScraperProcessor extends WorkerHost {
  private readonly logger = new Logger(ScraperProcessor.name);

  constructor(
    @Inject(forwardRef(() => CatalogService))
    private readonly catalogService: CatalogService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const startTime = Date.now();
    this.logger.log(`⚙️ Processing BullMQ Job [${job.id}] (${job.name}) - Attempt ${job.attemptsMade + 1}`);

    switch (job.name) {
      case JOB_NAMES.SYNC_EXTENSION_ITEM: {
        try {
          const result = await this.catalogService.syncFromExtension(job.data);
          const duration = Date.now() - startTime;
          this.logger.log(`✅ Completed BullMQ Job [${job.id}] in ${duration}ms`);
          return result;
        } catch (error: any) {
          this.logger.error(`❌ Job [${job.id}] failed: ${error.message}`);
          throw error;
        }
      }

      default:
        this.logger.warn(`⚠️ Unknown job name: ${job.name}`);
        return { skipped: true };
    }
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, JobsOptions } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from './queue.constants';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.SCRAPER_SYNC)
    private readonly scraperQueue: Queue,
  ) {}

  /**
   * Add single scraped item to background processing queue
   */
  async addScrapeSyncJob(data: any, options?: JobsOptions) {
    try {
      const job = await this.scraperQueue.add(
        JOB_NAMES.SYNC_EXTENSION_ITEM,
        data,
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 3000,
          },
          removeOnComplete: 1000,
          removeOnFail: 5000,
          ...options,
        },
      );

      this.logger.log(`📥 Job queued [${job.id}] for url: ${data?.url || data?.title || 'item'}`);
      return {
        success: true,
        queued: true,
        jobId: job.id,
        message: 'Product sync enqueued for background processing',
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to enqueue scraping job: ${error.message}`);
      throw error;
    }
  }

  /**
   * Add bulk scraped items to background processing queue
   */
  async addBulkScrapeJobs(items: any[]) {
    try {
      const jobs = items.map((item, index) => ({
        name: JOB_NAMES.SYNC_EXTENSION_ITEM,
        data: item,
        opts: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 3000,
          },
          delay: index * 100, // Stagger enqueued jobs by 100ms
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      }));

      const queuedJobs = await this.scraperQueue.addBulk(jobs);
      this.logger.log(`📥 Bulk queued ${queuedJobs.length} items for background sync.`);

      return {
        success: true,
        queued: true,
        count: queuedJobs.length,
        jobIds: queuedJobs.map((j) => j.id),
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to enqueue bulk scraping jobs: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get queue status and job metrics (useful for admin dashboard)
   */
  async getQueueMetrics() {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.scraperQueue.getWaitingCount(),
        this.scraperQueue.getActiveCount(),
        this.scraperQueue.getCompletedCount(),
        this.scraperQueue.getFailedCount(),
        this.scraperQueue.getDelayedCount(),
      ]);

      return {
        queue: QUEUE_NAMES.SCRAPER_SYNC,
        counts: {
          waiting,
          active,
          completed,
          failed,
          delayed,
          total: waiting + active + delayed,
        },
        status: 'healthy',
      };
    } catch (error: any) {
      this.logger.warn(`⚠️ Could not fetch queue metrics: ${error.message}`);
      return {
        queue: QUEUE_NAMES.SCRAPER_SYNC,
        status: 'degraded_or_offline',
        error: error.message,
      };
    }
  }
}

import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@ApiTags('Queue')
@ApiSecurity('x-api-key')
@UseGuards(ApiKeyGuard)
@Controller('queue')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @ApiOperation({ summary: 'BullMQ Queue Status & Real-time Metrics (Protected)' })
  @Get('metrics')
  async getMetrics() {
    return this.queueService.getQueueMetrics();
  }
}

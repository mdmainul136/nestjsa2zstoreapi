import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: ['warn', 'error'],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log(
        '✅ PostgreSQL Database connected successfully via Prisma',
      );
    } catch (error) {
      this.logger.error('❌ Failed to connect to Database:', error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🛑 Database disconnected safely');
  }
}

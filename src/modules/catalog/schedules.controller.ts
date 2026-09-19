import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
  BadRequestException,
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiSecurity } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyOrJwtGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const apiKey =
      req.headers['x-api-key'] ||
      req.headers['authorization']?.replace(/^Bearer\s+/i, '');

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('Authentication required (X-API-Key or Bearer token missing)');
    }

    const trimmed = apiKey.trim();

    // 1. Try checking as API Key in database
    const keyHash = crypto.createHash('sha256').update(trimmed).digest('hex');
    const keyRecord = await this.prisma.apiKey.findUnique({
      where: { keyHash },
    });

    if (keyRecord && keyRecord.isActive) {
      if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
        throw new UnauthorizedException('API key has expired');
      }
      this.prisma.apiKey
        .update({
          where: { id: keyRecord.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {});
      req.apiKey = keyRecord;
      return true;
    }

    // 2. Try verifying as JWT session token
    try {
      const decoded = this.jwtService.verify(trimmed);
      if (decoded) {
        req.user = decoded;
        return true;
      }
    } catch {
      // Not a valid JWT either
    }

    throw new UnauthorizedException('Invalid or disabled API Key / Token');
  }
}

function calculateNextRun(runTime: string = '02:00', frequency: string = 'DAILY'): Date {
  const [hourStr, minStr] = (runTime || '02:00').split(':');
  const targetHour = parseInt(hourStr, 10) || 2;
  const targetMin = parseInt(minStr, 10) || 0;

  const next = new Date();
  next.setUTCHours(targetHour, targetMin, 0, 0);

  if (next.getTime() <= Date.now()) {
    const fUpper = (frequency || 'DAILY').toUpperCase();
    if (fUpper === 'HOURLY') {
      next.setTime(Date.now() + 60 * 60 * 1000);
    } else if (fUpper === 'WEEKLY') {
      next.setUTCDate(next.getUTCDate() + 7);
    } else if (fUpper === 'MONTHLY') {
      next.setUTCMonth(next.getUTCMonth() + 1);
    } else {
      next.setUTCDate(next.getUTCDate() + 1);
    }
  }
  return next;
}

function mapScheduleForExtension(job: any) {
  const deliveryConfig = (typeof job.deliveryConfig === 'object' && job.deliveryConfig !== null)
    ? job.deliveryConfig
    : {};
  const batchSize = deliveryConfig.batch_size || 50;

  return {
    id: job.id,
    schedule_id: job.id,
    name: job.name,
    source: job.source,
    input_type: job.inputType,
    input_value: job.inputValue,
    frequency: (job.frequency || 'DAILY').toLowerCase(),
    run_time: job.runTime,
    batch_size: batchSize,
    is_active: job.isActive,
    status: job.isActive ? 'active' : 'paused',
    delivery_type: job.deliveryType,
    delivery_config: deliveryConfig,
    last_run_at: job.lastRunAt,
    last_run: job.lastRunAt,
    next_run_at: job.nextRunAt,
    next_run: job.nextRunAt,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

@ApiTags('Schedules')
@Controller('schedules')
@UseGuards(ApiKeyOrJwtGuard)
@ApiSecurity('x-api-key')
export class SchedulesController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ১. সকল স্ক্র্যাপিং শিডিউল তালিকা: GET /schedules
   */
  @ApiOperation({ summary: 'সকল স্ক্র্যাপিং শিডিউল তালিকা' })
  @Get()
  async getSchedules(@Query('limit') limit?: string, @Query('source') source?: string) {
    const take = Number(limit) || 100;
    const where: any = {};
    if (source && source !== 'all') {
      where.source = { equals: source.toLowerCase(), mode: 'insensitive' };
    }

    const jobs = await this.prisma.scheduledJob.findMany({
      where,
      take,
      orderBy: { createdAt: 'desc' },
    });

    return jobs.map(mapScheduleForExtension);
  }

  /**
   * ২. নির্দিষ্ট শিডিউলের বিস্তারিত: GET /schedules/:id
   */
  @ApiOperation({ summary: 'নির্দিষ্ট শিডিউলের বিস্তারিত' })
  @Get(':id')
  async getScheduleById(@Param('id') id: string) {
    const job = await this.prisma.scheduledJob.findUnique({
      where: { id },
    });
    if (!job) {
      throw new NotFoundException(`Schedule with ID ${id} not found`);
    }
    return mapScheduleForExtension(job);
  }

  /**
   * ৩. নতুন শিডিউল তৈরি: POST /schedules
   */
  @ApiOperation({ summary: 'নতুন স্ক্র্যাপিং শিডিউল তৈরি' })
  @Post()
  async createSchedule(@Body() body: any) {
    const name = (body.name || '').trim();
    if (!name) {
      throw new BadRequestException('Schedule name is required');
    }

    const source = (body.source || 'all').toLowerCase();
    const inputType = body.input_type || body.inputType || 'catalog';
    const inputValue = body.input_value || body.inputValue || 'catalog';
    const runTime = (body.run_time || body.runTime || '02:00').trim();

    let freqEnum: any = 'DAILY';
    const rawFreq = (body.frequency || 'daily').toUpperCase();
    if (['DAILY', 'WEEKLY', 'MONTHLY', 'HOURLY'].includes(rawFreq)) {
      freqEnum = rawFreq;
    }

    const batchSize = Number(body.batch_size || body.batchSize) || 50;
    const deliveryConfig = {
      batch_size: batchSize,
      country: body.country || 'US',
      currency: body.currency || 'USD',
    };

    const nextRunAt = calculateNextRun(runTime, freqEnum);

    const created = await this.prisma.scheduledJob.create({
      data: {
        name,
        source,
        inputType,
        inputValue,
        frequency: freqEnum,
        runTime,
        isActive: body.is_active !== undefined ? Boolean(body.is_active) : true,
        deliveryType: body.delivery_type || 'api',
        deliveryConfig,
        nextRunAt,
      },
    });

    return mapScheduleForExtension(created);
  }

  /**
   * ৪. শিডিউল আপডেট / টগল / এডিট: PATCH /schedules/:id
   */
  @ApiOperation({ summary: 'শিডিউল আপডেট বা টগল' })
  @Patch(':id')
  async updateSchedule(@Param('id') id: string, @Body() body: any) {
    const existing = await this.prisma.scheduledJob.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Schedule with ID ${id} not found`);
    }

    const dataToUpdate: any = {};

    if (body.name !== undefined) dataToUpdate.name = String(body.name).trim();
    if (body.source !== undefined) dataToUpdate.source = String(body.source).toLowerCase();
    if (body.input_type !== undefined) dataToUpdate.inputType = String(body.input_type);
    if (body.input_value !== undefined) dataToUpdate.inputValue = String(body.input_value);

    // Active status toggle
    if (body.is_active !== undefined) {
      dataToUpdate.isActive = Boolean(body.is_active);
    } else if (body.isActive !== undefined) {
      dataToUpdate.isActive = Boolean(body.isActive);
    }

    // Frequency & Run time
    let updatedFreq = existing.frequency;
    if (body.frequency) {
      const fUpper = String(body.frequency).toUpperCase();
      if (['DAILY', 'WEEKLY', 'MONTHLY', 'HOURLY'].includes(fUpper)) {
        dataToUpdate.frequency = fUpper;
        updatedFreq = fUpper as any;
      }
    }

    let updatedRunTime = existing.runTime;
    if (body.run_time || body.runTime) {
      updatedRunTime = String(body.run_time || body.runTime).trim();
      dataToUpdate.runTime = updatedRunTime;
    }

    // Recalculate next run
    dataToUpdate.nextRunAt = calculateNextRun(updatedRunTime, updatedFreq as string);

    // Update batch size in deliveryConfig
    const currentConfig = (typeof existing.deliveryConfig === 'object' && existing.deliveryConfig !== null)
      ? (existing.deliveryConfig as any)
      : {};

    if (body.batch_size !== undefined || body.batchSize !== undefined) {
      const bSize = Number(body.batch_size || body.batchSize) || 50;
      dataToUpdate.deliveryConfig = {
        ...currentConfig,
        batch_size: bSize,
      };
    }

    const updated = await this.prisma.scheduledJob.update({
      where: { id },
      data: dataToUpdate,
    });

    return mapScheduleForExtension(updated);
  }

  /**
   * ৫. শিডিউল মুছে ফেলা: DELETE /schedules/:id
   */
  @ApiOperation({ summary: 'শিডিউল মুছে ফেলা' })
  @Delete(':id')
  async deleteSchedule(@Param('id') id: string) {
    const existing = await this.prisma.scheduledJob.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Schedule with ID ${id} not found`);
    }

    await this.prisma.scheduledJob.delete({
      where: { id },
    });

    return {
      success: true,
      message: `Schedule ${id} deleted successfully`,
    };
  }
}

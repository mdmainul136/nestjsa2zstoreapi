import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CompetitorService } from './competitor.service';
import {
  AddTrackerDto,
  UpdateTrackerDto,
  ManualPriceCheckDto,
} from './dto/competitor.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('competitor')
export class CompetitorController {
  constructor(private readonly competitorService: CompetitorService) {}

  /**
   * ড্যাশবোর্ড সামারি: GET /competitor/summary
   * — মোট ট্র্যাকার, এলার্ট কাউন্ট, সোর্স-ওয়াইজ স্ট্যাটস
   */
  @Get('summary')
  async getDashboardSummary() {
    return this.competitorService.getDashboardSummary();
  }

  /**
   * সব ট্র্যাকার লিস্ট: GET /competitor/trackers
   * — ?source=amazon&alertOnly=true দিয়ে ফিল্টার করা যাবে
   */
  @Get('trackers')
  async listTrackers(
    @Query('source') source?: string,
    @Query('alertOnly') alertOnly?: string,
  ) {
    return this.competitorService.listTrackers(
      source,
      alertOnly === 'true',
    );
  }

  /**
   * একটি ট্র্যাকারের ডিটেইল: GET /competitor/trackers/:id
   */
  @Get('trackers/:id')
  async getTracker(@Param('id', ParseUUIDPipe) id: string) {
    return this.competitorService.getTrackerById(id);
  }

  /**
   * নতুন ট্র্যাকার যোগ করা: POST /competitor/trackers
   */
  @Post('trackers')
  async addTracker(@Body() dto: AddTrackerDto) {
    return this.competitorService.addTracker(dto);
  }

  /**
   * ট্র্যাকার আপডেট (প্রাইস/এলার্ট/স্ট্যাটাস): PATCH /competitor/trackers/:id
   */
  @Patch('trackers/:id')
  async updateTracker(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTrackerDto,
  ) {
    return this.competitorService.updateTracker(id, dto);
  }

  /**
   * ট্র্যাকার ডিলিট: DELETE /competitor/trackers/:id
   */
  @Delete('trackers/:id')
  async deleteTracker(@Param('id', ParseUUIDPipe) id: string) {
    return this.competitorService.deleteTracker(id);
  }

  /**
   * এলার্ট রিসেট: PATCH /competitor/trackers/:id/reset-alert
   */
  @Patch('trackers/:id/reset-alert')
  async resetAlert(@Param('id', ParseUUIDPipe) id: string) {
    return this.competitorService.resetAlert(id);
  }

  /**
   * URL থেকে মার্কেটপ্লেস ID পার্স: POST /competitor/parse-id
   * — ASIN, Walmart Item ID, eBay Item ID
   */
  @Post('parse-id')
  async parseMarketplaceId(@Body() dto: ManualPriceCheckDto) {
    return this.competitorService.parseMarketplaceId(
      dto.productUrl,
      dto.source,
    );
  }
}

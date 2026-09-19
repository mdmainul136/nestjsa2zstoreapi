import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { ValidateCouponDto, AbandonedCartDto } from './dto/marketing.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('marketing')
export class MarketingController {
  constructor(private readonly marketingService: MarketingService) {}

  /**
   * ১. কুপন কোড যাচাই: POST /marketing/coupons/validate
   */
  @Post('coupons/validate')
  async validateCoupon(@Body() dto: ValidateCouponDto) {
    return this.marketingService.validateCoupon(dto);
  }

  @Get('coupons/active')
  async getActiveCoupons() {
    return this.marketingService.getActiveCoupons();
  }

  /**
   * ২. লাইভ কাউন্টডাউন ফ্ল্যাশ সেলস: GET /marketing/flash-sales
   */
  @Get('flash-sales')
  async getFlashSales() {
    return this.marketingService.getActiveFlashSales();
  }

  /**
   * ৩. কম্বো বান্ডেল ডিলস: GET /marketing/bundles
   */
  @Get('bundles')
  async getBundles() {
    return this.marketingService.getActiveBundles();
  }

  /**
   * ৪. আমার লয়্যালটি পয়েন্ট দেখা: GET /marketing/loyalty
   */
  @UseGuards(JwtAuthGuard)
  @Get('loyalty')
  async getLoyalty(@CurrentUser() user: any) {
    return this.marketingService.getUserLoyalty(user.id);
  }

  /**
   * ৫. পরিত্যক্ত কার্ট সেভ: POST /marketing/abandoned-cart
   */
  @Post('abandoned-cart')
  async saveAbandonedCart(@Body() dto: AbandonedCartDto) {
    return this.marketingService.saveAbandonedCart(dto);
  }

  // ─── Admin Routes ───────────────────────────────────────────────────────────

  /**
   * ৬. এডমিন — কুপন তালিকা: GET /marketing/admin/coupons
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin/coupons')
  async getAllCoupons(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.marketingService.getAllCoupons({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      search,
    });
  }

  /**
   * ৭. এডমিন — নতুন কুপন তৈরি: POST /marketing/admin/coupons
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('admin/coupons')
  async createCoupon(@Body() body: any) {
    return this.marketingService.createCoupon(body);
  }

  /**
   * ৮. এডমিন — কুপন আপডেট: PATCH /marketing/admin/coupons/:id
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Patch('admin/coupons/:id')
  async updateCoupon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    return this.marketingService.updateCoupon(id, body);
  }

  /**
   * ৯. এডমিন — কুপন মুছে ফেলা: DELETE /marketing/admin/coupons/:id
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('admin/coupons/:id')
  async deleteCoupon(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketingService.deleteCoupon(id);
  }

  /**
   * ১০. এডমিন — সব ফ্ল্যাশ সেল তালিকা: GET /marketing/admin/flash-sales
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin/flash-sales')
  async getAllFlashSales() {
    return this.marketingService.getAllAdminFlashSales();
  }

  /**
   * ১১. এডমিন — নতুন ফ্ল্যাশ সেল তৈরি: POST /marketing/admin/flash-sales
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('admin/flash-sales')
  async createFlashSale(@Body() body: any) {
    return this.marketingService.createFlashSale(body);
  }

  /**
   * ১২. এডমিন — ফ্ল্যাশ সেল আপডেট: PATCH /marketing/admin/flash-sales/:id
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Patch('admin/flash-sales/:id')
  async updateFlashSale(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: any,
  ) {
    return this.marketingService.updateFlashSale(id, body);
  }

  /**
   * ১৩. এডমিন — ফ্ল্যাশ সেল মুছে ফেলা: DELETE /marketing/admin/flash-sales/:id
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('admin/flash-sales/:id')
  async deleteFlashSale(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketingService.deleteFlashSale(id);
  }

  /**
   * ১৪. এডমিন — সব ইমেইল ক্যাম্পেইন তালিকা: GET /marketing/admin/campaigns
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin/campaigns')
  async getAllCampaigns() {
    return this.marketingService.getAllCampaigns();
  }

  /**
   * ১৫. এডমিন — নতুন ইমেইল ক্যাম্পেইন তৈরি: POST /marketing/admin/campaigns
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('admin/campaigns')
  async createCampaign(@Body() body: any) {
    return this.marketingService.createCampaign(body);
  }

  /**
   * ১৬. এডমিন — ইমেইল ক্যাম্পেইন আপডেট: PATCH /marketing/admin/campaigns/:id
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Patch('admin/campaigns/:id')
  async updateCampaign(@Param('id', ParseUUIDPipe) id: string, @Body() body: any) {
    return this.marketingService.updateCampaign(id, body);
  }

  /**
   * ১৭. এডমিন — ইমেইল ক্যাম্পেইন মুছে ফেলা: DELETE /marketing/admin/campaigns/:id
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('admin/campaigns/:id')
  async deleteCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketingService.deleteCampaign(id);
  }

  /**
   * ১৮. এডমিন — লাইভ ক্যাম্পেইন ব্রডকাস্ট পাঠানো: POST /marketing/admin/campaigns/:id/send
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('admin/campaigns/:id/send')
  async sendCampaign(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketingService.sendCampaign(id);
  }

  /**
   * ১৯. এডমিন — নিউজলেটার সাবস্ক্রাইবার্স তালিকা: GET /marketing/admin/subscribers
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin/subscribers')
  async getSubscribers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.marketingService.getAllSubscribers(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
      search,
    );
  }

  /**
   * ২০. এডমিন — সাবস্ক্রাইবার যোগ করা: POST /marketing/admin/subscribers
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('admin/subscribers')
  async addSubscriber(@Body('email') email: string, @Body('source') source?: string) {
    return this.marketingService.addSubscriber(email, source);
  }

  /**
   * ২১. এডমিন — সাবস্ক্রাইবার মুছে ফেলা: DELETE /marketing/admin/subscribers/:id
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('admin/subscribers/:id')
  async deleteSubscriber(@Param('id', ParseUUIDPipe) id: string) {
    return this.marketingService.deleteSubscriber(id);
  }

  /**
   * ২২. এডমিন — পরিত্যক্ত কার্ট তালিকা: GET /marketing/admin/abandoned-carts
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('admin/abandoned-carts')
  async getAbandonedCarts(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.marketingService.getAllAbandonedCarts(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 50,
    );
  }

  /**
   * ২৩. এডমিন — পরিত্যক্ত কার্ট রিকভারি ইমেইল পাঠানো: POST /marketing/admin/abandoned-carts/:id/recover
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('admin/abandoned-carts/:id/recover')
  async recoverCart(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('couponCode') couponCode?: string,
  ) {
    return this.marketingService.sendCartRecoveryReminder(id, couponCode);
  }
}


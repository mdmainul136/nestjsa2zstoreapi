import { GenerateApiKeyDto } from './dto/generate-api-key.dto';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Controller, Get, Put, Body, Param, UseGuards, Post, Delete, Query } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * ১. সাধারণ স্টোর তথ্য (Public)
   * GET /settings/store
   */
  @Get('store')
  async getStoreSettings() {
    return this.settingsService.getStoreSettings();
  }

  /**
   * ২. স্টোর তথ্য আপডেট (Admin Only)
   * PUT /settings/store
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('store')
  async updateStoreSettings(@Body() data: any) {
    return this.settingsService.updateStoreSettings(data);
  }

  /**
   * ৩. চেকআউটের জন্য অ্যাক্টিভ পেমেন্ট মেথডস (Public)
   * GET /settings/payment-methods
   */
  @Get('payment-gateways')
  async getPaymentGateways() {
    return this.settingsService.getPaymentGateways();
  }

  @Get('payment-methods')
  async getPaymentMethods() {
    return this.settingsService.getPublicPaymentMethods();
  }

  /**
   * ৪. পেমেন্ট গেটওয়ে কনফিগ আপডেট (Admin Only)
   * PUT /settings/payment-gateways
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('payment-gateways')
  async updatePaymentGateways(@Body() data: any) {
    return this.settingsService.updatePaymentGateways(data);
  }

  /**
   * ৫. স্টোরফ্রন্ট সম্পূর্ণ সিএমএস কন্টেন্ট (Public for Next.js SSR)
   * GET /settings/cms
   */
  @Get('cms')
  async getCmsContent() {
    return this.settingsService.getCmsContent();
  }

  /**
   * ৬. সিএমএস কন্টেন্ট আপডেট (Admin Only)
   * PUT /settings/cms
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('cms')
  async updateCmsContent(@Body() data: any) {
    return this.settingsService.updateCmsContent(data);
  }

  /**
   * ৭. কুরিয়ার এপিআই কনফিগ (Admin Only)
   * GET /settings/couriers & PUT /settings/couriers/:provider
   */
    @Get('couriers')
  async getCouriers() {
    return this.settingsService.getCourierConfigs();
  }

  @Put('couriers/:provider')
  async updateCourier(@Param('provider') provider: string, @Body() data: any) {
    return this.settingsService.updateCourierConfig(provider, data);
  }

  /**
   * ৮. নতুন ক্রিপ্টোগ্রাফিক API Key তৈরি (SuperAdmin & Admin Only)
   * POST /settings/api-keys
   */
  @ApiOperation({ summary: 'নতুন ক্রিপ্টোগ্রাফিক API Key জেনারেট করা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('api-keys')
  @ApiOperation({ summary: 'নতুন ক্রিপ্টোগ্রাফিক API Key তৈরি করা (POST)' })
  async createApiKey(@Body() body?: GenerateApiKeyDto) {
    return this.settingsService.generateApiKey(body);
  }

  @Put('api-keys/generate')
  @ApiOperation({ summary: 'নতুন ক্রিপ্টোগ্রাফিক API Key তৈরি করা (PUT)' })
  async generateApiKey(@Body() body?: GenerateApiKeyDto) {
    return this.settingsService.generateApiKey(body);
  }

  /**
   * ৯. সব সক্রিয় API Key তালিকা দেখা (Admin Only)
   * GET /settings/api-keys
   */
  @ApiOperation({ summary: 'সব সক্রিয় API Key তালিকা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('api-keys')
  async listApiKeys() {
    return this.settingsService.getApiKeys();
  }

  /**
   * ১০. কোনো API Key বাতিল / রিভোক করা (Admin Only)
   * PUT /settings/api-keys/:id/revoke
   */
  @ApiOperation({ summary: 'API Key চিরতরে ডিলিট করা (DELETE)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('api-keys/:id')
  async deleteApiKey(@Param('id') id: string) {
    return this.settingsService.deleteApiKey(id);
  }

  @ApiOperation({ summary: 'API Key চিরতরে ডিলিট করা (PUT)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('api-keys/:id/delete')
  async deleteApiKeyPut(@Param('id') id: string) {
    return this.settingsService.deleteApiKey(id);
  }

  @ApiOperation({ summary: 'API Key বাতিল / রিভোক করা (PUT)' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('api-keys/:id/revoke')
  async revokeApiKey(@Param('id') id: string) {
    return this.settingsService.revokeApiKey(id);
  }

  /**
   * AI ইঞ্জিন কনফিগারেশন (Admin Only)
   * GET /settings/ai & PUT /settings/ai
   */
  @ApiOperation({ summary: 'AI ইঞ্জিন ও প্রম্পট সেটিংস পাওয়া' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('ai')
  async getAiSettings() {
    return this.settingsService.getAiSettings();
  }

  @ApiOperation({ summary: 'AI ইঞ্জিন সেটিংস আপডেট করা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('ai')
  async updateAiSettings(@Body() data: any) {
    return this.settingsService.updateAiSettings(data);
  }

  /**
   * Auth ও সোশ্যাল লগইন কনফিগারেশন (Admin Only)
   * GET /settings/auth & PUT /settings/auth
   */
  @ApiOperation({ summary: 'Auth ও সোশ্যাল লগইন সেটিংস পাওয়া' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('auth')
  async getAuthSettings() {
    return this.settingsService.getAuthSettings();
  }

  @ApiOperation({ summary: 'Auth ও সোশ্যাল লগইন সেটিংস আপডেট করা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('auth')
  async updateAuthSettings(@Body() data: any) {
    return this.settingsService.updateAuthSettings(data);
  }

  /**
   * নোটিফিকেশন ও SMTP গেটওয়ে সেটিংস (Admin Only)
   * GET /settings/notifications & PUT /settings/notifications
   */
  @ApiOperation({ summary: 'নোটিফিকেশন ও SMTP গেটওয়ে কনফিগারেশন' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('notifications')
  async getNotificationSettings() {
    return this.settingsService.getNotificationSettings();
  }

  @ApiOperation({ summary: 'নোটিফিকেশন ও SMTP গেটওয়ে সেটিংস আপডেট করা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('notifications')
  async updateNotificationSettings(@Body() data: any) {
    return this.settingsService.updateNotificationSettings(data);
  }

  @ApiOperation({ summary: 'SMTP টেস্ট ইমেইল পাঠানো' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('notifications/test-email')
  async sendTestEmail(@Body('email') email: string) {
    return this.settingsService.sendTestEmail(email);
  }

  /**
   * ইমেইল টেমপ্লেট লাইব্রেরি (Admin Only)
   * GET /settings/email-templates, POST /settings/email-templates, PUT /settings/email-templates/:id, DELETE /settings/email-templates/:id
   */
  @ApiOperation({ summary: 'সব ইমেইল টেমপ্লেটের তালিকা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('email-templates')
  async getEmailTemplates() {
    return this.settingsService.getEmailTemplates();
  }

  @ApiOperation({ summary: 'নতুন ইমেইল টেমপ্লেট তৈরি' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('email-templates')
  async createEmailTemplate(@Body() data: any) {
    return this.settingsService.createEmailTemplate(data);
  }

  @ApiOperation({ summary: 'ইমেইল টেমপ্লেট আপডেট করা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Put('email-templates/:id')
  async updateEmailTemplate(@Param('id') id: string, @Body() data: any) {
    return this.settingsService.updateEmailTemplate(id, data);
  }

  @ApiOperation({ summary: 'ইমেইল টেমপ্লেট মুছে ফেলা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('email-templates/:id')
  async deleteEmailTemplate(@Param('id') id: string) {
    return this.settingsService.deleteEmailTemplate(id);
  }

  @ApiOperation({ summary: 'নোটিফিকেশন অডিট লগ্স দেখা' })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Get('notification-logs')
  async getNotificationLogs(@Query('limit') limit?: string) {
    return this.settingsService.getNotificationLogs(limit ? parseInt(limit) : 50);
  }
}


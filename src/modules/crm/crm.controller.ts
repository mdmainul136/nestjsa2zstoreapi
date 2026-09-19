import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CrmService } from './crm.service';
import {
  CreateTicketDto,
  ReplyTicketDto,
  RequestRefundDto,
  CreateResaleListingDto,
} from './dto/crm.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  /**
   * ১. আমার ওয়ালেট দেখা: GET /crm/wallet
   */
  @UseGuards(JwtAuthGuard)
  @Get('wallet')
  async getMyWallet(@CurrentUser() user: any) {
    return this.crmService.getMyWallet(user.id);
  }

  /**
   * ২. রিফান্ডের আবেদন: POST /crm/refunds
   */
  @UseGuards(JwtAuthGuard)
  @Post('refunds')
  async requestRefund(@Body() dto: RequestRefundDto, @CurrentUser() user: any) {
    return this.crmService.requestRefund(dto, user.id);
  }

  /**
   * ৩. সাপোর্ট টিকেট ওপেন: POST /crm/tickets
   */
  @UseGuards(JwtAuthGuard)
  @Post('tickets')
  async createTicket(@Body() dto: CreateTicketDto, @CurrentUser() user: any) {
    return this.crmService.createTicket(dto, user.id);
  }

  /**
   * ৪. টিকেটে মেসেজ রিপ্লাই: POST /crm/tickets/:id/reply
   */
  @UseGuards(JwtAuthGuard)
  @Post('tickets/:id/reply')
  async replyTicket(
    @Param('id') id: string,
    @Body() dto: ReplyTicketDto,
    @CurrentUser() user: any,
  ) {
    return this.crmService.replyTicket(
      id,
      dto,
      user.id,
      user.role === 'STAFF' || user.role === 'ADMIN',
    );
  }

  /**
   * ৫. আমার সব টিকেট: GET /crm/tickets
   */
  @UseGuards(JwtAuthGuard)
  @Get('tickets')
  async getMyTickets(@CurrentUser() user: any) {
    return this.crmService.getMyTickets(user.id);
  }

  /**
   * ৬. ১-ক্লিক রি-সেল পোস্ট করা: POST /crm/resale
   */
  @UseGuards(JwtAuthGuard)
  @Post('resale')
  async createResaleListing(
    @Body() dto: CreateResaleListingDto,
    @CurrentUser() user: any,
  ) {
    return this.crmService.createResaleListing(dto, user.id);
  }

  /**
   * ৭. পাবলিক রি-সেল শপ ফিড (Public Pre-Loved Store): GET /crm/resale
   */
  @Get('resale')
  async getResaleListings() {
    return this.crmService.getPublicResaleListings();
  }

  // ─── Admin Routes ───────────────────────────────────────────────────────────

  /**
   * ৮. এডমিন — সব সাপোর্ট টিকেট দেখা: GET /crm/admin/tickets
   */
  @Get('admin/tickets')
  async getAllTickets(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.crmService.getAllTickets({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      status,
      search,
    });
  }

  /**
   * ৮.১ এলিয়াস রুট: GET /crm/my-tickets
   */
  @Get('my-tickets')
  async getMyTicketsAlias(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.crmService.getAllTickets({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      status,
      search,
    });
  }

  @Get('admin/tickets/:id')
  async getTicketByIdAdmin(@Param('id') id: string) {
    return this.crmService.getTicketById(id);
  }

  @Get('tickets/:id')
  async getTicketById(@Param('id') id: string) {
    return this.crmService.getTicketById(id);
  }

  /**
   * ৯. এডমিন — টিকেট স্ট্যাটাস / অ্যাসাইন আপডেট: PATCH /crm/admin/tickets/:id/status
   */
  @Patch('admin/tickets/:id/status')
  async updateTicketStatusAdmin(
    @Param('id') id: string,
    @Body() body: { status: string; assignedStaffId?: string },
  ) {
    return this.crmService.updateTicketStatus(id, body.status, body.assignedStaffId);
  }

  @Patch('tickets/:id/status')
  async updateTicketStatus(
    @Param('id') id: string,
    @Body() body: { status: string; assignedStaffId?: string },
  ) {
    return this.crmService.updateTicketStatus(id, body.status, body.assignedStaffId);
  }

  @Post('admin/tickets/:id/reply')
  async replyTicketAdmin(
    @Param('id') id: string,
    @Body() dto: { message: string },
  ) {
    return this.crmService.replyTicket(id, dto as any, undefined, true);
  }

  /**
   * ১০. এডমিন — সব রিফান্ড রিকোয়েস্ট দেখা: GET /crm/admin/refunds
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'STAFF')
  @Get('admin/refunds')
  async getAllRefunds(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.crmService.getAllRefunds({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
      status,
    });
  }

  /**
   * ১১. এডমিন — রিফান্ড রিকোয়েস্ট অনুমোদন/প্রসেস/বাতিল: PATCH /crm/admin/refunds/:id/status
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Patch('admin/refunds/:id/status')
  async updateRefundStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string; adminNotes?: string },
    @CurrentUser() user: any,
  ) {
    return this.crmService.updateRefundStatus(
      id,
      body.status,
      body.adminNotes,
      user?.name || 'Admin',
    );
  }
}

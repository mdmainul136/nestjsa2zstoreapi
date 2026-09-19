import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Delete,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CustomerService } from './customer.service';
import {
  CreateReviewDto,
  CreateProductRequestDto,
  AskQuestionDto,
  ContactMessageDto,
} from './dto/customer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  /**
   * ১. রিভিউ সাবমিট: POST /customer/reviews
   */
  @Post('reviews')
  async addReview(@Body() dto: CreateReviewDto) {
    return this.customerService.addReview(dto);
  }

  /**
   * ২. উইশলিস্ট টগল (এড বা রিমুভ): POST /customer/wishlist/toggle/:productId
   */
  @UseGuards(JwtAuthGuard)
  @Post('wishlist/toggle/:productId')
  async toggleWishlist(
    @Param('productId') productId: string,
    @CurrentUser() user: any,
  ) {
    return this.customerService.toggleWishlist(productId, user.id);
  }

  /**
   * ৩. আমার উইশলিস্ট দেখা: GET /customer/wishlist
   */
  @UseGuards(JwtAuthGuard)
  @Get('wishlist')
  async getMyWishlist(@CurrentUser() user: any) {
    return this.customerService.getMyWishlist(user.id);
  }

  /**
   * ৪. "Buy For Me" লিংক কোটেশন রিকোয়েস্ট: POST /customer/buy-for-me
   */
  @Post('buy-for-me')
  async createProductRequest(@Body() dto: CreateProductRequestDto) {
    return this.customerService.createProductRequest(dto);
  }

  /**
   * ৫. আমার করা সোর্সিং রিকোয়েস্টের তালিকা: GET /customer/my-requests
   */
  @UseGuards(JwtAuthGuard)
  @Get('my-requests')
  async getMyRequests(@CurrentUser() user: any) {
    return this.customerService.getMyRequests(user.id);
  }

  /**
   * ৬. প্রোডাক্টে প্রশ্ন করা: POST /customer/questions
   */
  @Post('questions')
  async askQuestion(@Body() dto: AskQuestionDto) {
    return this.customerService.askQuestion(dto);
  }

  /**
   * ৭. কন্টাক্ট মেসেজ: POST /customer/contact
   */
  @Post('contact')
  async submitContact(@Body() dto: ContactMessageDto) {
    return this.customerService.submitContact(dto);
  }

  // ─── Admin Routes ───────────────────────────────────────────────────────────

  /**
   * ৮. এডমিন — সব কাস্টমার তালিকা: GET /customer/admin/users
   */
  @Get('admin/users')
  async getAllCustomers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
  ) {
    return this.customerService.getAllCustomers({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      search,
    });
  }

  /**
   * ৮.১ এডমিন — নির্দিষ্ট কাস্টমারের সম্পূর্ণ প্রোফাইল: GET /customer/admin/users/:id
   */
  @Get('admin/users/:id')
  async getCustomerById(@Param('id') id: string) {
    return this.customerService.getCustomerById(id);
  }

  /**
   * ৮.২ এডমিন — কাস্টমার ডিলিট: DELETE /customer/admin/users/:id
   */
  @Delete('admin/users/:id')
  async deleteCustomer(@Param('id') id: string) {
    return this.customerService.deleteCustomer(id);
  }

  /**
   * ৯. এডমিন — কাস্টমার অ্যাক্টিভ/সাসপেন্ড স্ট্যাটাস টগল: PATCH /customer/admin/users/:id/status
   */
  @Patch('admin/users/:id/status')
  async updateCustomerStatus(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.customerService.updateCustomerStatus(id, body.isActive);
  }

  /**
   * ১০. এডমিন — সব "Buy For Me" / RFQ সোর্সিং রিকোয়েস্ট: GET /customer/admin/requests
   */
  @Get('admin/requests')
  async getAllProductRequests(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.customerService.getAllProductRequests({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      status,
    });
  }

  /**
   * ১১. এডমিন — সোর্সিং রিকোয়েস্ট কোটেশন ও স্ট্যাটাস আপডেট: PATCH /customer/admin/requests/:id
   */
  @Patch('admin/requests/:id')
  async updateProductRequestStatus(
    @Param('id') id: string,
    @Body()
    body: {
      status: string;
      quotedPriceUsd?: number;
      quotedPriceBdt?: number;
      adminNotes?: string;
    },
  ) {
    return this.customerService.updateProductRequestStatus(id, body);
  }
}

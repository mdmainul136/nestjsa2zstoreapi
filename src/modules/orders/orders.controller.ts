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
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * ১. চেকআউট এপিআই: POST /orders/checkout
   */
  @Post('checkout')
  async createOrder(@Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(dto);
  }

  /**
   * ২. লাইভ পার্সেল ট্র্যাকিং: GET /orders/:orderNumber/track
   */
  @Get(':orderNumber/track')
  async trackOrder(@Param('orderNumber') orderNumber: string) {
    return this.ordersService.trackOrder(orderNumber);
  }

  /**
   * ৩. লগইন করা কাস্টমারের অর্ডার হিস্ট্রি: GET /orders/my-orders
   */
  @UseGuards(JwtAuthGuard)
  @Get('my-orders')
  async getMyOrders(@CurrentUser() user: any) {
    return this.ordersService.getMyOrders(user.id);
  }

  // ─── Admin Routes ───────────────────────────────────────────────────────────

  /**
   * ৪. এডমিন — সব অর্ডার তালিকা (paginated):
   * GET /orders?status=PENDING&search=A2Z&page=1&limit=20
   */
    @Get()
  async getAllOrders(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    return this.ordersService.getAllOrders({
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 50,
      status,
      search,
    });
  }

  @Get(':id')
  async getOrderById(@Param('id') id: string) {
    return this.ordersService.getOrderById(id);
  }

  @Patch(':id/status')
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: string; title?: string; description?: string },
  ) {
    return this.ordersService.updateOrderStatus(
      id,
      body.status,
      body.title ?? body.status,
      body.description ?? `Status changed to ${body.status}`,
    );
  }

  @Post(':id/dispatch-courier')
  async dispatchCourier(
    @Param('id') id: string,
    @Body() body: { courierName: string; courierTrackingCode?: string; notes?: string },
  ) {
    return this.ordersService.dispatchCourier(id, body);
  }

  @Post('dispatch/bulk')
  async bulkDispatch(
    @Body() body: { orderIds: string[]; courierName: string; notes?: string },
  ) {
    return this.ordersService.bulkDispatch(body);
  }
}

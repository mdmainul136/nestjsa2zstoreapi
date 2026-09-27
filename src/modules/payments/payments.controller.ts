import { Controller, Post, Get, Body, Query, Req, Res, HttpStatus } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('initialize')
  async initializePayment(@Body() payload: any) {
    return this.paymentsService.initializePayment(payload);
  }

  @Post('ipn')
  async handleIpn(@Body() payload: any) {
    return this.paymentsService.handleIpn(payload);
  }

  @Post('verify-stripe')
  async verifyStripePayment(@Body() payload: { session_id?: string; order_id?: string }) {
    return this.paymentsService.verifyStripePayment(payload.session_id, payload.order_id);
  }

  @Get('verify-stripe')
  async verifyStripePaymentGet(
    @Query('session_id') sessionId?: string,
    @Query('order_id') orderId?: string,
  ) {
    return this.paymentsService.verifyStripePayment(sessionId, orderId);
  }
}

import { Controller, Post, Body, Req, Res, HttpStatus } from '@nestjs/common';
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
}

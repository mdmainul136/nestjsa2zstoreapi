import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { OperationsService } from './operations.service';
import { CreatePurchaseOrderDto, BarcodeScanDto } from './dto/operations.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN', 'STAFF')
@Controller('operations')
export class OperationsController {
  constructor(private readonly operationsService: OperationsService) {}

  /**
   * ১. নতুন পারচেজ অর্ডার তৈরি: POST /operations/purchase-orders
   */
  @Post('purchase-orders')
  async createPO(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: any,
  ) {
    return this.operationsService.createPurchaseOrder(
      dto,
      user?.name || user?.email,
    );
  }

  /**
   * ২. সব পারচেজ অর্ডার তালিকা: GET /operations/purchase-orders
   */
  @Get('purchase-orders')
  async getPOs() {
    return this.operationsService.getPurchaseOrders();
  }

  /**
   * ৩. বারকোড গান স্ক্যানিং এপিআই: POST /operations/wms/scan
   */
  @Post('wms/scan')
  async scanBarcode(@Body() dto: BarcodeScanDto, @CurrentUser() user: any) {
    return this.operationsService.processBarcodeScan(
      dto,
      user?.name || 'WMS Staff',
    );
  }

  /**
   * ৪. ওয়্যারহাউস র‍্যাক ও বিন লোকেশন দেখা: GET /operations/wms/locations/:warehouseId
   */
  @Get('wms/locations/:warehouseId')
  async getLocations(@Param('warehouseId') warehouseId: string) {
    return this.operationsService.getWarehouseLocations(warehouseId);
  }

  /**
   * ৫. সাপ্লায়ার একাউন্টস মনিটরিং: GET /operations/supplier-accounts
   */
  @Get('supplier-accounts')
  async getSupplierAccounts() {
    return this.operationsService.getSupplierAccounts();
  }
}

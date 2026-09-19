import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Role } from '@prisma/client';
import { OperationsService } from './operations.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('WMS & Warehouse Logistics')
@ApiBearerAuth()
@Controller('wms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERADMIN, Role.STAFF)
export class WmsController {
  constructor(private readonly operationsService: OperationsService) {}

  // ─────────────────────────────────────────────────────────────
  // ─── 1. WMS DASHBOARD STATS ──────────────────────────────────
  // ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get comprehensive WMS operational dashboard statistics' })
  @Get('dashboard')
  async getDashboardStats() {
    const data = await this.operationsService.getDashboardStats();
    return { success: true, data };
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 2. INBOUND & QC PARCEL OPERATIONS ───────────────────────
  // ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get all parcels with status and warehouse filter' })
  @Get('parcels')
  async getParcels(
    @Query('status') status?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.operationsService.getParcels({ status, warehouseId, search });
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Create new expected or received parcel' })
  @Post('parcels')
  async createParcel(@Body() body: any) {
    const data = await this.operationsService.createParcel(body);
    return { success: true, message: 'পার্সেল সফলভাবে তৈরি করা হয়েছে', data };
  }

  @ApiOperation({ summary: 'Get parcel details by id' })
  @Get('parcels/:id')
  async getParcelById(@Param('id') id: string) {
    const data = await this.operationsService.getParcelById(id);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Update parcel details' })
  @Put('parcels/:id')
  async updateParcel(@Param('id') id: string, @Body() body: any) {
    const data = await this.operationsService.updateParcel(id, body);
    return { success: true, message: 'পার্সেল তথ্য আপডেট হয়েছে', data };
  }

  @ApiOperation({ summary: 'Inbound receive parcel scan' })
  @Post('receive')
  async receiveParcel(@Body() body: any, @CurrentUser() user: any) {
    return this.operationsService.processBarcodeScan(
      {
        barcode: body.tracking_number || body.supplierTracking || body.barcode,
        action: 'INBOUND_RECEIVE',
        warehouseId: body.warehouse_id || body.warehouseId,
        parcelId: body.parcel_id || body.parcelId,
      },
      user?.name || 'Inbound Staff',
    );
  }

  @ApiOperation({ summary: 'Perform QC unboxing & inspection on parcel' })
  @Post('parcels/:id/qc')
  async qcParcel(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    const data = await this.operationsService.qcParcel(
      id,
      body,
      user?.name || 'QC Inspector',
    );
    return { success: true, message: 'QC ইন্সপেকশন সফলভাবে সম্পন্ন হয়েছে', data };
  }

  @ApiOperation({ summary: 'Repack parcel & remove bulky packaging' })
  @Post('parcels/:id/repack')
  async repackParcel(
    @Param('id') id: string,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    const data = await this.operationsService.repackParcel(
      id,
      body,
      user?.name || 'Repack Specialist',
    );
    return { success: true, message: 'পার্সেল রিপ্যাকিং ও ওজন হ্রাস সম্পন্ন', data };
  }

  @ApiOperation({ summary: 'Assign parcel to warehouse bin location' })
  @Post('parcels/:id/bin')
  async assignParcelBin(
    @Param('id') id: string,
    @Body() body: { locationBarcode: string },
    @CurrentUser() user: any,
  ) {
    const data = await this.operationsService.assignParcelBin(
      id,
      body,
      user?.name || 'Bin Allocator',
    );
    return { success: true, message: 'পার্সেল নির্দিষ্ট বিনে বরাদ্দ হয়েছে', data };
  }

  @ApiOperation({ summary: 'Delete parcel by id' })
  @HttpCode(HttpStatus.OK)
  @Delete('parcels/:id')
  async deleteParcel(@Param('id') id: string) {
    const data = await this.operationsService.deleteParcel(id);
    return { success: true, message: 'পার্সেল মুছে ফেলা হয়েছে', data };
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 3. HANDHELD ZEBRA BARCODE SCANNER ───────────────────────
  // ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Universal barcode scan action (Inbound, Bin, QC, Repack, Dispatch)' })
  @Post('scan')
  async scanBarcode(@Body() body: any, @CurrentUser() user: any) {
    return this.operationsService.processBarcodeScan(
      body,
      user?.name || 'WMS Scanner Staff',
    );
  }

  @ApiOperation({ summary: 'Get live barcode scan audit logs' })
  @Get('scan-logs')
  async getScanLogs(@Query('limit') limit?: string) {
    const data = await this.operationsService.getScanLogs(limit ? parseInt(limit) : 30);
    return { success: true, data };
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 4. WAREHOUSE LOCATIONS & RACKS/BINS ─────────────────────
  // ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get all rack/shelf/bin locations for warehouse' })
  @Get('locations')
  async getAllLocations(@Query('warehouseId') warehouseId?: string) {
    const data = await this.operationsService.getWarehouseLocations(warehouseId);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Get warehouse locations by warehouse id' })
  @Get('locations/:warehouseId')
  async getLocationsByWarehouse(@Param('warehouseId') warehouseId: string) {
    const data = await this.operationsService.getWarehouseLocations(warehouseId);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Create single warehouse rack/bin location' })
  @Post('locations')
  async createLocation(@Body() body: any) {
    const data = await this.operationsService.createWarehouseLocation(body);
    return { success: true, message: 'ওয়্যারহাউস বিন লোকেশন তৈরি হয়েছে', data };
  }

  @ApiOperation({ summary: 'Bulk auto-generate warehouse grid (Aisles, Racks, Shelves, Bins)' })
  @Post('locations/bulk-generate')
  async bulkGenerateLocations(@Body() body: any) {
    const data = await this.operationsService.bulkGenerateWarehouseLocations(body);
    return { success: true, message: 'ওয়্যারহাউস গ্রিড ও বারকোড জেনারেট সম্পন্ন', data };
  }

  @ApiOperation({ summary: 'Delete warehouse location' })
  @HttpCode(HttpStatus.OK)
  @Delete('locations/:id')
  async deleteLocation(@Param('id') id: string) {
    const data = await this.operationsService.deleteWarehouseLocation(id);
    return { success: true, message: 'লোকেশন মুছে ফেলা হয়েছে', data };
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 5. PACKAGING MATERIALS & SUPPLIES ───────────────────────
  // ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get packaging materials inventory and cost' })
  @Get('packaging-materials')
  async getPackagingMaterials() {
    const data = await this.operationsService.getPackagingMaterials();
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Create or update packaging material' })
  @Post('packaging-materials')
  async upsertPackagingMaterial(@Body() body: any) {
    const data = await this.operationsService.upsertPackagingMaterial(body);
    return { success: true, message: 'প্যাকেজিং ম্যাটেরিয়াল আপডেট করা হয়েছে', data };
  }

  @ApiOperation({ summary: 'Delete packaging material' })
  @HttpCode(HttpStatus.OK)
  @Delete('packaging-materials/:id')
  async deletePackagingMaterial(@Param('id') id: string) {
    const data = await this.operationsService.deletePackagingMaterial(id);
    return { success: true, message: 'ম্যাটেরিয়াল মুছে ফেলা হয়েছে', data };
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 6. WAREHOUSES & FLIGHT SCHEDULES ────────────────────────
  // ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get all export warehouses with live parcel counts' })
  @Get('warehouses')
  async getWarehouses() {
    const data = await this.operationsService.getWarehouses();
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Create or update warehouse hub' })
  @Post('warehouses')
  async upsertWarehouse(@Body() body: any) {
    const data = await this.operationsService.upsertWarehouse(body);
    return { success: true, message: 'ওয়্যারহাউস সফলভাবে সেভ হয়েছে', data };
  }

  @ApiOperation({ summary: 'Update warehouse hub by id' })
  @Put('warehouses/:id')
  async updateWarehouse(@Param('id') id: string, @Body() body: any) {
    const data = await this.operationsService.upsertWarehouse({ ...body, id });
    return { success: true, message: 'ওয়্যারহাউস সফলভাবে আপডেট হয়েছে', data };
  }

  @ApiOperation({ summary: 'Get warehouse details by id' })
  @Get('warehouses/:id')
  async getWarehouseById(@Param('id') id: string) {
    const data = await this.operationsService.getWarehouseById(id);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Update warehouse weekly flight schedule & notice' })
  @Put('warehouses/:id/schedule')
  async updateWarehouseSchedule(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const data = await this.operationsService.updateWarehouseSchedule(id, body);
    return {
      success: true,
      message: 'ওয়্যারহাউস ফ্লাইট শিডিউল সফলভাবে আপডেট করা হয়েছে',
      data,
    };
  }

  @ApiOperation({ summary: 'Delete warehouse hub' })
  @HttpCode(HttpStatus.OK)
  @Delete('warehouses/:id')
  async deleteWarehouse(@Param('id') id: string) {
    const data = await this.operationsService.deleteWarehouse(id);
    return { success: true, message: 'ওয়্যারহাউস মুছে ফেলা হয়েছে', data };
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 7. MULTI-CARRIER PARTNERS (Leg 1, 2, 3) ─────────────────
  // ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get shipping carriers filtered by leg' })
  @Get('carriers')
  async getShippingCarriers(@Query('leg') leg?: string) {
    const data = await this.operationsService.getShippingCarriers(leg);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Create or update shipping carrier partner' })
  @Post('carriers')
  async upsertShippingCarrier(@Body() body: any) {
    const data = await this.operationsService.upsertShippingCarrier(body);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Toggle carrier active/disabled status' })
  @Patch('carriers/:id/toggle')
  async toggleCarrierStatus(@Param('id') id: string) {
    const data = await this.operationsService.toggleCarrierStatus(id);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Delete shipping carrier' })
  @HttpCode(HttpStatus.OK)
  @Delete('carriers/:id')
  async deleteCarrier(@Param('id') id: string) {
    const data = await this.operationsService.deleteShippingCarrier(id);
    return { success: true, message: 'ক্যারিয়ার মুছে ফেলা হয়েছে', data };
  }

  // ─────────────────────────────────────────────────────────────
  // ─── 8. CARGO FLIGHT MANIFESTS (Leg 2 Air Freight) ───────────
  // ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get cargo flight manifests' })
  @Get('manifests')
  async getCargoManifests(
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
  ) {
    const data = await this.operationsService.getCargoManifests(warehouseId, status);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Get single flight manifest by id with assigned parcels' })
  @Get('manifests/:id')
  async getManifestById(@Param('id') id: string) {
    const data = await this.operationsService.getManifestById(id);
    return { success: true, data };
  }

  @ApiOperation({ summary: 'Create cargo flight manifest & bundle QC-passed parcels' })
  @Post('manifests')
  async createCargoManifest(
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    const data = await this.operationsService.createCargoManifest(
      body,
      user?.name || 'WMS Staff',
    );
    return {
      success: true,
      message: 'কার্গো ফ্লাইট ম্যানিফেস্ট তৈরি ও পার্সেল সংযুক্ত করা হয়েছে',
      data,
    };
  }

  @ApiOperation({ summary: 'Update manifest status with parcel status propagation' })
  @Patch('manifests/:id/status')
  async updateCargoManifestStatus(
    @Param('id') id: string,
    @Body() body: { status: string; notes?: string },
  ) {
    const data = await this.operationsService.updateCargoManifestStatus(
      id,
      body.status,
      body.notes,
    );
    return {
      success: true,
      message: `ম্যানিফেস্ট স্ট্যাটাস আপডেট হয়েছে: ${body.status}`,
      data,
    };
  }

  @ApiOperation({ summary: 'Delete cargo manifest' })
  @HttpCode(HttpStatus.OK)
  @Delete('manifests/:id')
  async deleteManifest(@Param('id') id: string) {
    const data = await this.operationsService.deleteCargoManifest(id);
    return { success: true, message: 'ম্যানিফেস্ট মুছে ফেলা হয়েছে', data };
  }
}

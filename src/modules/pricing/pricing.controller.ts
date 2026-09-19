import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Pricing Engine')
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  // ─────────────────────────────────────────────────────────
  // 1. LIVE CALCULATOR (GET & POST)
  // ─────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Live 3-Leg Landed Cost Calculator (Query params)' })
  @Get('calculate')
  async previewPrice(
    @Query('usd') usd: string,
    @Query('weight') weight?: string,
    @Query('categoryId') categoryId?: string,
    @Query('categoryName') categoryName?: string,
    @Query('hsCode') hsCode?: string,
    @Query('source') source?: string,
    @Query('sourceCurrency') sourceCurrency?: string,
    @Query('lengthCm') lengthCm?: string,
    @Query('widthCm') widthCm?: string,
    @Query('heightCm') heightCm?: string,
    @Query('extraPackagingWeight') extraPackagingWeight?: string,
    @Query('hasMembership') hasMembership?: string,
    @Query('shippingMethod') shippingMethod?: string,
    @Query('originCountry') originCountry?: string,
    @Query('destinationZone') destinationZone?: string,
  ) {
    return this.pricingService.calculateLandedPrice({
      sourcePriceUsd: parseFloat(usd) || 10.0,
      weightKg: weight !== undefined ? parseFloat(weight) : 0.2,
      categoryId,
      categoryName,
      hsCode,
      source,
      sourceCurrency,
      lengthCm: lengthCm ? parseFloat(lengthCm) : undefined,
      widthCm: widthCm ? parseFloat(widthCm) : undefined,
      heightCm: heightCm ? parseFloat(heightCm) : undefined,
      extraPackagingWeight: extraPackagingWeight ? parseFloat(extraPackagingWeight) : undefined,
      hasMembership: hasMembership === 'true' || hasMembership === '1',
      shippingMethod,
      originCountry,
      destinationZone,
    });
  }

  @ApiOperation({ summary: 'Live 3-Leg Landed Cost Calculator (JSON Body)' })
  @Post('calculate')
  async calculateLandedPricePost(@Body() body: any) {
    return this.pricingService.calculateLandedPrice({
      sourcePriceUsd: Number(body.sourcePriceUsd ?? body.usd ?? 10.0),
      sourceCurrency: body.sourceCurrency,
      weightKg: body.weightKg !== undefined ? Number(body.weightKg) : (body.weight !== undefined ? Number(body.weight) : 0.2),
      lengthCm: body.lengthCm !== undefined ? Number(body.lengthCm) : undefined,
      widthCm: body.widthCm !== undefined ? Number(body.widthCm) : undefined,
      heightCm: body.heightCm !== undefined ? Number(body.heightCm) : undefined,
      extraPackagingWeight: body.extraPackagingWeight !== undefined ? Number(body.extraPackagingWeight) : undefined,
      categoryId: body.categoryId,
      categoryName: body.categoryName ?? body.category,
      hsCode: body.hsCode,
      source: body.source,
      hasMembership: Boolean(body.hasMembership ?? body.prime),
      shippingMethod: body.shippingMethod,
      originCountry: body.originCountry,
      destinationZone: body.destinationZone ?? body.zone,
      volumetricDivisor: body.volumetricDivisor ? Number(body.volumetricDivisor) : undefined,
      minMarginBdt: body.minMarginBdt ? Number(body.minMarginBdt) : undefined,
    });
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Recalculate selling prices for all products in a category' })
  @Post('recalculate-category')
  async recalculateCategory(@Body() body: { categoryId: string }) {
    return this.pricingService.recalculateCategoryPrices(body.categoryId);
  }

  // ─────────────────────────────────────────────────────────
  // 2. SHIPPING RATES (Leg 2: Air Freight $/kg)
  // ─────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get all international air shipping rates' })
  @Get('shipping-rates')
  async getShippingRates() {
    return this.pricingService.getShippingRates();
  }

  @ApiBearerAuth()
    @ApiOperation({ summary: 'Create or update a shipping rate (upsert by id)' })
  @Post('shipping-rates')
  async upsertShippingRate(@Body() body: any) {
    return this.pricingService.upsertShippingRate(body);
  }

  @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete a shipping rate by id' })
  @HttpCode(HttpStatus.OK)
  @Delete('shipping-rates/:id')
  async deleteShippingRate(@Param('id') id: string) {
    return this.pricingService.deleteShippingRate(id);
  }

  // ─────────────────────────────────────────────────────────
  // 3. MARKETPLACE SHIPPING RULES (Leg 1: US Domestic)
  // ─────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get all marketplace US domestic shipping rules' })
  @Get('marketplace-rules')
  async getMarketplaceRules() {
    return this.pricingService.getMarketplaceRules();
  }

  @ApiBearerAuth()
    @ApiOperation({ summary: 'Create or update a marketplace shipping rule' })
  @Post('marketplace-rules')
  async upsertMarketplaceRule(@Body() body: any) {
    return this.pricingService.upsertMarketplaceRule(body);
  }

  @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete a marketplace rule by id' })
  @HttpCode(HttpStatus.OK)
  @Delete('marketplace-rules/:id')
  async deleteMarketplaceRule(@Param('id') id: string) {
    return this.pricingService.deleteMarketplaceRule(id);
  }

  // ─────────────────────────────────────────────────────────
  // 4. REGIONAL DELIVERY RATES (Leg 3: Local BD Courier)
  // ─────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get dynamic local delivery zones based on active couriers' })
  @Get('local-courier-zones')
  async getLocalCourierZones() {
    return this.pricingService.getLocalCourierZones();
  }

  @ApiOperation({ summary: 'Get all Bangladesh local delivery rates' })
  @Get('delivery-rates')
  async getDeliveryRates() {
    return this.pricingService.getDeliveryRates();
  }

  @ApiBearerAuth()
    @ApiOperation({ summary: 'Create or update a delivery rate' })
  @Post('delivery-rates')
  async upsertDeliveryRate(@Body() body: any) {
    return this.pricingService.upsertDeliveryRate(body);
  }

  @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete a delivery rate by id' })
  @HttpCode(HttpStatus.OK)
  @Delete('delivery-rates/:id')
  async deleteDeliveryRate(@Param('id') id: string) {
    return this.pricingService.deleteDeliveryRate(id);
  }

  // ─────────────────────────────────────────────────────────
  // 5. CURRENCY EXCHANGE RATES
  // ─────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get all currency exchange rates' })
  @Get('exchange-rates')
  async getExchangeRates() {
    return this.pricingService.getExchangeRates();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or update a currency exchange rate' })
  @Put('exchange-rates')
  async upsertExchangeRate(@Body() body: any) {
    return this.pricingService.upsertExchangeRate(body);
  }

  @ApiBearerAuth()
  @Post('exchange-rates')
  async postExchangeRate(@Body() body: any) {
    return this.pricingService.upsertExchangeRate(body);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update global FX risk buffer percentage for all currency pairs' })
  @Put('exchange-rates/buffer')
  async updateFxBuffer(@Body() body: { bufferPct: number }) {
    return this.pricingService.updateFxBuffer(Number(body.bufferPct));
  }

  @ApiBearerAuth()
  @Post('exchange-rates/buffer')
  async postFxBuffer(@Body() body: { bufferPct: number }) {
    return this.pricingService.updateFxBuffer(Number(body.bufferPct));
  }

  // ─────────────────────────────────────────────────────────
  // 6. HS CODE / NBR CUSTOMS TARIFF TABLE
  // ─────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get all HS code customs tariff rules (searchable)' })
  @Get('hs-codes')
  async getHsCodes(@Query('q') q?: string) {
    return this.pricingService.getHsCodes(q);
  }

  @ApiBearerAuth()
    @ApiOperation({ summary: 'Create or update an HS code tariff rule' })
  @Post('hs-codes')
  async upsertHsCode(@Body() body: any) {
    return this.pricingService.upsertHsCode(body);
  }

  @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete an HS code rule by id' })
  @HttpCode(HttpStatus.OK)
  @Delete('hs-codes/:id')
  async deleteHsCode(@Param('id') id: string) {
    return this.pricingService.deleteHsCode(id);
  }

  // ─────────────────────────────────────────────────────────
  // 7. CATEGORY PRICING RULES (Margin + Duty %)
  // ─────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Get all category-level profit margin & duty rules' })
  @Get('rules')
  async getPricingRules() {
    return this.pricingService.getPricingRules();
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update a category pricing rule' })
  @Post('rules')
  async upsertPricingRule(@Body() body: any) {
    return this.pricingService.upsertPricingRule(body);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a category pricing rule' })
  @Delete('rules/:id')
  async deletePricingRule(@Param('id') id: string) {
    return this.pricingService.deletePricingRule(id);
  }
}

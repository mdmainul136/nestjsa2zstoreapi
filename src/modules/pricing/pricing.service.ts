import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface PriceBreakdown {
  sourcePriceUsd: number;
  sourceCurrency: string;
  exchangeRate: number;
  fxBufferPct: number;
  spotRate: number;

  // Base Price
  basePriceBdt: number;

  // Leg 1: US Domestic Marketplace Shipping
  marketplaceShippingUsd: number;
  marketplaceShippingBdt: number;
  isFreeDomesticShipping: boolean;
  marketplaceRuleApplied?: string;

  // Leg 2: International Freight
  actualWeightKg: number;
  extraPackagingWeightKg: number;
  volumetricWeightKg: number;
  chargeableWeightKg: number;
  airRatePerKgUsd: number;
  packagingFeeUsd: number;
  internationalAirFreightUsd: number;
  internationalAirFreightBdt: number;
  shippingMethod: string;

  // Customs & NBR Taxes
  hsCode?: string;
  customsDutyPct: number;
  supplementaryDutyPct: number;
  vatPct: number;
  advanceTaxPct: number;
  totalTaxPct: number;
  customsTaxBdt: number;

  // Profit Margin & Floors
  profitMarginPct: number;
  rawProfitMarginBdt: number;
  minMarginBdt: number;
  profitMarginBdt: number;
  priceFloorBdt: number;

  // Leg 3: Local BD Courier Delivery (Billed separately at checkout)
  localDeliveryZone: string;
  localDeliveryBdt: number;

  // Final Landed Selling Price (Product PDP Price)
  finalSellingPriceBdt: number;

  // Total Estimated Checkout Cost (Product Price + Local Delivery)
  estimatedTotalCheckoutBdt: number;
}

export interface CalculateLandedPriceParams {
  sourcePriceUsd: number;
  sourceCurrency?: string;
  weightKg?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  extraPackagingWeight?: number;
  categoryId?: string;
  categoryName?: string;
  hsCode?: string;
  source?: string;
  hasMembership?: boolean;
  shippingMethod?: string;
  originCountry?: string;
  destinationZone?: string;
  volumetricDivisor?: number;
  minMarginBdt?: number;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Helper: Parse percentage safely without scaling bugs.
   * If val is 0.15, returns 15.0. If val is 15 or 15.0, returns 15.0. If 0, returns 0.
   */
  private parsePct(val: any, defaultPct: number): number {
    if (val === null || val === undefined || val === '') return defaultPct;
    const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.]/g, ''));
    if (isNaN(num)) return defaultPct;
    if (num > 0 && num < 1.0) {
      return parseFloat((num * 100).toFixed(2));
    }
    return parseFloat(num.toFixed(2));
  }

  // ─────────────────────────────────────────────────────────
  // 1. LIVE 3-LEG LANDED PRICE CALCULATOR ENGINE
  // ─────────────────────────────────────────────────────────
  async calculateLandedPrice(params: CalculateLandedPriceParams): Promise<PriceBreakdown> {
    const sourcePriceUsd = Math.max(0, params.sourcePriceUsd || 0);
    const currency = (params.sourceCurrency || 'USD').toUpperCase().trim();
    const source = (params.source || 'amazon').toLowerCase().trim();
    const originCountry = (params.originCountry || 'US').toUpperCase().trim();
    const destZone = params.destinationZone || 'Inside Dhaka';

    // ─── A. CURRENCY EXCHANGE RATE & FOREX BUFFER ───
    let exchangeRate = 139.91;
    let spotRate = 136.50;
    let fxBufferPct = 2.5;

    try {
      const activeRate = await this.prisma.currencyExchangeRate.findUnique({
        where: { sourceCurrency_targetCurrency: { sourceCurrency: currency, targetCurrency: 'BDT' } },
      });
      if (activeRate) {
        spotRate = activeRate.rate;
        fxBufferPct = activeRate.bufferPct ?? 2.5;
        exchangeRate = activeRate.effectiveRate || parseFloat((spotRate * (1 + fxBufferPct / 100)).toFixed(2));
      } else {
        const fallbacks: Record<string, { spot: number; buffer: number }> = {
          USD: { spot: 136.50, buffer: 2.5 },
          GBP: { spot: 175.80, buffer: 3.0 },
          EUR: { spot: 147.20, buffer: 2.5 },
          CAD: { spot: 100.50, buffer: 2.5 },
          CNY: { spot: 18.90, buffer: 3.0 },
          AED: { spot: 37.15, buffer: 2.5 },
          JPY: { spot: 0.92, buffer: 3.0 },
          AUD: { spot: 88.50, buffer: 2.5 },
        };
        const fb = fallbacks[currency] || { spot: 136.50, buffer: 2.5 };
        spotRate = fb.spot;
        fxBufferPct = fb.buffer;
        exchangeRate = parseFloat((spotRate * (1 + fxBufferPct / 100)).toFixed(2));
      }
    } catch (e) {
      this.logger.warn(`Exchange rate fetch failed for ${currency}: ${(e as any)?.message}`);
    }

    const basePriceBdt = sourcePriceUsd * exchangeRate;

    // ─── B. [LEG 1] US DOMESTIC MARKETPLACE SHIPPING ───
    let marketplaceShippingUsd = 5.99;
    let isFreeDomesticShipping = false;
    let marketplaceRuleApplied = 'Standard Shipping ($5.99)';
    const hasMembership = Boolean(params.hasMembership);

    try {
      const mktRule = await this.prisma.marketplaceShippingRule.findFirst({
        where: {
          source: { in: [source, 'all'] },
          countryCode: originCountry,
          isActive: true,
        },
        orderBy: { source: 'desc' },
      });

      if (mktRule) {
        if (hasMembership && mktRule.isFreeWithMembership) {
          marketplaceShippingUsd = 0.0;
          isFreeDomesticShipping = true;
          marketplaceRuleApplied = `Free with ${source.toUpperCase()} Membership / Prime`;
        } else if (mktRule.freeShippingThreshold !== null && sourcePriceUsd >= mktRule.freeShippingThreshold) {
          marketplaceShippingUsd = 0.0;
          isFreeDomesticShipping = true;
          marketplaceRuleApplied = `Free Shipping (Order >= $${mktRule.freeShippingThreshold})`;
        } else {
          marketplaceShippingUsd = mktRule.standardFee;
          marketplaceRuleApplied = `Standard Domestic Fee ($${mktRule.standardFee.toFixed(2)})`;
        }
      } else {
        if (hasMembership) {
          marketplaceShippingUsd = 0.0;
          isFreeDomesticShipping = true;
          marketplaceRuleApplied = 'Free with Prime / Membership';
        } else if (sourcePriceUsd >= 35) {
          marketplaceShippingUsd = 0.0;
          isFreeDomesticShipping = true;
          marketplaceRuleApplied = 'Free Shipping (Order >= $35)';
        } else {
          marketplaceShippingUsd = 5.99;
          marketplaceRuleApplied = 'Standard Domestic Fee ($5.99)';
        }
      }
    } catch (e) {
      this.logger.warn(`Marketplace shipping rule lookup failed: ${(e as any)?.message}`);
    }
    const marketplaceShippingBdt = marketplaceShippingUsd * exchangeRate;

    // ─── C. CATEGORY PRICING RULE LOOKUP ───
    let categoryRule: any = null;
    const catQuery = params.categoryId || params.categoryName;
    if (catQuery) {
      try {
        categoryRule = await this.prisma.pricingRule.findFirst({
          where: {
            OR: [
              { categoryId: catQuery },
              { id: catQuery },
              { categoryName: { equals: catQuery, mode: 'insensitive' } },
              { categoryName: { contains: catQuery, mode: 'insensitive' } },
            ],
          },
        });
      } catch (e) {
        this.logger.warn(`Pricing rule fetch failed: ${(e as any)?.message}`);
      }
    }

    // ─── D. [LEG 2] INTERNATIONAL AIR FREIGHT & VOLUMETRIC CHARGE ───
    const actualWeightKg = Math.max(0.01, params.weightKg || 0.2);
    const extraPackagingWeightKg = Math.max(0, params.extraPackagingWeight || 0.0);
    const grossWeightKg = actualWeightKg + extraPackagingWeightKg;

    const divisor = params.volumetricDivisor || 5000.0;
    let volumetricWeightKg = 0;
    if (
      params.lengthCm &&
      params.widthCm &&
      params.heightCm &&
      params.lengthCm > 0 &&
      params.widthCm > 0 &&
      params.heightCm > 0
    ) {
      volumetricWeightKg = parseFloat(((params.lengthCm * params.widthCm * params.heightCm) / divisor).toFixed(3));
    }

    const chargeableWeightKg = parseFloat(Math.max(grossWeightKg, volumetricWeightKg, 0.05).toFixed(3));

    let airRatePerKgUsd = 12.0;
    let packagingFeeUsd = 0.0;
    let minChargeUsd = 0.0;
    const shippingMethod = params.shippingMethod || categoryRule?.shippingMethod || 'air';

    if (categoryRule?.airFreightPerKgUsd) {
      airRatePerKgUsd = categoryRule.airFreightPerKgUsd;
    }
    if (categoryRule?.packagingFeeUsd !== undefined) {
      packagingFeeUsd = categoryRule.packagingFeeUsd;
    }

    try {
      const catSearch = params.categoryName || categoryRule?.categoryName || 'General';
      const shippingRateRecord = await this.prisma.shippingRate.findFirst({
        where: {
          originCountry,
          destCountry: 'BD',
          shippingMethod,
          isActive: true,
          OR: [
            { category: { equals: catSearch, mode: 'insensitive' } },
            { category: { contains: catSearch, mode: 'insensitive' } },
            { category: 'General Cargo' },
            { category: 'General' },
          ],
        },
        orderBy: [{ category: 'desc' }],
      });

      if (shippingRateRecord) {
        if (!categoryRule?.airFreightPerKgUsd) {
          airRatePerKgUsd = shippingRateRecord.ratePerKg;
        }
        if (shippingRateRecord.minCharge) {
          minChargeUsd = shippingRateRecord.minCharge;
        }
      }
    } catch (e) {
      this.logger.warn(`Shipping rate lookup failed: ${(e as any)?.message}`);
    }

    const rawAirFreightUsd = chargeableWeightKg * airRatePerKgUsd + packagingFeeUsd;
    const internationalAirFreightUsd = minChargeUsd > 0 ? Math.max(rawAirFreightUsd, minChargeUsd) : rawAirFreightUsd;
    const internationalAirFreightBdt = internationalAirFreightUsd * exchangeRate;

    // ─── E. E-COMMERCE RETAIL VAT & TAXES ───
    let customsDutyPct = 0.0;
    let supplementaryDutyPct = 0.0;
    let vatPct = 5.0; // 5% standard e-commerce retail VAT
    let advanceTaxPct = 0.0;
    let totalTaxPct = 5.0;

    if (categoryRule) {
      vatPct = this.parsePct(categoryRule.vatPct, 5.0);
      customsDutyPct = this.parsePct(categoryRule.importDutyPct, 0.0);
      supplementaryDutyPct = this.parsePct(categoryRule.supplementaryDutyPct ?? categoryRule.sdTaxPct, 0.0);
      advanceTaxPct = 0.0;
      totalTaxPct = customsDutyPct + supplementaryDutyPct + vatPct + advanceTaxPct;
    } else if (params.hsCode) {
      try {
        const hsRule = await this.prisma.hsCodeTaxRule.findFirst({
          where: { hsCode: { equals: params.hsCode.trim() } },
        });
        if (hsRule) {
          customsDutyPct = this.parsePct(hsRule.customsDutyPct, 0.0);
          supplementaryDutyPct = this.parsePct(hsRule.supplementaryPct, 0.0);
          vatPct = this.parsePct(hsRule.vatPct, 5.0);
          advanceTaxPct = this.parsePct(hsRule.advanceTaxPct, 0.0);
          totalTaxPct = hsRule.totalTaxPct ? this.parsePct(hsRule.totalTaxPct, 5.0) : (customsDutyPct + supplementaryDutyPct + vatPct + advanceTaxPct);
        }
      } catch (e) {
        this.logger.warn(`HS Code tax lookup failed: ${(e as any)?.message}`);
      }
    }

    const customsTaxBdt = basePriceBdt * (totalTaxPct / 100);

    // ─── F. PROFIT MARGIN & PRICE FLOORS ───
    const profitMarginPct = categoryRule ? this.parsePct(categoryRule.profitMarginPct, 15.0) : 15.0;
    const rawProfitMarginBdt = basePriceBdt * (profitMarginPct / 100);
    const minMarginBdt = params.minMarginBdt ?? (categoryRule?.priceFloor && categoryRule.priceFloor < 500 ? categoryRule.priceFloor : 200);
    const profitMarginBdt = Math.max(rawProfitMarginBdt, minMarginBdt);

    const priceFloorBdt = categoryRule?.priceFloor && categoryRule.priceFloor > 0 ? categoryRule.priceFloor : 0;
    const rawFinalSellingPriceBdt = basePriceBdt + marketplaceShippingBdt + internationalAirFreightBdt + customsTaxBdt + profitMarginBdt;
    const finalSellingPriceBdt = Math.max(Math.round(rawFinalSellingPriceBdt), priceFloorBdt);

    // ─── G. [LEG 3] BANGLADESH LOCAL COURIER DELIVERY ───
    let localDeliveryBdt = 70.0;
    try {
      const localDel = await this.prisma.regionalDeliveryRate.findFirst({
        where: {
          OR: [
            { cityOrZone: { equals: destZone, mode: 'insensitive' } },
            { cityOrZone: { contains: destZone, mode: 'insensitive' } },
          ],
          countryCode: 'BD',
          isActive: true,
        },
      });
      if (localDel?.chargeAmount) localDeliveryBdt = localDel.chargeAmount;
    } catch (e) {
      this.logger.warn(`Local delivery rate fetch failed: ${(e as any)?.message}`);
    }

    const estimatedTotalCheckoutBdt = finalSellingPriceBdt + localDeliveryBdt;

    return {
      sourcePriceUsd,
      sourceCurrency: currency,
      exchangeRate: parseFloat(exchangeRate.toFixed(2)),
      fxBufferPct,
      spotRate,

      basePriceBdt: Math.round(basePriceBdt),

      marketplaceShippingUsd: parseFloat(marketplaceShippingUsd.toFixed(2)),
      marketplaceShippingBdt: Math.round(marketplaceShippingBdt),
      isFreeDomesticShipping,
      marketplaceRuleApplied,

      actualWeightKg,
      extraPackagingWeightKg,
      volumetricWeightKg,
      chargeableWeightKg,
      airRatePerKgUsd,
      packagingFeeUsd,
      internationalAirFreightUsd: parseFloat(internationalAirFreightUsd.toFixed(2)),
      internationalAirFreightBdt: Math.round(internationalAirFreightBdt),
      shippingMethod,

      hsCode: params.hsCode,
      customsDutyPct,
      supplementaryDutyPct,
      vatPct,
      advanceTaxPct,
      totalTaxPct,
      customsTaxBdt: Math.round(customsTaxBdt),

      profitMarginPct,
      rawProfitMarginBdt: Math.round(rawProfitMarginBdt),
      minMarginBdt,
      profitMarginBdt: Math.round(profitMarginBdt),
      priceFloorBdt,

      localDeliveryZone: destZone,
      localDeliveryBdt,

      finalSellingPriceBdt,
      estimatedTotalCheckoutBdt,
    };
  }

  // ─────────────────────────────────────────────────────────
  // 2. SHIPPING RATES (Leg 2: International Freight $/kg)
  // ─────────────────────────────────────────────────────────
  async getShippingRates() {
    return this.prisma.shippingRate.findMany({ orderBy: [{ shippingMethod: 'asc' }, { category: 'asc' }] });
  }

  async upsertShippingRate(data: {
    id?: string;
    category: string;
    originCountry?: string;
    destCountry?: string;
    shippingMethod?: string;
    ratePerKg: number;
    minCharge?: number;
    volumetricDivisor?: number;
    estimatedDaysMin?: number;
    estimatedDaysMax?: number;
    isActive?: boolean;
  }) {
    const payload = {
      category: data.category,
      originCountry: data.originCountry ?? 'US',
      destCountry: data.destCountry ?? 'BD',
      shippingMethod: data.shippingMethod ?? 'air',
      ratePerKg: Number(data.ratePerKg),
      minCharge: Number(data.minCharge ?? 0),
      volumetricDivisor: Number(data.volumetricDivisor ?? 5000),
      estimatedDaysMin: Number(data.estimatedDaysMin ?? 5),
      estimatedDaysMax: Number(data.estimatedDaysMax ?? 10),
      isActive: data.isActive ?? true,
    };

    if (data.id && !data.id.startsWith('sr-')) {
      const existing = await this.prisma.shippingRate.findUnique({ where: { id: data.id } });
      if (existing) {
        return this.prisma.shippingRate.update({ where: { id: data.id }, data: payload });
      }
    }

    const existingMatch = await this.prisma.shippingRate.findFirst({
      where: {
        category: data.category,
        originCountry: payload.originCountry,
        destCountry: payload.destCountry,
        shippingMethod: payload.shippingMethod,
      },
    });

    if (existingMatch) {
      return this.prisma.shippingRate.update({ where: { id: existingMatch.id }, data: payload });
    }

    return this.prisma.shippingRate.create({ data: payload });
  }

  async deleteShippingRate(id: string) {
    const existing = await this.prisma.shippingRate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Shipping rate not found: ${id}`);
    return this.prisma.shippingRate.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────
  // 3. MARKETPLACE SHIPPING RULES (Leg 1: Domestic)
  // ─────────────────────────────────────────────────────────
  async getMarketplaceRules() {
    return this.prisma.marketplaceShippingRule.findMany({ orderBy: { source: 'asc' } });
  }

  async upsertMarketplaceRule(data: {
    id?: string;
    source: string;
    countryCode?: string;
    standardFee: number;
    freeShippingThreshold?: number;
    isFreeWithMembership?: boolean;
    estimatedDaysMin?: number;
    estimatedDaysMax?: number;
    isActive?: boolean;
  }) {
    const payload = {
      source: data.source.toLowerCase().trim(),
      countryCode: data.countryCode ? data.countryCode.toUpperCase() : 'US',
      standardFee: Number(data.standardFee),
      freeShippingThreshold: data.freeShippingThreshold !== undefined ? Number(data.freeShippingThreshold) : 35.0,
      isFreeWithMembership: data.isFreeWithMembership ?? true,
      estimatedDaysMin: Number(data.estimatedDaysMin ?? 2),
      estimatedDaysMax: Number(data.estimatedDaysMax ?? 5),
      isActive: data.isActive ?? true,
    };

    if (data.id && !data.id.startsWith('mr-')) {
      const existing = await this.prisma.marketplaceShippingRule.findUnique({ where: { id: data.id } });
      if (existing) {
        return this.prisma.marketplaceShippingRule.update({ where: { id: data.id }, data: payload });
      }
    }

    return this.prisma.marketplaceShippingRule.upsert({
      where: {
        source_countryCode: {
          source: payload.source,
          countryCode: payload.countryCode,
        },
      },
      update: payload,
      create: payload,
    });
  }

  async deleteMarketplaceRule(id: string) {
    const existing = await this.prisma.marketplaceShippingRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Marketplace rule not found: ${id}`);
    return this.prisma.marketplaceShippingRule.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────
  // 4. REGIONAL DELIVERY RATES (Leg 3: Local BD Courier)
  // ─────────────────────────────────────────────────────────
  async getDeliveryRates() {
    return this.prisma.regionalDeliveryRate.findMany({ orderBy: { chargeAmount: 'asc' } });
  }

  async getLocalCourierZones() {
    // 1. Fetch active couriers
    const activeCarriers = await this.prisma.shippingCarrier.findMany({
      where: { leg: 'LOCAL_BD_COURIER', isActive: true },
    });

    let maxBase = 60;
    let maxOutside = 120;
    let hasPickup = false;

    if (activeCarriers.length > 0) {
      const standardCarriers = activeCarriers.filter(c => c.serviceType !== 'OFFICE_PICKUP' && c.code !== 'office_pickup');
      const bases = standardCarriers.map(c => c.baseDeliveryFeeBdt || 0).filter(v => v > 0);
      const outsides = standardCarriers.map(c => c.outsideDhakaFeeBdt || 0).filter(v => v > 0);
      
      if (bases.length > 0) maxBase = Math.max(...bases);
      if (outsides.length > 0) maxOutside = Math.max(...outsides);
      
      hasPickup = activeCarriers.some(c => c.serviceType === 'OFFICE_PICKUP' || c.code === 'office_pickup');
    }

    const rates = [];
    
    if (hasPickup) {
      rates.push({
        id: 'office_pickup',
        city_or_zone: 'A2Z Office Self-Pickup',
        country_code: 'BD',
        charge_amount: 0,
        estimated_days: '0',
      });
    }

    // Dhaka Division (usually considered as Base/Inside for simplicty, though sometimes outer Dhaka is sub-dhaka)
    rates.push({
      id: 'div_dhaka',
      city_or_zone: 'Dhaka',
      country_code: 'BD',
      charge_amount: maxBase,
      estimated_days: '1-2',
    });

    const outsideDivisions = [
      'Chattogram', 'Rajshahi', 'Khulna', 'Barishal', 'Sylhet', 'Rangpur', 'Mymensingh'
    ];

    for (const div of outsideDivisions) {
      rates.push({
        id: `div_${div.toLowerCase()}`,
        city_or_zone: div,
        country_code: 'BD',
        charge_amount: maxOutside,
        estimated_days: '3-5',
      });
    }

    return { rates };
  }

  async upsertDeliveryRate(data: {
    id?: string;
    cityOrZone: string;
    countryCode?: string;
    chargeAmount: number;
    estimatedDaysMin?: number;
    estimatedDaysMax?: number;
    courierProvider?: string;
    isActive?: boolean;
  }) {
    const payload = {
      cityOrZone: data.cityOrZone.trim(),
      countryCode: data.countryCode ?? 'BD',
      chargeAmount: Number(data.chargeAmount),
      estimatedDaysMin: Number(data.estimatedDaysMin ?? 1),
      estimatedDaysMax: Number(data.estimatedDaysMax ?? 3),
      courierProvider: data.courierProvider ?? 'Pathao / Steadfast',
      isActive: data.isActive ?? true,
    };

    if (data.id && !data.id.startsWith('rr-')) {
      const existing = await this.prisma.regionalDeliveryRate.findUnique({ where: { id: data.id } });
      if (existing) {
        return this.prisma.regionalDeliveryRate.update({ where: { id: data.id }, data: payload });
      }
    }

    const existingByName = await this.prisma.regionalDeliveryRate.findFirst({
      where: { cityOrZone: { equals: data.cityOrZone.trim(), mode: 'insensitive' } },
    });
    if (existingByName) {
      return this.prisma.regionalDeliveryRate.update({
        where: { id: existingByName.id },
        data: payload,
      });
    }

    return this.prisma.regionalDeliveryRate.create({ data: payload });
  }

  async deleteDeliveryRate(id: string) {
    const existing = await this.prisma.regionalDeliveryRate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Delivery rate not found: ${id}`);
    return this.prisma.regionalDeliveryRate.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────
  // 5. CURRENCY EXCHANGE RATES (Forex Buffer & Auto Sync)
  // ─────────────────────────────────────────────────────────
  async getExchangeRates() {
    return this.prisma.currencyExchangeRate.findMany({
      orderBy: { sourceCurrency: 'asc' },
    });
  }

  async upsertExchangeRate(data: {
    sourceCurrency: string;
    targetCurrency: string;
    rate: number;
    bufferPct?: number;
    effectiveRate?: number;
    isAutoSync?: boolean;
  }) {
    const rate = Number(data.rate);
    const bufferPct = data.bufferPct !== undefined ? Number(data.bufferPct) : 2.5;
    const effectiveRate =
      data.effectiveRate !== undefined
        ? Number(data.effectiveRate)
        : parseFloat((rate * (1 + bufferPct / 100)).toFixed(2));

    return this.prisma.currencyExchangeRate.upsert({
      where: {
        sourceCurrency_targetCurrency: {
          sourceCurrency: data.sourceCurrency.toUpperCase().trim(),
          targetCurrency: data.targetCurrency.toUpperCase().trim(),
        },
      },
      update: {
        rate,
        bufferPct,
        effectiveRate,
        isAutoSync: data.isAutoSync ?? true,
      },
      create: {
        sourceCurrency: data.sourceCurrency.toUpperCase().trim(),
        targetCurrency: data.targetCurrency.toUpperCase().trim(),
        rate,
        bufferPct,
        effectiveRate,
        isAutoSync: data.isAutoSync ?? true,
      },
    });
  }

  async updateFxBuffer(bufferPct: number) {
    const rates = await this.prisma.currencyExchangeRate.findMany();
    const updates = rates.map((r) => {
      const effectiveRate = parseFloat((r.rate * (1 + bufferPct / 100)).toFixed(2));
      return this.prisma.currencyExchangeRate.update({
        where: { id: r.id },
        data: { bufferPct, effectiveRate },
      });
    });
    return this.prisma.$transaction(updates);
  }

  // ─────────────────────────────────────────────────────────
  // 6. HS CODE TARIFF / NBR CUSTOMS TAX RULES
  // ─────────────────────────────────────────────────────────
  async getHsCodes(search?: string) {
    const where = search
      ? {
          OR: [
            { hsCode: { contains: search } },
            { categoryName: { contains: search, mode: 'insensitive' as const } },
            { description: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;
    return this.prisma.hsCodeTaxRule.findMany({
      where,
      orderBy: { hsCode: 'asc' },
    });
  }

  async upsertHsCode(data: {
    id?: string;
    hsCode: string;
    categoryName: string;
    customsDutyPct: number;
    supplementaryPct?: number;
    vatPct?: number;
    advanceTaxPct?: number;
    totalTaxPct?: number;
    description?: string;
  }) {
    const cd = Number(data.customsDutyPct || 0);
    const sd = Number(data.supplementaryPct || 0);
    const vat = Number(data.vatPct ?? 15);
    const ait = Number(data.advanceTaxPct ?? 5);
    const totalTaxPct = data.totalTaxPct !== undefined ? Number(data.totalTaxPct) : cd + sd + vat + ait;

    const payload = {
      hsCode: data.hsCode.trim(),
      categoryName: data.categoryName.trim(),
      customsDutyPct: cd,
      supplementaryPct: sd,
      vatPct: vat,
      advanceTaxPct: ait,
      totalTaxPct,
      description: data.description,
    };

    if (data.id && !data.id.startsWith('hs-')) {
      const existing = await this.prisma.hsCodeTaxRule.findUnique({ where: { id: data.id } });
      if (existing) {
        return this.prisma.hsCodeTaxRule.update({ where: { id: data.id }, data: payload });
      }
    }

    const existingByHs = await this.prisma.hsCodeTaxRule.findFirst({ where: { hsCode: data.hsCode.trim() } });
    if (existingByHs) {
      return this.prisma.hsCodeTaxRule.update({ where: { id: existingByHs.id }, data: payload });
    }

    return this.prisma.hsCodeTaxRule.create({ data: payload });
  }

  async deleteHsCode(id: string) {
    const existing = await this.prisma.hsCodeTaxRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`HS Code rule not found: ${id}`);
    return this.prisma.hsCodeTaxRule.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────
  // 7. CATEGORY PRICING RULES (Profit Margin & Duty Rules)
  // ─────────────────────────────────────────────────────────
  async getPricingRules() {
    const rules = await this.prisma.pricingRule.findMany({
      include: { category: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ categoryName: 'asc' }, { updatedAt: 'desc' }],
    });
    return rules.map((r) => ({
      ...r,
      categoryName: r.categoryName || r.category?.name || 'General',
    }));
  }

  async upsertPricingRule(data: {
    id?: string;
    categoryId?: string;
    categoryName?: string;
    profitMarginPct?: number;
    importDutyPct?: number;
    vatPct?: number;
    supplementaryDutyPct?: number;
    airFreightPerKgUsd?: number;
    packagingFeeUsd?: number;
    priceFloor?: number;
    isActive?: boolean;
  }) {
    const payload: any = {
      ...(data.profitMarginPct !== undefined && { profitMarginPct: Number(data.profitMarginPct) }),
      ...(data.importDutyPct !== undefined && { importDutyPct: Number(data.importDutyPct) }),
      ...(data.vatPct !== undefined && { vatPct: Number(data.vatPct) }),
      ...(data.supplementaryDutyPct !== undefined && { supplementaryDutyPct: Number(data.supplementaryDutyPct) }),
      ...(data.airFreightPerKgUsd !== undefined && { airFreightPerKgUsd: Number(data.airFreightPerKgUsd) }),
      ...(data.packagingFeeUsd !== undefined && { packagingFeeUsd: Number(data.packagingFeeUsd) }),
      ...(data.priceFloor !== undefined && { priceFloor: Number(data.priceFloor) }),
      ...(data.categoryName !== undefined && { categoryName: data.categoryName.trim() }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),
    };

    if (data.id && !data.id.startsWith('cat-')) {
      const existing = await this.prisma.pricingRule.findUnique({ where: { id: data.id } });
      if (existing) {
        return this.prisma.pricingRule.update({
          where: { id: data.id },
          data: payload,
        });
      }
    }

    if (data.categoryId) {
      return this.prisma.pricingRule.upsert({
        where: { categoryId: data.categoryId },
        update: payload,
        create: {
          categoryId: data.categoryId,
          categoryName: data.categoryName || 'General',
          profitMarginPct: data.profitMarginPct ?? 15.0,
          importDutyPct: data.importDutyPct ?? 0.0,
          vatPct: data.vatPct ?? 5.0,
          supplementaryDutyPct: data.supplementaryDutyPct ?? 0.0,
          ...payload,
        },
      });
    }

    if (data.categoryName) {
      const existingByName = await this.prisma.pricingRule.findFirst({
        where: { categoryName: { equals: data.categoryName.trim(), mode: 'insensitive' } },
      });
      if (existingByName) {
        return this.prisma.pricingRule.update({
          where: { id: existingByName.id },
          data: payload,
        });
      }
    }

    return this.prisma.pricingRule.create({
      data: {
        categoryName: data.categoryName || 'General',
        profitMarginPct: data.profitMarginPct ?? 15.0,
        importDutyPct: data.importDutyPct ?? 0.0,
        vatPct: data.vatPct ?? 5.0,
        supplementaryDutyPct: data.supplementaryDutyPct ?? 0.0,
        ...payload,
      },
    });
  }

  async deletePricingRule(id: string) {
    const existing = await this.prisma.pricingRule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Pricing rule not found: ${id}`);
    return this.prisma.pricingRule.delete({ where: { id } });
  }

  // ─────────────────────────────────────────────────────────
  // 8. BULK RECALCULATION & CATALOG SYNC
  // ─────────────────────────────────────────────────────────
  async recalculateCategoryPrices(categoryIdentifier: string) {
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { categoryId: categoryIdentifier },
          { category: { name: { equals: categoryIdentifier, mode: 'insensitive' } } },
          { category: { slug: { equals: categoryIdentifier, mode: 'insensitive' } } },
        ],
      },
      include: { category: true },
    });

    let updatedCount = 0;
    for (const p of products) {
      const breakdown = await this.calculateLandedPrice({
        sourcePriceUsd: p.sourcePrice,
        weightKg: p.weightKg || 0.2,
        categoryId: p.categoryId || undefined,
        categoryName: p.category?.name || undefined,
        hsCode: p.hsCode || undefined,
        lengthCm: p.lengthCm || undefined,
        widthCm: p.widthCm || undefined,
        heightCm: p.heightCm || undefined,
        extraPackagingWeight: p.extraPackagingWeight || undefined,
      });

      await this.prisma.product.update({
        where: { id: p.id },
        data: { sellingPrice: breakdown.finalSellingPriceBdt },
      });
      updatedCount++;
    }

    return { success: true, updatedCount, totalFound: products.length };
  }
}


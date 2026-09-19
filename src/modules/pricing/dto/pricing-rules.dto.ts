import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsIn,
  Min,
  Max,
} from 'class-validator';

// ─── Category Pricing Rule ────────────────────────────────────────────────────
export class UpdatePricingRuleDto {
  @IsOptional() @IsNumber() @Min(0) @Max(100) profitMarginPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) importDutyPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) vatPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) supplementaryDutyPct?: number;
  @IsOptional() @IsNumber() @Min(0) airFreightPerKgUsd?: number;
  @IsOptional() @IsNumber() @Min(0) packagingFeeUsd?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ─── Marketplace Shipping Rule ────────────────────────────────────────────────
export class UpsertMarketplaceRuleDto {
  @IsString()
  @IsIn(['amazon', 'walmart', 'ebay', 'sephora', 'target', 'bestbuy', 'nike', 'all'])
  source: string;

  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsNumber() @Min(0) standardFee?: number;
  @IsOptional() @IsNumber() @Min(0) freeShippingThreshold?: number;
  @IsOptional() @IsBoolean() isFreeWithMembership?: boolean;
  @IsOptional() @IsNumber() @Min(1) estimatedDaysMin?: number;
  @IsOptional() @IsNumber() @Min(1) estimatedDaysMax?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ─── International Shipping Rate ─────────────────────────────────────────────
export class UpsertShippingRateDto {
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() originCountry?: string;
  @IsOptional() @IsString() destCountry?: string;
  @IsOptional() @IsString() @IsIn(['air', 'sea', 'express']) shippingMethod?: string;
  @IsOptional() @IsNumber() @Min(0) ratePerKg?: number;
  @IsOptional() @IsNumber() @Min(1) volumetricDivisor?: number;
  @IsOptional() @IsNumber() @Min(1) estimatedDaysMin?: number;
  @IsOptional() @IsNumber() @Min(1) estimatedDaysMax?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ─── Regional Delivery Rate (Leg 3) ──────────────────────────────────────────
export class UpsertDeliveryRateDto {
  @IsOptional() @IsString() cityOrZone?: string;
  @IsOptional() @IsString() countryCode?: string;
  @IsOptional() @IsNumber() @Min(0) chargeAmount?: number;
  @IsOptional() @IsNumber() @Min(1) estimatedDaysMin?: number;
  @IsOptional() @IsNumber() @Min(1) estimatedDaysMax?: number;
  @IsOptional() @IsString() courierProvider?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ─── Currency Exchange Rate ───────────────────────────────────────────────────
export class UpsertExchangeRateDto {
  @IsString() sourceCurrency: string;
  @IsString() targetCurrency: string;
  @IsNumber() @Min(0) rate: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) bufferPct?: number;
  @IsOptional() @IsNumber() @Min(0) effectiveRate?: number;
  @IsOptional() @IsBoolean() isAutoSync?: boolean;
}

export class UpdateFxBufferDto {
  @IsNumber() @Min(0) @Max(100) bufferPct: number;
}

// ─── HS Code Tax Rule ─────────────────────────────────────────────────────────
export class UpsertHsCodeDto {
  @IsString() hsCode: string;
  @IsString() categoryName: string;
  @IsNumber() @Min(0) @Max(100) customsDutyPct: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) supplementaryPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) vatPct?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) advanceTaxPct?: number;
  @IsOptional() @IsString() description?: string;
}

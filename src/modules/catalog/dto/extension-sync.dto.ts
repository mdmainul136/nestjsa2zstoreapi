import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class VariationItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  asin?: string;

  @IsOptional()
  @IsString()
  variant_asin?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  sku?: string;

  @IsOptional()
  price?: string | number;

  @IsOptional()
  sourcePrice?: number | string;

  @IsOptional()
  source_price?: number | string;

  @IsOptional()
  price_per_unit?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  swatch?: string;

  @IsOptional()
  weightKg?: number | string;

  @IsOptional()
  weight_kg?: number | string;

  @IsOptional()
  weight?: number | string;

  @IsOptional()
  in_stock?: boolean | string | number;

  @IsOptional()
  inStock?: boolean | string | number;

  @IsOptional()
  @IsString()
  availability?: string;

  @IsOptional()
  selected?: boolean;

  @IsOptional()
  @IsString()
  weight_unit?: string;

  @IsOptional()
  @IsString()
  weightUnit?: string;

  @IsOptional()
  is_weight_estimated?: boolean;

  @IsOptional()
  isWeightEstimated?: boolean;
}

export class ProductSpecDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  value?: string;
}

export class ExtensionSyncDto {
  @IsOptional()
  @IsString()
  asin?: string;

  @IsOptional()
  @IsString()
  product_id?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  variant_asin?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  subcategory?: string;

  @IsOptional()
  @IsString()
  subSubcategory?: string;

  @IsOptional()
  @IsArray()
  features?: string[];

  @IsOptional()
  seo?: any;

  @IsOptional()
  price?: string | number;

  @IsOptional()
  source_price?: number | string;

  @IsOptional()
  sourcePrice?: number | string;

  @IsOptional()
  selling_price?: number | string;

  @IsOptional()
  sellingPrice?: number | string;

  @IsOptional()
  discount_price?: number | string;

  @IsOptional()
  original_price?: string | number;

  @IsOptional()
  discount?: string | number;

  @IsOptional()
  currency?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) return [value.trim()];
    return [];
  })
  badge?: string[];

  @IsOptional()
  deal_badge?: string;

  @IsOptional()
  dealBadge?: string;

  @IsOptional()
  badgeText?: string;

  @IsOptional()
  badge_text?: string;

  @IsOptional()
  top_reviews?: any[];

  @IsOptional()
  topReviews?: any[];

  @IsOptional()
  price_raw?: string;

  @IsOptional()
  priceRaw?: string;

  @IsOptional()
  price_parsed?: number | string;

  @IsOptional()
  priceParsed?: number | string;

  @IsOptional()
  bought_past_month?: string;

  @IsOptional()
  sales_volume?: string;

  @IsOptional()
  weight_kg?: number | string;

  @IsOptional()
  weightKg?: number | string;

  @IsOptional()
  weight?: number | string;

  @IsOptional()
  weight_unit?: string;

  @IsOptional()
  weightUnit?: string;

  @IsOptional()
  length?: number | string;

  @IsOptional()
  width?: number | string;

  @IsOptional()
  height?: number | string;

  @IsOptional()
  dimensions_unit?: string;

  @IsOptional()
  dimensionsUnit?: string;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  image?: string;

  @IsOptional()
  description?: string;

  @IsOptional()
  product_specs?: any[];

  @IsOptional()
  specs?: any[];

  @IsOptional()
  specifications?: any;

  @IsOptional()
  price_per_unit?: string;

  @IsOptional()
  pricePerUnit?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VariationItemDto)
  variations?: VariationItemDto[];

  @IsOptional()
  availability?: string;

  @IsOptional()
  in_stock?: boolean | string | number;

  @IsOptional()
  inStock?: boolean | string | number;

  @IsOptional()
  seller_name?: string;

  @IsOptional()
  sellerName?: string;

  @IsOptional()
  status?: string; // 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

  @IsOptional()
  rating?: number | string;

  @IsOptional()
  review_count?: number | string;

  @IsOptional()
  slug?: string;

  @IsOptional()
  imageUrl?: string;

  @IsOptional()
  lengthCm?: number | string;

  @IsOptional()
  widthCm?: number | string;

  @IsOptional()
  heightCm?: number | string;

  @IsOptional()
  hsCode?: string;

  @IsOptional()
  originCountry?: string;

  @IsOptional()
  warranty?: string;

  @IsOptional()
  returnPolicy?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  isFeatured?: boolean;

  @IsOptional()
  barcode?: string;

  @IsOptional()
  ships_from?: string;

  @IsOptional()
  shipsFrom?: string;

  @IsOptional()
  delivery_message?: string;

  @IsOptional()
  deliveryMessage?: string;

  @IsOptional()
  ingredients?: string;

  @IsOptional()
  extraPackagingWeight?: number | string;

  @IsOptional()
  extra_packaging_weight?: number | string;

  @IsOptional()
  sync_mode?: string;

  @IsOptional()
  syncMode?: string;

  @IsOptional()
  lightweight_patched?: boolean;

  @IsOptional()
  competitor_matches?: any[];

  @IsOptional()
  competitors?: any[];

  @IsOptional()
  competitorSearch?: boolean;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsArray()
  videos?: any[];

  @IsOptional()
  @IsArray()
  highlights?: any[];

  @IsOptional()
  @IsString()
  return_policy?: string;

  @IsOptional()
  is_weight_estimated?: boolean;

  @IsOptional()
  isWeightEstimated?: boolean;

  @IsOptional()
  @IsArray()
  grouped_variations?: any[];

  @IsOptional()
  @IsArray()
  groupedVariations?: any[];
}

import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchSuggestDto {
  @IsString()
  q!: string;

  @IsOptional()
  @IsIn(['all', 'sku', 'asin', 'brand', 'title'])
  target?: 'all' | 'sku' | 'asin' | 'brand' | 'title' = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 6;
}

export class ProductSearchDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(['all', 'sku', 'asin', 'brand', 'title'])
  target?: 'all' | 'sku' | 'asin' | 'brand' | 'title' = 'all';

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  inStock?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maxPrice?: number;

  @IsOptional()
  @IsString()
  sort?: string; // 'price_low' | 'price_high' | 'newest' | 'popular'

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}

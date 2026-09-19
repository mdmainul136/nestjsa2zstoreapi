import {
  IsString,
  IsUrl,
  IsOptional,
  IsNumber,
  IsPositive,
  IsIn,
  Min,
} from 'class-validator';

// ─── Add Tracker DTO ───────────────────────────────────────────────────────────
export class AddTrackerDto {
  @IsString()
  productTitle: string;

  @IsString()
  @IsIn(['amazon', 'walmart', 'ebay', 'sephora', 'nike', 'target'])
  source: string;

  @IsUrl()
  productUrl: string;

  @IsNumber()
  @IsPositive()
  currentPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAlertPrice?: number;
}

// ─── Update Tracker DTO ────────────────────────────────────────────────────────
export class UpdateTrackerDto {
  @IsOptional()
  @IsString()
  productTitle?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  currentPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetAlertPrice?: number;

  @IsOptional()
  @IsString()
  availability?: string;
}

// ─── Manual Price Check DTO ───────────────────────────────────────────────────
export class ManualPriceCheckDto {
  @IsUrl()
  productUrl: string;

  @IsString()
  @IsIn(['amazon', 'walmart', 'ebay', 'sephora', 'nike', 'target'])
  source: string;
}

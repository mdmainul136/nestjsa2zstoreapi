import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';

export class GenerateApiKeyDto {
  @ApiPropertyOptional({
    description: 'API চাবির নাম বা উদ্দেশ্য',
    example: 'Chrome Extension Key',
    default: 'Chrome Extension Key',
  })
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({
    description: 'অনুমোদিত পারমিশন স্কোপ (string or string[])',
    example: 'catalog:sync',
    default: 'catalog:sync',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value.join(',');
    if (typeof value === 'string') return value.trim();
    return 'catalog:sync';
  })
  scopes?: any;
}

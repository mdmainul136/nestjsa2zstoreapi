import { IsOptional, IsString, IsInt, Min, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ExtensionTaskFilterDto {

    @ApiPropertyOptional({
        type: 'string',
        example: 'sk_live_abc123',
        description: 'API Key',
    })
    @IsOptional()
    @IsString()
    'x-api-key'?: string;

    @ApiPropertyOptional({
        example: "all",
        description: "all, draft, published, archived"
    })
    @IsOptional()
    @IsString()
    status?: string;

    @ApiPropertyOptional({
        type: 'boolean',
        example: true,
        description: 'স্টক ফিল্টার: true দিলে ইন-স্টক (stock > 0), false দিলে স্টক-আউট (stock <= 0)'
    })
    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true' || value === true || value === 1 || value === '1') return true;
        if (value === 'false' || value === false || value === 0 || value === '0') return false;
        return undefined;
    })
    @IsBoolean()
    inStock?: boolean;

    @ApiPropertyOptional({ example: 'amazon', description: 'সোর্স মার্কেটপ্লেস (amazon, walmart, sephora)' })
    @IsOptional()
    @IsString()
    source?: string;

    @ApiPropertyOptional({ example: 'Apple', description: 'ব্র্যান্ডের নাম বা আইডি' })
    @IsOptional()
    @IsString()
    brand?: string;

    @ApiPropertyOptional({ example: 'smartphones', description: 'ক্যাটাগরির স্লাগ বা নাম' })
    @IsOptional()
    @IsString()
    category?: string;

    @ApiPropertyOptional({ example: 7, description: 'কতদিন আগের পুরোনো স্ক্র্যাপ হওয়া ডেটা চান (e.g. 7 days)' })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    lastScrapedDays?: number;

    @ApiPropertyOptional({ example: 250, default: 250 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number = 250;
}

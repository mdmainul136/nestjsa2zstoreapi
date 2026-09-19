import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
} from 'class-validator';

export class ValidateCouponDto {
  @IsNotEmpty({ message: 'কুপন কোড প্রদান করুন' })
  @IsString()
  code: string;

  @IsNotEmpty({ message: 'কার্ট সাবটোটাল আবশ্যক' })
  @IsNumber()
  cartTotal: number;

  @IsOptional()
  @IsArray()
  productIds?: string[];
}

export class AbandonedCartDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsNotEmpty()
  cartData: any;

  @IsNotEmpty()
  @IsNumber()
  totalAmount: number;
}

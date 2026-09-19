import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderItemDto {
  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsNotEmpty()
  quantity: number;
}

export class CreateOrderDto {
  @IsNotEmpty({ message: 'কাস্টমারের নাম আবশ্যক' })
  @IsString()
  customerName: string;

  @IsNotEmpty({ message: 'ইমেইল আবশ্যক' })
  @IsString()
  customerEmail: string;

  @IsNotEmpty({ message: 'মোবাইল নম্বর আবশ্যক' })
  @IsString()
  customerPhone: string;

  @IsNotEmpty({ message: 'শহর আবশ্যক' })
  @IsString()
  shippingCity: string;

  @IsNotEmpty({ message: 'সম্পূর্ণ ঠিকানা আবশ্যক' })
  shippingAddress: {
    street: string;
    house?: string;
    area?: string;
    postalCode?: string;
  };

  @IsOptional()
  @IsString()
  paymentMethod?: string; // bkash, nagad, stripe, cod

  @IsOptional()
  @IsString()
  couponCode?: string; // ডিসকাউন্ট কুপন

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

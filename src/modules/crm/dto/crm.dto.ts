import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsArray,
} from 'class-validator';

export class CreateTicketDto {
  @IsNotEmpty({ message: 'বিষয় নির্বাচন করুন' })
  @IsString()
  subject: string;

  @IsNotEmpty({ message: 'আপনার মেসেজ লিখুন' })
  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
}

export class ReplyTicketDto {
  @IsNotEmpty({ message: 'মেসেজ আবশ্যক' })
  @IsString()
  message: string;
}

export class RequestRefundDto {
  @IsNotEmpty({ message: 'অর্ডার আইডি আবশ্যক' })
  @IsString()
  orderId: string;

  @IsNotEmpty({ message: 'রিফান্ডের কারণ আবশ্যক' })
  @IsString()
  reason: string;

  @IsNotEmpty({ message: 'টাকার পরিমাণ আবশ্যক' })
  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  refundMethod?: 'WALLET' | 'ORIGINAL_PAYMENT' | 'BKASH';
}

export class CreateResaleListingDto {
  @IsNotEmpty({ message: 'অর্ডার আইটেম আইডি আবশ্যক' })
  @IsString()
  orderItemId: string;

  @IsNotEmpty({ message: 'প্রোডাক্টের অবস্থা (যেমন: New, Like New, Open Box)' })
  @IsString()
  condition: string;

  @IsNotEmpty({ message: 'বিক্রয়মূল্য নির্ধারণ করুন' })
  @IsNumber()
  resalePrice: number;

  @IsOptional()
  @IsString()
  reasonForSelling?: string; // e.g. "Size doesn't fit"

  @IsOptional()
  @IsArray()
  photos?: string[]; // বর্তমান পণ্যের আসল ছবি
}

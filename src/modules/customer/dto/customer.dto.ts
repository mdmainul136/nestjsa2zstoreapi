import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsArray,
  IsEmail,
} from 'class-validator';

export class CreateReviewDto {
  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsNotEmpty()
  @IsString()
  customerName: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsArray()
  photoUrls?: string[];
}

export class CreateProductRequestDto {
  @IsNotEmpty({ message: 'আমাজন/শেফোরার লিংক প্রদান করুন' })
  @IsString()
  productUrl: string;

  @IsNotEmpty({ message: 'আপনার নাম আবশ্যক' })
  @IsString()
  customerName: string;

  @IsNotEmpty({ message: 'ইমেইল আবশ্যক' })
  @IsEmail()
  customerEmail: string;

  @IsNotEmpty({ message: 'মোবাইল নম্বর আবশ্যক' })
  @IsString()
  customerPhone: string;

  @IsOptional()
  @IsString()
  productTitle?: string;

  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  notes?: string; // সাইজ, কালার বা স্পেশাল নির্দেশনা
}

export class AskQuestionDto {
  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsNotEmpty()
  @IsString()
  customerName: string;

  @IsNotEmpty({ message: 'প্রশ্ন লিখুন' })
  @IsString()
  question: string;
}

export class ContactMessageDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsNotEmpty()
  @IsString()
  message: string;
}

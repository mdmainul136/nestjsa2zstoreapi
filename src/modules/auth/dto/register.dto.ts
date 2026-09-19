import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
export class RegisterDto {

  @ApiProperty({
    example: 'customer@gmail.com',
    description: 'users active email address',
  })

  @Transform(({ value }) => value?.toLowerCase().trim())
  @IsEmail({}, { message: 'Please enter a valid email address' })
  email: string;

  @ApiProperty({
    example: '123456',
    description: 'Users password',
    minimum: 6,
    maximum: 32,
    required: true,
  })



  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @ApiProperty({
    example: 'John Doe',
    description: 'Users full name',
    required: true,
  })
  @IsNotEmpty({ message: 'Name is required' })
  @IsString()
  name: string;

  @ApiProperty({
    example: '01712345678',
    description: 'Users phone number',
    required: true,
  })
  @IsOptional()
  @Matches(/^01[3-9]\d{8}$/, {
    message: 'Please enter a valid phone number',
  })
  @IsString()
  phone?: string;

  @ApiProperty({
    example: 'A2Z-123',
    description: 'Users referral code',

  })
  @IsOptional()
  @IsString()
  referralCode?: string;
}


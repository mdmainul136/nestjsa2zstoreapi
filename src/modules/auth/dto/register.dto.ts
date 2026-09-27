import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
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
    required: false,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ example: 'John', required: false })
  @IsOptional()
  @IsString()
  first_name?: string;

  @ApiProperty({ example: 'Doe', required: false })
  @IsOptional()
  @IsString()
  last_name?: string;

  @ApiProperty({ example: 'John', required: false })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({ example: 'Doe', required: false })
  @IsOptional()
  @IsString()
  lastName?: string;

  @ApiProperty({
    example: '01712345678',
    description: 'Users phone number',
    required: false,
  })
  @IsOptional()
  @ValidateIf((o) => !!o.phone && o.phone.trim() !== '')
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



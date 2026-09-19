import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
    @ApiProperty({ example: 'reset_token_hex_string_here' })
    @IsNotEmpty({ message: 'Reset token is required' })
    @IsString()
    token: string;

    @ApiProperty({ example: 'NewPassword123' })
    @IsNotEmpty({ message: 'New password is required' })
    @IsString()
    @MinLength(6, { message: 'Password must be at least 6 characters long' })
    newPassword: string;
}

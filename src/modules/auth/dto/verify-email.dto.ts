import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
    @IsNotEmpty({ message: 'Your email verification token is expired or invalid. Please try again.' })
    @IsString()
    token: string;
}
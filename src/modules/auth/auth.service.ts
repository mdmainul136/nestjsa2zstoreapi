import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  NotFoundException,

} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as crypto from 'crypto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) { }

  /**
   * ১. customer registration
   */
  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictException('email already exists');
    }
    // referral code validity check
    let affiliateId: string | null = null;
    if (dto.referralCode) {
      const affiliate = await this.prisma.affiliateProfile.findUnique({
        where: { referralCode: dto.referralCode },
      });
      if (!affiliate) {
        throw new BadRequestException('referral code is not valid');
      }
      affiliateId = affiliate.id;
    }
    const verificationToken = Math.floor(100000 + Math.random() * 900000).toString();

    // password hash 
    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // user create with wallet 
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        password: hashedPassword,
        name: dto.name,
        phone: dto.phone,
        referredByCode: dto.referralCode ?? null,
        verificationToken,
        verificationExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        role: 'CUSTOMER',
        isAdmin: false,
        wallet: {
          create: {
            balance: 0.0,
            currency: 'BDT',
          },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        createdAt: true,
      },
    });

    // referral successful affiliate update
    if (affiliateId) {
      await this.prisma.affiliateProfile.update({
        where: { id: affiliateId },
        data: { totalReferrals: { increment: 1 } },
      });
    }
    // jwt token generation
    const token = this.generateToken(user.id, user.email, user.role);

    // Dispatch live auth verification email with 6-digit OTP
    this.mailService
      .sendAuthVerificationEmail(user.email, user.name || 'Valued Customer', verificationToken)
      .catch((err) => console.warn('[AUTH MAIL] Error sending registration verification email:', err?.message));

    return {
      success: true,
      message: 'Registration successful! A 6-digit verification code has been sent to your email.',
      token,
      user,
      ...(process.env.NODE_ENV !== 'production' && { verificationToken }),
    };
  }

  /**
   * ২. user login 
   */
  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (!user) {
      throw new UnauthorizedException('email or password is not valid');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('email or password is not valid');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('your account is currently closed');
    }
    if (!user.isVerified) {
      throw new UnauthorizedException('your account is not verified');
    }

    const token = this.generateToken(user.id, user.email, user.role);

    return {
      success: true,
      message: 'login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        isAdmin: user.isAdmin,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  /**
   * ৩. GET /auth/me
   */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        isAdmin: true,
        isVerified: true,
        isActive: true,
        referralCode: true,
        createdAt: true,
        wallet: true,
        addresses: true,
        notifications: {
          where: { isRead: false },
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('user not found');
    }


    return user;
  }

  private generateToken(userId: string, email: string, role: string): string {
    const payload = { sub: userId, email, role };
    return this.jwtService.sign(payload, { expiresIn: '7d' });
  }
  /**
   * ৪. email verification (POST /auth/verify-email)
   */
  async verifyEmail(dto: VerifyEmailDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        verificationToken: dto.token,
        verificationExpiresAt: { gt: new Date() },
      },
    });

    if (!user) {
      throw new BadRequestException('Verification token is invalid or has expired');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationToken: null,
        verificationExpiresAt: null,
      },
    });

    // Send Welcome Email
    this.mailService
      .sendMail({
        to: user.email,
        templateCode: 'WELCOME_DISCOUNT',
        variables: {
          customerName: user.name || 'Customer',
          couponCode: 'WELCOME500',
          shopUrl: 'https://a2zoutletstore.com',
        },
      })
      .catch((err) => console.warn('[WELCOME MAIL] Error:', err?.message));

    return {
      success: true,
      message: 'Email successfully verified! Welcome to A2Z Outlet Store.',
    };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase().trim(),
        verificationToken: dto.otp,
        verificationExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      throw new BadRequestException('Verification token is invalid or has expired');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isVerified: true,
        verificationToken: null,
        verificationExpiresAt: null,
      },
    });

    // Send Welcome Email
    this.mailService
      .sendMail({
        to: user.email,
        templateCode: 'WELCOME_DISCOUNT',
        variables: {
          customerName: user.name || 'Customer',
          couponCode: 'WELCOME500',
          shopUrl: 'https://a2zoutletstore.com',
        },
      })
      .catch((err) => console.warn('[WELCOME MAIL] Error:', err?.message));

    const token = this.generateToken(user.id, user.email, user.role);
    return {
      success: true,
      message: 'OTP verified successfully! Your account is now active.',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        isAdmin: user.isAdmin,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email.toLowerCase().trim(),
      },
    });
    if (!user) {
      throw new BadRequestException('this email was not found');
    }
    if (user.isVerified) {
      throw new BadRequestException('account is already verified');
    }
    if (user.verificationExpiresAt) {
      const timeRemaining = user.verificationExpiresAt.getTime() - new Date().getTime();
      if (timeRemaining > 3 * 60 * 1000) {
        throw new BadRequestException('already resend verification code, please wait a few minutes');
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const verificationExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verificationToken: otp,
        verificationExpiresAt: verificationExpiresAt,
      },
    });

    // Dispatch verification email
    this.mailService
      .sendAuthVerificationEmail(user.email, user.name || 'Valued Customer', otp)
      .catch((err) => console.warn('[AUTH MAIL] Error resending verification code:', err?.message));

    return {
      success: true,
      message: 'A new 6-digit verification code has been sent to your email.',
      ...(process.env.NODE_ENV !== 'production' && { otp }),
    };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (!user) {
      return {
        success: true,
        message: 'If your email is registered, a password reset link has been sent',
      };
    }
    if (!user.isVerified) {
      throw new BadRequestException('your account is not verified');
    }
    if (!user.isActive) {
      throw new BadRequestException('your account is currently closed');
    }
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: resetToken,
        passwordResetExpiresAt: resetExpiresAt,
      },
    });

    // Dispatch password reset email
    this.mailService
      .sendPasswordResetEmail(user.email, user.name || 'Valued Customer', resetToken)
      .catch((err) => console.warn('[AUTH MAIL] Error sending password reset email:', err?.message));

    return {
      success: true,
      message: 'Password reset link sent to your email successfully.',
      ...(process.env.NODE_ENV !== 'production' && { resetToken }),
    };
  }

  /**
   * 8.ResetPassword
   */
  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        passwordResetToken: dto.token,
        passwordResetExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      throw new BadRequestException('Password reset token is invalid or has expired');

    }
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetExpiresAt: null,
      },
    });
    return {
      success: true,
      message: 'Password reset successfully',
    };
  }

  /**
   * ৯. প্রোফাইল আপডেট (নাম, ফোন, অবতার)
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('ইউজার পাওয়া যায়নি');
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.phone !== undefined && { phone: dto.phone.trim() }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl.trim() }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        role: true,
        isAdmin: true,
        isVerified: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      message: 'প্রোফাইল তথ্য সফলভাবে আপডেট করা হয়েছে।',
      user: updatedUser,
    };
  }

  /**
   * ১০. পাসওয়ার্ড পরিবর্তন
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('ইউজার পাওয়া যায়নি');
    }

    if (user.password) {
      if (!dto.currentPassword) {
        throw new BadRequestException('বর্তমান পাসওয়ার্ডটি প্রদান করুন।');
      }
      const isMatch = await bcrypt.compare(dto.currentPassword, user.password);
      if (!isMatch) {
        throw new BadRequestException('বর্তমান পাসওয়ার্ডটি সঠিক নয়।');
      }
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
      },
    });

    return {
      success: true,
      message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।',
    };
  }
}

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import {
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let jwtService: any;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    affiliateProfile: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock_jwt_token_xyz'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get(PrismaService);
    jwtService = module.get(JwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────
  // ১. REGISTER METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  describe('register', () => {
    const registerDto = {
      email: 'customer@example.com',
      password: 'password123',
      name: 'Rahim Ahmed',
      phone: '01712345678',
    };

    it('should register a new user successfully without referral', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        name: 'Rahim Ahmed',
        phone: '01712345678',
        role: 'CUSTOMER',
        createdAt: new Date(),
      });

      const result = await service.register(registerDto);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'customer@example.com' },
      });
      expect(prisma.user.create).toHaveBeenCalled();
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: 'user-uuid-1',
        email: 'customer@example.com',
        role: 'CUSTOMER',
      },
        { expiresIn: '7d' }
      );
      expect(result.success).toBe(true);
      expect(result.token).toBe('mock_jwt_token_xyz');
      expect(result.user.email).toBe('customer@example.com');
    });

    it('should throw ConflictException if email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(service.register(registerDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('should validate and process referral code if provided', async () => {
      const dtoWithReferral = {
        ...registerDto,
        referralCode: 'AFF123',
      };

      prisma.user.findUnique.mockResolvedValue(null);
      prisma.affiliateProfile.findUnique.mockResolvedValue({
        id: 'affiliate-uuid-1',
        referralCode: 'AFF123',
      });
      prisma.user.create.mockResolvedValue({
        id: 'user-uuid-2',
        email: 'customer@example.com',
        name: 'Rahim Ahmed',
        role: 'CUSTOMER',
      });
      prisma.affiliateProfile.update.mockResolvedValue({});

      const result = await service.register(dtoWithReferral);

      expect(prisma.affiliateProfile.findUnique).toHaveBeenCalledWith({
        where: { referralCode: 'AFF123' },
      });
      expect(prisma.affiliateProfile.update).toHaveBeenCalledWith({
        where: { id: 'affiliate-uuid-1' },
        data: { totalReferrals: { increment: 1 } },
      });
      expect(result.success).toBe(true);
    });

    it('should throw BadRequestException if referral code is invalid', async () => {
      const dtoWithBadReferral = {
        ...registerDto,
        referralCode: 'INVALID_CODE',
      };

      prisma.user.findUnique.mockResolvedValue(null);
      prisma.affiliateProfile.findUnique.mockResolvedValue(null);

      await expect(service.register(dtoWithBadReferral)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ২. LOGIN METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  describe('login', () => {
    let hashedPassword = '';

    beforeEach(async () => {
      hashedPassword = await bcrypt.hash('password123', 10);
    });

    it('should successfully login and return JWT token', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        password: hashedPassword,
        name: 'Rahim Ahmed',
        phone: '01712345678',
        role: 'CUSTOMER',
        isVerified: true,
        isAdmin: false,
        isActive: true,
        avatarUrl: null,
      });

      const result = await service.login({
        email: 'customer@example.com',
        password: 'password123',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'customer@example.com' },
      });
      expect(result.success).toBe(true);
      expect(result.token).toBe('mock_jwt_token_xyz');
      expect(result.user.id).toBe('user-uuid-1');
    });

    it('should throw UnauthorizedException if user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({
          email: 'unknown@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if password does not match', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        password: hashedPassword,
        isActive: true,
      });

      await expect(
        service.login({
          email: 'customer@example.com',
          password: 'wrong_password_999',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if account is inactive (isActive = false)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        password: hashedPassword,
        isVerified: false,
        isActive: false, // ব্লক করা একাউন্ট
      });

      await expect(
        service.login({
          email: 'customer@example.com',
          password: 'password123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ৩. GET ME METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  describe('getMe', () => {
    it('should return user profile without password', async () => {
      const mockFullUser = {
        id: 'user-uuid-1',
        email: 'customer@example.com',
        name: 'Rahim Ahmed',
        wallet: { balance: 500, currency: 'BDT' },
        addresses: [],
        notifications: [],
      };

      prisma.user.findUnique.mockResolvedValue(mockFullUser);

      const result = await service.getMe('user-uuid-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid-1' },
          select: expect.any(Object),
        }),
      );
      expect(result.id).toBe('user-uuid-1');
      expect(result.name).toBe('Rahim Ahmed');
      expect((result as any).password).toBeUndefined();
    });

    it('should throw NotFoundException if user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.getMe('non-existing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ৪. VERIFY EMAIL METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  // ৪. VERIFY EMAIL METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  describe('verifyEmail', () => {
    it('should verify email successfully when token is valid and not expired', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        verificationToken: 'valid_token_123',
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.verifyEmail({ token: 'valid_token_123' });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          verificationToken: 'valid_token_123',
          verificationExpiresAt: { gt: expect.any(Date) },
        },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: {
          isVerified: true,
          verificationToken: null,
          verificationExpiresAt: null,
        },
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Email successfully verified!');
    });

    it('should throw BadRequestException if token is invalid or expired', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyEmail({ token: 'expired_or_invalid_token' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ৫. VERIFY OTP METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  describe('verifyOtp', () => {
    it('should verify OTP successfully and return JWT token', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        name: 'Rahim Ahmed',
        phone: '01711223344',
        role: 'CUSTOMER',
        isAdmin: false,
        avatarUrl: null,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.verifyOtp({
        email: 'customer@example.com',
        otp: '123456',
      });

      expect(result.success).toBe(true);
      expect(result.token).toBe('mock_jwt_token_xyz');
      expect(result.user.email).toBe('customer@example.com');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: {
          isVerified: true,
          verificationToken: null,
          verificationExpiresAt: null,
        },
      });
    });

    it('should throw BadRequestException if OTP is invalid or expired', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.verifyOtp({ email: 'customer@example.com', otp: '999999' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ৬. RESEND OTP METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  describe('resendOtp', () => {
    it('should resend OTP when cooldown is respected and user is unverified', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        isVerified: false,
        // Expiry was 5 minutes from then, now remaining <= 3 mins (e.g. 2 mins remaining)
        verificationExpiresAt: new Date(Date.now() + 2 * 60 * 1000),
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.resendOtp({ email: 'customer@example.com' });

      expect(result.success).toBe(true);
      expect(result.message).toBe('otp resent successfully');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid-1' },
          data: expect.objectContaining({
            verificationToken: expect.any(String),
            verificationExpiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should throw BadRequestException if user is already verified', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        isVerified: true,
      });

      await expect(
        service.resendOtp({ email: 'customer@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if user resends too quickly (cooldown violation)', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        isVerified: false,
        // 4.5 minutes remaining (greater than 3 min cooldown window)
        verificationExpiresAt: new Date(Date.now() + 4.5 * 60 * 1000),
      });

      await expect(
        service.resendOtp({ email: 'customer@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ৭. FORGOT PASSWORD METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  describe('forgotPassword', () => {
    it('should generate reset token for active and verified user', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        isVerified: true,
        isActive: true,
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.forgotPassword({
        email: 'customer@example.com',
      });

      expect(result.success).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-uuid-1' },
          data: expect.objectContaining({
            passwordResetToken: expect.any(String),
            passwordResetExpiresAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should return generic success message without leaking when email does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword({
        email: 'unknown@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain('password reset link has been sent');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if account is not verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
        isVerified: false,
        isActive: true,
      });

      await expect(
        service.forgotPassword({ email: 'customer@example.com' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // ৮. RESET PASSWORD METHOD TESTS
  // ─────────────────────────────────────────────────────────────
  describe('resetPassword', () => {
    it('should reset password with valid token and clear reset tokens', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'customer@example.com',
      });
      prisma.user.update.mockResolvedValue({});

      const result = await service.resetPassword({
        token: 'valid_reset_token',
        newPassword: 'newPassword123!',
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Password reset successfully');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid-1' },
        data: expect.objectContaining({
          password: expect.any(String),
          passwordResetToken: null,
          passwordResetExpiresAt: null,
        }),
      });
    });

    it('should throw BadRequestException if reset token is invalid or expired', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'invalid_or_expired_token',
          newPassword: 'newPassword123!',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});


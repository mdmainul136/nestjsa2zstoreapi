import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidateCouponDto, AbandonedCartDto } from './dto/marketing.dto';

@Injectable()
export class MarketingService {
  constructor(private readonly prisma: PrismaService) {}


  /**
   * ১. প্রোমো কুপন যাচাই ও ডিসকাউন্ট হিসাব করা
   */
  async validateCoupon(dto: ValidateCouponDto, userId?: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: dto.code.toUpperCase().trim() },
      include: { usages: true },
    });

    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('অবৈধ অথবা অকার্যকর কুপন কোড');
    }

    const c = coupon as any;
    const now = new Date();

    // মেয়াদ চেক (expiresAt অথবা endDate)
    const expiryDate = c.expiresAt || c.endDate;
    if (expiryDate && new Date(expiryDate) < now) {
      throw new BadRequestException('এই কুপনটির মেয়াদ শেষ হয়ে গেছে');
    }


    const startDate = c.startDate || c.startsAt;
    if (startDate && new Date(startDate) > now) {
      throw new BadRequestException('এই কুপনটির মেয়াদ এখনো শুরু হয়নি');
    }

    // নূন্যতম কেনাকাটার শর্ত চেক (minOrderAmount অথবা minSpend)
    const minSpend = c.minOrderAmount ?? c.minSpend;
    if (minSpend && dto.cartTotal < minSpend) {
      throw new BadRequestException(
        `এই কুপনটি পেতে কমপক্ষে ৳${minSpend} টাকার কেনাকাটা করতে হবে`,
      );
    }

    // সর্বোচ্চ কতবার ব্যবহার হয়েছে চেক
    const usageLimit = c.usageLimit || c.maxUses;
    if (usageLimit && coupon.usages && coupon.usages.length >= usageLimit) {
      throw new BadRequestException('এই কুপনটির ব্যবহারের লিমিট শেষ হয়ে গেছে');
    }

    // একই ইউজার আগে ব্যবহার করেছে কি না চেক
    const userLimit = c.userLimit || c.perUserLimit;
    if (userId && userLimit && coupon.usages) {
      const userUsageCount = coupon.usages.filter(
        (u: any) => u.userId === userId,
      ).length;
      if (userUsageCount >= userLimit) {
        throw new BadRequestException('আপনি ইতিমধ্যে এই কুপনটি ব্যবহার করেছেন');
      }
    }

    // ৫.১ মার্কেটপ্লেস সোর্স এবং ক্যাটাগরি ভ্যালিডেশন (Source & Category Targeting)
    const reqSource = c.source && c.source !== 'ALL' ? c.source.toLowerCase() : null;
    const reqCategory = c.categoryName && c.categoryName !== 'ALL' ? c.categoryName.toLowerCase() : null;

    if ((reqSource || reqCategory) && dto.productIds && dto.productIds.length > 0) {
      const matchingProducts = await this.prisma.product.findMany({
        where: {
          id: { in: dto.productIds },
          ...(reqSource ? { source: { equals: reqSource, mode: 'insensitive' } } : {}),
          ...(reqCategory
            ? {
                OR: [
                  { category: { name: { contains: reqCategory, mode: 'insensitive' } } },
                  { category: { slug: { contains: reqCategory, mode: 'insensitive' } } },
                  { subcategory: { contains: reqCategory, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        select: { id: true },
      });

      if (matchingProducts.length === 0) {
        if (reqSource && reqCategory) {
          throw new BadRequestException(
            `এই কুপনটি শুধুমাত্র ${c.source.toUpperCase()} মার্কেটপ্লেসের '${c.categoryName}' ক্যাটাগরির পণ্যের জন্য প্রযোজ্য`,
          );
        } else if (reqSource) {
          throw new BadRequestException(
            `এই কুপনটি শুধুমাত্র ${c.source.toUpperCase()} মার্কেটপ্লেস থেকে আনা পণ্যের জন্য প্রযোজ্য`,
          );
        } else {
          throw new BadRequestException(
            `এই কুপনটি শুধুমাত্র '${c.categoryName}' ক্যাটাগরির পণ্যের জন্য প্রযোজ্য`,
          );
        }
      }
    }

    // ডিসকাউন্ট অ্যামাউন্ট হিসাব
    const discountVal = c.discountValue ?? c.discount ?? 0;
    const discountType = c.discountType || 'PERCENTAGE';
    let discountAmount = 0;

    if (discountType === 'PERCENTAGE') {
      discountAmount = (dto.cartTotal * discountVal) / 100;
      const maxDiscount = c.maxDiscountAmount ?? c.maxDiscount;
      if (maxDiscount && discountAmount > maxDiscount) {
        discountAmount = maxDiscount;
      }
    } else {
      discountAmount = discountVal;
    }

    return {
      valid: true,
      code: coupon.code,
      discountType,
      discountValue: discountVal,
      discountAmount: Math.round(discountAmount),
      finalPayable: Math.max(0, Math.round(dto.cartTotal - discountAmount)),
    };
  }

  /**
   * ২. সক্রিয় ফ্ল্যাশ সেল ক্যাম্পেইন আনা (হোমপেজ টাইমার উইজেটের জন্য)
   */
  async getActiveFlashSales() {
    const now = new Date();
    return this.prisma.flashSaleCampaign.findMany({
      where: {
        isActive: true,
        startTime: { lte: now },
        endTime: { gte: now },
      },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                slug: true,
                sellingPrice: true,
                images: true,
                stock: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * ৩. কম্বো বান্ডেল অফার তালিকা আনা
   */
  async getActiveBundles() {
    return this.prisma.productBundle.findMany({
      where: { isActive: true },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                title: true,
                slug: true,
                sellingPrice: true,
                images: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * ৪. কাস্টমারের লয়্যালটি পয়েন্ট ও ক্যাশব্যাক ব্যালেন্স দেখা
   */
  async getUserLoyalty(userId: string) {
    const rewards = await this.prisma.loyaltyReward.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const totalPoints = rewards
      .filter((r) => !r.isClaimed)
      .reduce((sum, r) => sum + r.points, 0);

    return {
      totalPoints,
      unclaimedRewards: rewards.filter((r) => !r.isClaimed),
      history: rewards,
    };
  }

  /**
   * ৫. পরিত্যক্ত কার্ট সেভ করা (Cart Abandonment Capture)
   */
  async saveAbandonedCart(dto: AbandonedCartDto, userId?: string) {
    return this.prisma.abandonedCart.create({
      data: {
        userId: userId || null,
        customerEmail: dto.email || null,
        customerPhone: dto.phone || null,
        cartData: dto.cartData,
        totalAmount: dto.totalAmount,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ৬. এডমিন — কুপন ম্যানেজমেন্ট (Coupons CRUD)
  // ─────────────────────────────────────────────────────────────
  async getAllCoupons(opts: { page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, opts.limit ?? 20);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (opts.search) {
      where.OR = [
        { code: { contains: opts.search, mode: 'insensitive' } },
        { description: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const [total, coupons] = await Promise.all([
      this.prisma.coupon.count({ where }),
      this.prisma.coupon.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), coupons };
  }

  async getActiveCoupons() {
    return this.prisma.coupon.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        discountType: true,
        discountValue: true,
        minOrderAmount: true,
        usageLimit: true,
        usages: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createCoupon(data: {
    code: string;
    description?: string;
    discountType?: string;
    discountValue: number;
    minOrderAmount?: number;
    maxDiscountAmount?: number;
    usageLimit?: number;
    limitPerUser?: number;
    startDate?: Date | string;
    expiresAt?: Date | string;
    isActive?: boolean;
    source?: string;
    categoryName?: string;
  }) {
    return (this.prisma as any).coupon.create({
      data: {
        code: data.code.toUpperCase().trim(),
        description: data.description,
        discountType: (data.discountType as any) || 'PERCENTAGE',
        discountValue: data.discountValue,
        minOrderAmount: data.minOrderAmount ?? 0,
        maxDiscountAmount: data.maxDiscountAmount,
        usageLimit: data.usageLimit,
        limitPerUser: data.limitPerUser ?? 1,
        startDate: data.startDate ? new Date(data.startDate) : new Date(),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        isActive: data.isActive ?? true,
        source: data.source || 'ALL',
        categoryName: data.categoryName || 'ALL',
      } as any,
    });
  }

  async updateCoupon(
    id: string,
    data: {
      description?: string;
      discountType?: string;
      discountValue?: number;
      minOrderAmount?: number;
      maxDiscountAmount?: number;
      usageLimit?: number;
      limitPerUser?: number;
      expiresAt?: Date | string;
      isActive?: boolean;
      source?: string;
      categoryName?: string;
    },
  ) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Coupon not found: ${id}`);

    return (this.prisma as any).coupon.update({
      where: { id },
      data: {
        ...(data.description !== undefined && { description: data.description }),
        ...(data.discountType && { discountType: data.discountType as any }),
        ...(data.discountValue !== undefined && { discountValue: data.discountValue }),
        ...(data.minOrderAmount !== undefined && { minOrderAmount: data.minOrderAmount }),
        ...(data.maxDiscountAmount !== undefined && { maxDiscountAmount: data.maxDiscountAmount }),
        ...(data.usageLimit !== undefined && { usageLimit: data.usageLimit }),
        ...(data.limitPerUser !== undefined && { limitPerUser: data.limitPerUser }),
        ...(data.expiresAt !== undefined && {
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.source !== undefined && { source: data.source }),
        ...(data.categoryName !== undefined && { categoryName: data.categoryName }),
      } as any,
    });
  }

  async deleteCoupon(id: string) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Coupon not found: ${id}`);
    await this.prisma.coupon.delete({ where: { id } });
    return { success: true, message: 'কুপন সফলভাবে মুছে ফেলা হয়েছে' };
  }

  // ─────────────────────────────────────────────────────────────
  // ৭. এডমিন — ফ্ল্যাশ সেল ক্যাম্পেইন ম্যানেজমেন্ট (Flash Sales CRUD)
  // ─────────────────────────────────────────────────────────────
  async getAllAdminFlashSales() {
    return this.prisma.flashSaleCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, title: true, slug: true, sellingPrice: true, images: true },
            },
          },
        },
      },
    });
  }

  async createFlashSale(data: {
    title: string;
    bannerUrl?: string;
    discountTag?: string;
    startTime: Date | string;
    endTime: Date | string;
    isActive?: boolean;
    items?: Array<{ productId: string; dealPrice: number; stockLimit?: number }>;
  }) {
    const slug =
      data.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '') +
      '-' +
      Date.now();

    return this.prisma.flashSaleCampaign.create({
      data: {
        title: data.title,
        slug,
        bannerUrl: data.bannerUrl,
        discountTag: data.discountTag,
        startTime: new Date(data.startTime),
        endTime: new Date(data.endTime),
        isActive: data.isActive ?? true,
        ...(data.items && data.items.length > 0 && {
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              dealPrice: item.dealPrice,
              stockLimit: item.stockLimit ?? 50,
            })),
          },
        }),
      },
      include: { items: true },
    });
  }

  async updateFlashSale(
    id: string,
    data: {
      title?: string;
      bannerUrl?: string;
      discountTag?: string;
      startTime?: Date | string;
      endTime?: Date | string;
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.flashSaleCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Flash sale campaign not found: ${id}`);

    return this.prisma.flashSaleCampaign.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.bannerUrl !== undefined && { bannerUrl: data.bannerUrl }),
        ...(data.discountTag !== undefined && { discountTag: data.discountTag }),
        ...(data.startTime && { startTime: new Date(data.startTime) }),
        ...(data.endTime && { endTime: new Date(data.endTime) }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async deleteFlashSale(id: string) {
    const existing = await this.prisma.flashSaleCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Flash sale campaign not found: ${id}`);
    await this.prisma.flashSaleCampaign.delete({ where: { id } });
    return { success: true, message: 'ফ্ল্যাশ সেল সফলভাবে মুছে ফেলা হয়েছে' };
  }

  // ─── ইমেইল মার্কেটিং ও ব্রডকাস্ট ক্যাম্পেইন ─────────────────────────────

  /**
   * সব ইমেইল ক্যাম্পেইনের তালিকা
   */
  async getAllCampaigns() {
    return (this.prisma as any).emailCampaign.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * নতুন ইমেইল ক্যাম্পেইন তৈরি
   */
  async createCampaign(data: {
    title: string;
    subject: string;
    previewText?: string;
    bodyHtml: string;
    targetAudience?: string;
    scheduledAt?: string | Date;
  }) {
    return (this.prisma as any).emailCampaign.create({
      data: {
        title: data.title,
        subject: data.subject,
        previewText: data.previewText,
        bodyHtml: data.bodyHtml,
        targetAudience: data.targetAudience || 'ALL_SUBSCRIBERS',
        status: data.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null,
      },
    });
  }

  /**
   * ইমেইল ক্যাম্পেইন আপডেট
   */
  async updateCampaign(id: string, data: any) {
    const existing = await (this.prisma as any).emailCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Campaign not found: ${id}`);

    return (this.prisma as any).emailCampaign.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.subject && { subject: data.subject }),
        ...(data.previewText !== undefined && { previewText: data.previewText }),
        ...(data.bodyHtml && { bodyHtml: data.bodyHtml }),
        ...(data.targetAudience && { targetAudience: data.targetAudience }),
        ...(data.status && { status: data.status }),
        ...(data.scheduledAt !== undefined && { scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : null }),
      },
    });
  }

  /**
   * ইমেইল ক্যাম্পেইন মুছে ফেলা
   */
  async deleteCampaign(id: string) {
    const existing = await (this.prisma as any).emailCampaign.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Campaign not found: ${id}`);
    await (this.prisma as any).emailCampaign.delete({ where: { id } });
    return { success: true, message: 'ক্যাম্পেইন সফলভাবে মুছে ফেলা হয়েছে' };
  }

  /**
   * লাইভ ক্যাম্পেইন ব্রডকাস্ট পাঠানো
   */
  async sendCampaign(id: string) {
    const campaign = await (this.prisma as any).emailCampaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException(`Campaign not found: ${id}`);

    // Count subscribers
    const subscribersCount = await (this.prisma as any).newsletterSubscriber.count({
      where: { isActive: true },
    });

    const recipientCount = Math.max(subscribersCount, 1);

    // Record notification log
    await this.prisma.notificationLog.create({
      data: {
        recipient: `${recipientCount} active newsletter subscribers`,
        channel: 'EMAIL',
        templateCode: 'CAMPAIGN_BROADCAST',
        subject: campaign.subject,
        contentSnapshot: campaign.bodyHtml.slice(0, 500),
        status: 'SENT',
      },
    });

    return (this.prisma as any).emailCampaign.update({
      where: { id },
      data: {
        status: 'SENT',
        sentCount: recipientCount,
        sentAt: new Date(),
      },
    });
  }

  // ─── নিউজলেটার সাবস্ক্রাইবার্স ──────────────────────────────────────────

  async getAllSubscribers(page: number = 1, limit: number = 50, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = search
      ? { email: { contains: search, mode: 'insensitive' } }
      : {};

    const [subscribers, total] = await Promise.all([
      this.prisma.newsletterSubscriber.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.newsletterSubscriber.count({ where }),
    ]);

    return { subscribers, total, page, totalPages: Math.ceil(total / limit) || 1 };
  }

  async addSubscriber(email: string, source: string = 'admin') {
    if (!email || !email.includes('@')) {
      throw new Error('Valid email address is required.');
    }
    return this.prisma.newsletterSubscriber.upsert({
      where: { email: email.toLowerCase().trim() },
      update: { isActive: true },
      create: {
        email: email.toLowerCase().trim(),
        source,
        isActive: true,
      },
    });
  }

  async deleteSubscriber(id: string) {
    await this.prisma.newsletterSubscriber.delete({ where: { id } });
    return { success: true, message: 'সাবস্ক্রাইবার মুছে ফেলা হয়েছে' };
  }

  // ─── পরিত্যক্ত কার্ট ট্র্যাকিং ও রিকভারি ────────────────────────────────────

  async getAllAbandonedCarts(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    const [carts, total, recoveredCount] = await Promise.all([
      this.prisma.abandonedCart.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.abandonedCart.count(),
      this.prisma.abandonedCart.count({ where: { isRecovered: true } }),
    ]);

    return {
      carts,
      total,
      recoveredCount,
      recoveryRate: total > 0 ? Number(((recoveredCount / total) * 100).toFixed(1)) : 0,
    };
  }

  async sendCartRecoveryReminder(id: string, couponCode: string = 'RECOVER10') {
    const cart = await this.prisma.abandonedCart.findUnique({ where: { id } });
    if (!cart) throw new NotFoundException(`Abandoned cart not found: ${id}`);

    if (cart.customerEmail) {
      await this.prisma.notificationLog.create({
        data: {
          recipient: cart.customerEmail,
          channel: 'EMAIL',
          templateCode: 'CART_ABANDONED_RECOVERY',
          subject: 'You left items in your cart! Here is an exclusive 10% coupon',
          contentSnapshot: `Cart total: ৳${cart.totalAmount}, Coupon: ${couponCode}`,
          status: 'SENT',
        },
      });
    }

    return this.prisma.abandonedCart.update({
      where: { id },
      data: {
        remindedAt: new Date(),
        recoveryCoupon: couponCode,
      },
    });
  }
}


import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { RequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateReviewDto,
  CreateProductRequestDto,
  AskQuestionDto,
  ContactMessageDto,
} from './dto/customer.dto';
import { runBackgroundScrape } from '../catalog/scraper.util';

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}


  /**
   * ১. প্রোডাক্ট রিভিউ যোগ করা (Customer Reviews)
   */
  async addReview(dto: CreateReviewDto, userId?: string) {
    // 👉 এই যে এখানে চেক করা হয়েছে:
    let isVerifiedPurchase = false;
    if (userId) {
      const pastOrder = await this.prisma.orderItem.findFirst({
        where: {
          productId: dto.productId,
          order: { userId, status: 'DELIVERED' },
        },
      });
      if (pastOrder) isVerifiedPurchase = true;
    }
    return this.prisma.productReview.create({
      data: {
        productId: dto.productId,
        variantId: dto.variantId || null,
        userId: userId || null,
        customerName: dto.customerName,
        rating: dto.rating,
        title: dto.title,
        comment: dto.comment,
        photoUrls: dto.photoUrls || [],
        isVerifiedPurchase, // 👈 এখানে ট্রু/ফলস সেভ হয়
        isApproved: true,
      },
    });
  }

  /**
   * ২. উইশলিস্ট টগল (Add / Remove)
   */
  async toggleWishlist(productId: string, userId: string, variantId?: string) {
    const existing = await this.prisma.wishlistItem.findFirst({
      where: { userId, productId },
    });

    if (existing) {
      await this.prisma.wishlistItem.delete({ where: { id: existing.id } });
      return {
        success: true,
        action: 'removed',
        message: 'উইশলিস্ট থেকে সরানো হয়েছে',
      };
    }

    await this.prisma.wishlistItem.create({
      data: {
        userId,
        productId,
        variantId: variantId || null,
      },
    });

    return {
      success: true,
      action: 'added',
      message: 'উইশলিস্টে যুক্ত করা হয়েছে',
    };
  }

  /**
   * ৩. কাস্টমারের সম্পূর্ণ উইশলিস্ট দেখা
   */
  async getMyWishlist(userId: string) {
    return this.prisma.wishlistItem.findMany({
      where: { userId },
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
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * ৪. "Buy For Me" - কাস্টম সোর্সিং রিকোয়েস্ট তৈরি
   */
  async createProductRequest(dto: CreateProductRequestDto, userId?: string) {
    const request = await this.prisma.productRequest.create({
      data: {
        userId: userId || null,
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        customerPhone: dto.customerPhone,
        productUrl: dto.productUrl,
        productTitle: dto.productTitle,
        quantity: dto.quantity || 1,
        notes: dto.notes,
        status: 'PENDING',
      },
    });

    // Fire and forget background scrape
    if (dto.productUrl) {
      runBackgroundScrape(dto.productUrl).then(async (result: any) => {
        if (result && result.price) {
          const parsedPrice = parseFloat(result.price.replace(/[^0-9.]/g, ''));
          const adminNoteStr = `[Auto-Scraper]: Price is ${result.price}. Weight is ${result.weight || 'unknown'}.`;
            await this.prisma.productRequest.update({
              where: { id: request.id },
              data: {
                adminNotes: request.notes ? `${request.notes}\n${adminNoteStr}` : adminNoteStr,
            }
          });
        }
      }).catch(err => console.error(err));
    }

    return request;
  }

  /**
   * ৫. কাস্টমারের সোর্সিং রিকোয়েস্টগুলোর লাইভ ট্র্যাকিং
   */
  async getMyRequests(userId: string) {
    return this.prisma.productRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * ৬. প্রোডাক্টে প্রশ্ন করা (Customer Q&A)
   */
  async askQuestion(dto: AskQuestionDto, userId?: string) {
    return this.prisma.productQuestion.create({
      data: {
        productId: dto.productId,
        userId: userId || null,
        customerName: dto.customerName,
        question: dto.question,
        isApproved: true,
      },
    });
  }

  /**
   * ৭. কন্টাক্ট মেসেজ সাবমিশন
   */
  async submitContact(dto: ContactMessageDto) {
    return this.prisma.contactMessage.create({
      data: dto,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ৮. এডমিন — কাস্টমার তালিকা ও স্ট্যাটাস ম্যানেজমেন্ট
  // ─────────────────────────────────────────────────────────────
  async getAllCustomers(opts: { page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, opts.limit ?? 20);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (opts.search) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { email: { contains: opts.search, mode: 'insensitive' } },
        { phone: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          isActive: true,
          isVerified: true,
          createdAt: true,
          _count: {
            select: { orders: true, reviews: true, productRequests: true },
          },
          wallet: {
            select: { balance: true },
          },
        },
      }),
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), users };
  }

  async getCustomerById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        addresses: {
          orderBy: { createdAt: 'desc' },
        },
        wallet: {
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
          },
        },
        productRequests: {
          orderBy: { createdAt: 'desc' },
        },
        reviews: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        _count: {
          select: {
            orders: true,
            reviews: true,
            productRequests: true,
            wishlist: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException(`Customer not found: ${id}`);
    return user;
  }

  async deleteCustomer(id: string) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Customer not found: ${id}`);

    return this.prisma.$transaction(async (tx) => {
      await tx.userAddress.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.wishlistItem.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.customerPriceAlert.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.notification.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.loyaltyReward.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.couponUsage.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.productReview.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.productQuestion.deleteMany({ where: { userId: id } }).catch(() => {});
      await tx.productRequest.updateMany({ where: { userId: id }, data: { userId: null } }).catch(() => {});
      await tx.order.updateMany({ where: { userId: id }, data: { userId: null } }).catch(() => {});
      return tx.user.delete({ where: { id } });
    });
  }

  async updateCustomerStatus(id: string, isActive: boolean) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`ইউজার পাওয়া যায়নি: ${id}`);

    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ৯. এডমিন — "Buy For Me" সোর্সিং রিকোয়েস্ট ম্যানেজমেন্ট
  // ─────────────────────────────────────────────────────────────
  async getAllProductRequests(opts?: { status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(100, opts?.limit ?? 20);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (opts?.status) where.status = opts.status as RequestStatus;

    const [total, requests] = await Promise.all([
      this.prisma.productRequest.count({ where }),
      this.prisma.productRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), requests };
  }

  async updateProductRequestStatus(
    id: string,
    data: {
      status: string;
      quotedPriceUsd?: number;
      quotedPriceBdt?: number;
      adminNotes?: string;
    },
  ) {
    const existing = await this.prisma.productRequest.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`সোর্সিং রিকোয়েস্ট পাওয়া যায়নি: ${id}`);

    return this.prisma.productRequest.update({
      where: { id },
      data: {
        status: data.status as RequestStatus,
        ...(data.quotedPriceUsd !== undefined && { quotedPriceUsd: data.quotedPriceUsd }),
        ...(data.quotedPriceBdt !== undefined && { quotedPriceBdt: data.quotedPriceBdt }),
        ...(data.adminNotes !== undefined && { adminNotes: data.adminNotes }),
      },
    });
  }
}

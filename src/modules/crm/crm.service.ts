import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  TicketPriority,
  TicketStatus,
  ResaleCondition,
  ResaleStatus,
  RefundStatus,
  WalletTxType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTicketDto,
  ReplyTicketDto,
  RequestRefundDto,
  CreateResaleListingDto,
} from './dto/crm.dto';

@Injectable()
export class CrmService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ১. কাস্টমারের ওয়ালেট ব্যালেন্স ও হিস্ট্রি দেখা
   */
  async getMyWallet(userId: string) {
    let wallet = await this.prisma.customerWallet.findUnique({
      where: { userId },
      include: {
        transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });

    if (!wallet) {
      wallet = await this.prisma.customerWallet.create({
        data: { userId, balance: 0.0, currency: 'BDT' },
        include: { transactions: true },
      });
    }

    return wallet;
  }

  /**
   * ২. রিফান্ডের আবেদন জমা দেওয়া (Refund Request)
   */
  async requestRefund(dto: RequestRefundDto, userId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, userId },
    });

    if (!order) {
      throw new NotFoundException('অর্ডারটি পাওয়া যায়নি');
    }

    const method = dto.refundMethod || 'WALLET';

    const refund = await this.prisma.refundRequest.create({
      data: {
        orderId: order.id,
        userId,
        amount: dto.amount,
        reason: dto.reason,
        refundMethod: method,
        status: RefundStatus.PENDING,
      },
    });

    return {
      success: true,
      message: 'রিফান্ডের আবেদন জমা হয়েছে। খুব শীঘ্রই রিভিউ করা হবে।',
      refundId: refund.id,
    };
  }

  /**
   * ৩. নতুন সাপোর্ট টিকেট ওপেন করা
   */
  async createTicket(dto: CreateTicketDto, userId: string) {
    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true, email: true, phone: true },
        })
      : null;

    const ticketNumber = `TCK-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    let priority: TicketPriority = TicketPriority.MEDIUM;
    if (dto.priority && (TicketPriority as any)[dto.priority]) {
      priority = (TicketPriority as any)[dto.priority];
    }

    return this.prisma.supportTicket.create({
      data: {
        ticketNumber,
        userId,
        customerName: user?.name || 'Customer',
        customerEmail: user?.email || 'customer@example.com',
        customerPhone: user?.phone || null,
        orderId: dto.orderId || null,
        subject: dto.subject,
        priority,
        status: TicketStatus.OPEN,
        messages: {
          create: {
            senderType: 'CUSTOMER',
            senderName: user?.name || 'Customer',
            message: dto.message,
          },
        },
      },
      include: { messages: true },
    });
  }

  /**
   * ৪. টিকেটে মেসেজ রিপ্লাই দেওয়া
   */
  async replyTicket(
    ticketId: string,
    dto: ReplyTicketDto,
    userId?: string,
    isStaff: boolean = false,
  ) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('টিকেট পাওয়া যায়নি');

    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { name: true },
        })
      : null;

    const senderName = isStaff ? 'Support Agent' : user?.name || 'Customer';

    const message = await this.prisma.ticketMessage.create({
      data: {
        ticketId,
        senderType: isStaff ? 'STAFF' : 'CUSTOMER',
        senderName,
        message: dto.message,
      },
    });

    // টিকেট স্ট্যাটাস আপডেট
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: isStaff ? TicketStatus.WAITING_ON_CUSTOMER : TicketStatus.OPEN,
      },
    });

    return message;
  }

  /**
   * ৫. আমার সব সাপোর্ট টিকেট দেখা
   */
  async getMyTickets(userId: string) {
    return this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  /**
   * ৬. ১-ক্লিক ভেরিফায়েড পিটুপি রি-সেল লিস্টিং তৈরি
   */
  async createResaleListing(dto: CreateResaleListingDto, userId: string) {
    const orderItem = await this.prisma.orderItem.findFirst({
      where: {
        id: dto.orderItemId,
        order: { userId, status: 'DELIVERED' },
      },
      include: { product: true },
    });

    if (!orderItem) {
      throw new BadRequestException(
        'শুধুমাত্র সফলভাবে ডেলিভারি পাওয়া পণ্যই রি-সেল করা যাবে',
      );
    }

    const listingNumber = `RSL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const commissionPct = 8.0;
    const sellerPayoutAmount = Math.round(dto.resalePrice * (1 - commissionPct / 100));

    let condition: ResaleCondition = ResaleCondition.LIKE_NEW;
    if (dto.condition && (ResaleCondition as any)[dto.condition]) {
      condition = (ResaleCondition as any)[dto.condition];
    }

    const listing = await this.prisma.resaleListing.create({
      data: {
        listingNumber,
        sellerId: userId,
        orderId: orderItem.orderId,
        productId: orderItem.productId,
        title: orderItem.productTitle || orderItem.product?.title || 'Pre-loved Product',
        description:
          dto.reasonForSelling ||
          `Pre-loved ${orderItem.productTitle || 'item'} in ${condition} condition`,
        condition,
        originalPriceBdt: orderItem.unitPrice,
        resalePriceBdt: dto.resalePrice,
        commissionPct,
        sellerPayoutAmount,
        photoUrls: dto.photos && dto.photos.length > 0
          ? dto.photos
          : orderItem.productImage
            ? [orderItem.productImage]
            : [],
        status: ResaleStatus.ACTIVE,
      },
    });

    return {
      success: true,
      message: 'আপনার রি-সেল লিস্টিং সফলভাবে লাইভ হয়েছে!',
      listingId: listing.id,
    };
  }

  /**
   * ৭. স্টোরফ্রন্টের জন্য পাবলিক রি-সেল মার্কেটপ্লেস তালিকা (Pre-Loved Marketplace)
   */
  async getPublicResaleListings() {
    return this.prisma.resaleListing.findMany({
      where: { status: 'ACTIVE' },
      include: {
        product: {
          select: {
            title: true,
            slug: true,
            images: true,
            brand: { select: { name: true } },
            category: { select: { name: true } },
          },
        },
        seller: {
          select: {
            name: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ৮. এডমিন — সাপোর্ট টিকেট ম্যানেজমেন্ট (Admin Ticket Management)
  // ─────────────────────────────────────────────────────────────
  async getAllTickets(opts: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, opts.limit ?? 20);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (opts.status) where.status = opts.status as TicketStatus;
    if (opts.search) {
      where.OR = [
        { ticketNumber: { contains: opts.search, mode: 'insensitive' } },
        { customerName: { contains: opts.search, mode: 'insensitive' } },
        { customerEmail: { contains: opts.search, mode: 'insensitive' } },
        { subject: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const [total, tickets] = await Promise.all([
      this.prisma.supportTicket.count({ where }),
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          messages: { take: 1, orderBy: { createdAt: 'desc' } },
        },
      }),
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), tickets };
  }

  async updateTicketStatus(ticketId: string, status: string, assignedStaffId?: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException(`টিকেট পাওয়া যায়নি: ${ticketId}`);

    return this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: status as TicketStatus,
        ...(assignedStaffId && { assignedStaffId }),
      },
    });
  }

  // ─────────────────────────────────────────────────────────────
  // ৯. এডমিন — রিফান্ড রিকোয়েস্ট ম্যানেজমেন্ট (Admin Refund Operations)
  // ─────────────────────────────────────────────────────────────
  async getAllRefunds(opts: { page?: number; limit?: number; status?: string }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, opts.limit ?? 20);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (opts.status) where.status = opts.status as RefundStatus;

    const [total, refunds] = await Promise.all([
      this.prisma.refundRequest.count({ where }),
      this.prisma.refundRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          order: { select: { id: true, orderNumber: true, totalAmount: true, customerName: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return { total, page, limit, totalPages: Math.ceil(total / limit), refunds };
  }

  async updateRefundStatus(
    id: string,
    status: string,
    adminNotes?: string,
    processedBy?: string,
  ) {
    const refund = await this.prisma.refundRequest.findUnique({ where: { id } });
    if (!refund) throw new NotFoundException(`রিফান্ড রিকোয়েস্ট পাওয়া যায়নি: ${id}`);

    const newStatus = status as RefundStatus;

    // যদি WALLET রিফান্ড অ্যাপ্রুভ বা কমপ্লিট হয়, তবে ইউজারের ওয়ালেটে ব্যালেন্স জমা করা হবে
    if (
      (newStatus === RefundStatus.APPROVED || newStatus === RefundStatus.COMPLETED) &&
      refund.status !== RefundStatus.APPROVED &&
      refund.status !== RefundStatus.COMPLETED &&
      refund.refundMethod === 'WALLET' &&
      refund.userId
    ) {
      const wallet = await this.prisma.customerWallet.upsert({
        where: { userId: refund.userId },
        update: { balance: { increment: refund.amount } },
        create: { userId: refund.userId, balance: refund.amount, currency: 'BDT' },
      });

      await this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTxType.REFUND_CREDIT,
          amount: refund.amount,
          balanceAfter: wallet.balance,
          description: `Refund credited for Order #${refund.orderId}`,
          referenceId: refund.id,
        },
      });
    }

    return this.prisma.refundRequest.update({
      where: { id },
      data: {
        status: newStatus,
        adminNotes: adminNotes ?? refund.adminNotes,
        processedBy: processedBy ?? refund.processedBy,
        processedAt: new Date(),
      },
    });
  }

  async getTicketById(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        order: {
          select: {
            id: true,
            orderNumber: true,
            status: true,
            totalAmount: true,
            courierName: true,
            courierTrackingCode: true,
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException(`টিকেট পাওয়া যায়নি: ${ticketId}`);
    return ticket;
  }

}


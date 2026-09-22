import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { runBackgroundScrape } from '../catalog/scraper.util';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * ১. নতুন অর্ডার তৈরি ও সম্পূর্ণ ফিন্যান্সিয়াল ব্রেকডাউন হিসাব
   */
  async createOrder(dto: CreateOrderDto, userId?: string) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('অর্ডারে কমপক্ষে একটি পণ্য থাকা আবশ্যক');
    }

    // ইউনিক অর্ডার নম্বর তৈরি (e.g. A2Z-2026-98124)
    const orderNumber = `A2Z-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

    let productSubtotal = 0;
    let totalWeightKg = 0;
    const orderItemsData: any[] = [];

    // কাস্টমারের কার্টের প্রতিটি প্রোডাক্টের দাম ও স্ন্যাপশট তৈরি
    for (const item of dto.items) {
      const product = await this.prisma.product.findUnique({
        where: { id: item.productId },
        include: { variants: true },
      });

      if (!product) {
        throw new NotFoundException(`প্রোডাক্ট পাওয়া যায়নি: ${item.productId}`);
      }

      let unitPrice = typeof item.unitPrice === 'number' && item.unitPrice > 0
        ? item.unitPrice
        : product.sellingPrice;
      let selectedSize: string | null = null;
      let selectedColor: string | null = null;
      let itemImage = product.images[0] || '';

      if (item.variantId) {
        const variant = product.variants.find((v) => v.id === item.variantId);
        if (variant) {
          if (!(typeof item.unitPrice === 'number' && item.unitPrice > 0) && variant.sellingPrice) {
            unitPrice = variant.sellingPrice;
          }
          selectedSize = variant.size;
          selectedColor = variant.color;
          if (variant.imageUrl) itemImage = variant.imageUrl;
        }
      }

      const itemTotal = unitPrice * item.quantity;
      productSubtotal += itemTotal;
      totalWeightKg += (product.weightKg || 0.2) * item.quantity;

      orderItemsData.push({
        productId: product.id,
        variantId: item.variantId || null,
        productTitle: product.title,
        productImage: itemImage,
        productSlug: product.slug,
        selectedSize,
        selectedColor,
        quantity: item.quantity,
        sourcePrice: product.sourcePrice,
        unitPrice,
        totalPrice: itemTotal,
        weightKg: product.weightKg || 0.2,
      });
    }

        // localDeliveryFee (honors checkout-passed fee, e.g. Self-Pickup 0)
    const localDeliveryFee = typeof dto.localDeliveryFee === 'number'
      ? dto.localDeliveryFee
      : (dto.shippingCity.toLowerCase().includes('dhaka') ? 70.0 : 130.0);

    // কুপন ডিসকাউন্ট হিসাব
    let discountAmount = 0.0;
    if (dto.couponCode) {
      const coupon = await this.prisma.coupon.findUnique({
        where: { code: dto.couponCode.toUpperCase() },
      });
      if (coupon && coupon.isActive) {
        if (coupon.discountType === 'PERCENTAGE') {
          discountAmount = (productSubtotal * coupon.discountValue) / 100;
        } else {
          discountAmount = coupon.discountValue;
        }
      }
    }

    const finalSubtotal = typeof dto.productSubtotal === 'number' && dto.productSubtotal > 0
      ? dto.productSubtotal
      : productSubtotal;

    const calculatedTotal = Math.max(
      0,
      finalSubtotal + localDeliveryFee - discountAmount,
    );

    const totalAmount = typeof dto.totalAmount === 'number' && dto.totalAmount > 0
      ? dto.totalAmount
      : calculatedTotal;

    const currency = (dto.currency || 'BDT').toUpperCase();

    // ডিফল্ট ইউএসএ ওয়্যারহাউস খোঁজা
    const defaultWarehouse = await this.prisma.consolidatorWarehouse.findFirst({
      where: { countryCode: 'US', isActive: true },
    });

    // ডাটাবেস ট্রানজেকশনে অর্ডার ও WMS পার্সেল একসাথে তৈরি
    const order = await this.prisma.order.create({
      data: {
        orderNumber,
        userId: userId || null,
        customerName: dto.customerName,
        customerEmail: dto.customerEmail,
        customerPhone: dto.customerPhone,
        shippingCity: dto.shippingCity,
        shippingCountry: 'BD',
        shippingAddress: dto.shippingAddress as any,
        productSubtotal: finalSubtotal,
        localDeliveryFee,
        discountAmount,
        totalAmount,
        currency,
        paymentMethod: dto.paymentMethod || 'cod',
        status: 'PENDING',
        paymentStatus: 'UNPAID',
        notes: dto.notes,
        warehouseId: defaultWarehouse?.id || null,
        trackingNumber: `TRK-${orderNumber}`,
        trackingStatus: 'Order Placed',
        trackingHistory: [
          {
            status: 'PENDING',
            title: 'অর্ডার গ্রহণ করা হয়েছে',
            description: 'আপনার অর্ডারটি সফলভাবে জমা হয়েছে।',
            timestamp: new Date().toISOString(),
          },
        ] as any,
        items: {
          create: orderItemsData,
        },
        // ওয়্যারহাউসের জন্য অটো পার্সেল তৈরি
        ...(defaultWarehouse && {
          parcels: {
            create: {
              warehouseId: defaultWarehouse.id,
              customerEmail: dto.customerEmail,
              weightKg: totalWeightKg,
              declaredValueUsd: Math.round(productSubtotal / 136.5),
              status: 'awaiting',
              description: `Order #${orderNumber} (${dto.items.length} items)`,
            },
          },
        }),
      },
      include: {
        items: true,
        parcels: true,
      },
    });

    this.logger.log(
      `✅ New Order Created: ${order.orderNumber} | Total: ৳${order.totalAmount}`,
    );

    // Fire and forget background scrape for order items
    order.items.forEach(async (item) => {
      try {
        if (!item.productId) return;
        const product = await this.prisma.product.findUnique({ where: { id: item.productId } });
        if (product && product.sourceUrl) {
          const result = await runBackgroundScrape(product.sourceUrl);
          if (result && result.price) {
            const scrapedPrice = parseFloat(result.price.replace(/[^0-9.]/g, ''));
            if (scrapedPrice > (item.sourcePrice || 0) * 1.05) { // 5% price hike threshold
              const note = `[Auto-Scraper ⚠️]: Price hike detected for "${item.productTitle}". Old source price: $${item.sourcePrice}, New source price: $${scrapedPrice}.`;
              await this.prisma.order.update({
                where: { id: order.id },
                data: { notes: { push: note } as any } // Use push if array, or concat string
              }).catch(() => {
                // Fallback for string concatenation if notes is a string
                this.prisma.order.findUnique({ where: { id: order.id } }).then(o => {
                  if (o) {
                    this.prisma.order.update({
                      where: { id: order.id },
                      data: { notes: o.notes ? `${o.notes}\n${note}` : note }
                    }).catch(e => console.error(e));
                  }
                });
              });
            }
          }
        }
      } catch (err) {
        console.error(`[BackgroundScraper] Error on order ${order.orderNumber}:`, err);
      }
    });

    // For COD orders, send order confirmation & invoice email immediately
    if (order.paymentMethod?.toLowerCase() === 'cod') {
      this.mailService.sendOrderInvoiceEmail(order).catch((err) => {
        this.logger.error(`Failed to send COD invoice email for order ${order.id}: ${err.message}`);
      });
    }

    return {
      success: true,
      message: 'অর্ডার সফলভাবে সম্পন্ন হয়েছে!',
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      currency: order.currency,
      trackingNumber: order.trackingNumber,
      orderId: order.id,
    };
  }

  /**
   * ২. লাইভ অর্ডার ট্র্যাকিং (Public Tracking by Order Number)
   */
  async trackOrder(orderNumber: string) {
    const order = await this.prisma.order.findUnique({
      where: { orderNumber },
      select: {
        orderNumber: true,
        status: true,
        paymentStatus: true,
        trackingNumber: true,
        trackingStatus: true,
        trackingHistory: true,
        courierName: true,
        courierTrackingCode: true,
        shippingCity: true,
        createdAt: true,
        items: {
          select: {
            productTitle: true,
            productImage: true,
            selectedSize: true,
            selectedColor: true,
            quantity: true,
            totalPrice: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`অর্ডার নম্বর পাওয়া যায়নি: ${orderNumber}`);
    }

    return order;
  }

  /**
   * ৩. কাস্টমারের সব অর্ডারের তালিকা (User Order History)
   */
  async getMyOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
      },
    });
  }

  /**
   * ৪. অর্ডারের স্ট্যাটাস পরিবর্তন ও টাইমলাইন লগ আপডেট (Admin/Staff Action)
   */
  async updateOrderStatus(
    orderId: string,
    newStatus: string,
    title: string,
    description: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    const history = Array.isArray(order.trackingHistory)
      ? (order.trackingHistory as any[])
      : [];
    history.push({
      status: newStatus,
      title,
      description,
      timestamp: new Date().toISOString(),
    });
    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: newStatus as any,
        trackingStatus: title,
        trackingHistory: history as any,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ৫. এডমিন — সব অর্ডার তালিকা (paginated, filterable)
  // ─────────────────────────────────────────────────────────────────────────
  async getAllOrders(opts: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, opts.limit ?? 20);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (opts.status) where.status = opts.status.toUpperCase();
    if (opts.search) {
      where.OR = [
        { orderNumber: { contains: opts.search, mode: 'insensitive' } },
        { customerName: { contains: opts.search, mode: 'insensitive' } },
        { customerEmail: { contains: opts.search, mode: 'insensitive' } },
        { customerPhone: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            select: {
              id: true,
              productTitle: true,
              quantity: true,
              unitPrice: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      orders,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ৬. এডমিন — একটি অর্ডারের সম্পূর্ণ বিস্তারিত
  // ─────────────────────────────────────────────────────────────────────────
  async getOrderById(id: string) {
    const trimmed = id.trim();
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { id: trimmed },
          { orderNumber: trimmed },
          { orderNumber: { contains: trimmed, mode: 'insensitive' } },
          { trackingNumber: trimmed },
          { supplierTrackingNumber: trimmed },
        ],
      },
      include: {
        items: true,
        parcels: true,
        purchaseOrders: true,
      },
    });
    if (!order) throw new NotFoundException(`অর্ডার পাওয়া যায়নি: ${id}`);
    return order;
  }

  /**
   * ৬. লোকাল কুরিয়ারে পার্সেল বুকিং ও ডিসপ্যাচ
   */
  async dispatchCourier(
    orderId: string,
    data: { courierName: string; courierTrackingCode?: string; notes?: string }
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('অর্ডার পাওয়া যায়নি');

    const courier = data.courierName || 'Pathao';
    const prefix = courier.toUpperCase().slice(0, 3);
    const trackingCode = data.courierTrackingCode || `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`;

    const history = Array.isArray(order.trackingHistory)
      ? (order.trackingHistory as any[])
      : [];
    history.push({
      status: 'OUT_FOR_DELIVERY',
      title: `Handed over to ${courier}`,
      description: `Dispatched with tracking code ${trackingCode}. ${data.notes || ''}`.trim(),
      timestamp: new Date().toISOString(),
    });

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        courierName: courier,
        courierTrackingCode: trackingCode,
        status: 'OUT_FOR_DELIVERY',
        trackingStatus: `Out for Delivery (${courier})`,
        trackingHistory: history as any,
      },
    });
  }

  async bulkDispatch(data: { orderIds: string[]; courierName: string; notes?: string }) {
    const results = [];
    for (const id of data.orderIds) {
      try {
        const updated = await this.dispatchCourier(id, {
          courierName: data.courierName,
          notes: data.notes,
        });
        results.push({ id, success: true, trackingCode: updated.courierTrackingCode });
      } catch (err: any) {
        results.push({ id, success: false, error: err.message });
      }
    }
    return { success: true, count: results.length, results };
  }

  /**
   * ৭. অর্ডার ডিলিট (Admin Delete Order)
   */
  async deleteOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, orderNumber: true },
    });

    if (!order) {
      throw new NotFoundException(`অর্ডার পাওয়া যায়নি (ID: ${id})`);
    }

    // Explicitly delete OrderItems first for extra safety
    await this.prisma.orderItem.deleteMany({
      where: { orderId: id },
    });

    await this.prisma.order.delete({
      where: { id },
    });

    return {
      success: true,
      message: `অর্ডার #${order.orderNumber} সফলভাবে মুছে ফেলা হয়েছে।`,
      deletedOrderId: id,
    };
  }

  /**
   * ৮. বাল্ক অর্ডার ডিলিট (Admin Bulk Delete Orders)
   */
  async bulkDeleteOrders(orderIds: string[]) {
    if (!orderIds || !orderIds.length) {
      return { success: false, message: 'কোনো অর্ডার আইডি সিলেক্ট করা হয়নি।' };
    }

    await this.prisma.orderItem.deleteMany({
      where: { orderId: { in: orderIds } },
    });

    const deleteResult = await this.prisma.order.deleteMany({
      where: { id: { in: orderIds } },
    });

    return {
      success: true,
      message: `${deleteResult.count} টি অর্ডার সফলভাবে মুছে ফেলা হয়েছে।`,
      count: deleteResult.count,
    };
  }
}

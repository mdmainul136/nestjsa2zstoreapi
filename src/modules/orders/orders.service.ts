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

    const gatewayFee = typeof dto.gatewayFee === 'number' && dto.gatewayFee > 0
      ? dto.gatewayFee
      : 0.0;

    const logisticsFee = typeof dto.logisticsFee === 'number' && dto.logisticsFee > 0
      ? dto.logisticsFee
      : 0.0;

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
      finalSubtotal + localDeliveryFee + gatewayFee + logisticsFee - discountAmount,
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
        gatewayFee,
        discountAmount,
        totalAmount,
        paymentDetails: {
          gatewayFee,
          logisticsFee,
        },
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
   * Helper: Formats an order with both camelCase and snake_case properties for storefront compatibility
   */
  formatStorefrontOrder(order: any) {
    if (!order) return null;
    const items = (order.items || []).map((it: any) => ({
      id: it.id,
      orderId: it.orderId,
      order_id: it.orderId,
      productId: it.productId,
      product_id: it.productId,
      productSlug: it.productSlug || it.productId || '',
      product_slug: it.productSlug || it.productId || '',
      productTitle: it.productTitle || 'Product',
      product_title: it.productTitle || 'Product',
      title: it.productTitle || 'Product',
      productImage: it.productImage || '',
      product_image: it.productImage || '',
      image: it.productImage || '',
      selectedColor: it.selectedColor || null,
      selected_color: it.selectedColor || null,
      selectedSize: it.selectedSize || null,
      selected_size: it.selectedSize || null,
      quantity: it.quantity || 1,
      unitPrice: it.unitPrice || 0,
      unit_price: it.unitPrice || 0,
      price: it.unitPrice || 0,
      totalPrice: it.totalPrice || ((it.unitPrice || 0) * (it.quantity || 1)),
      total_price: it.totalPrice || ((it.unitPrice || 0) * (it.quantity || 1)),
      weightKg: it.weightKg || 0.1,
    }));

    const paymentDetails =
      typeof order.paymentDetails === 'object' && order.paymentDetails !== null
        ? order.paymentDetails
        : {};

    return {
      ...order,
      id: order.id,
      order_id: order.id,
      orderNumber: order.orderNumber,
      order_number: order.orderNumber,
      customerName: order.customerName,
      customer_name: order.customerName,
      customerEmail: order.customerEmail,
      customer_email: order.customerEmail,
      customerPhone: order.customerPhone,
      customer_phone: order.customerPhone,
      shippingCity: order.shippingCity,
      shipping_city: order.shippingCity,
      shippingCountry: order.shippingCountry,
      shipping_country: order.shippingCountry,
      shippingAddress: order.shippingAddress,
      shipping_address: order.shippingAddress,
      shippingMethod: order.shippingMethod || 'Standard Delivery',
      shipping_method: order.shippingMethod || 'Standard Delivery',
      productSubtotal: order.productSubtotal || 0,
      subtotal: order.productSubtotal || 0,
      localDeliveryFee: order.localDeliveryFee || 0,
      shippingFee: order.localDeliveryFee || 0,
      shipping_fee: order.localDeliveryFee || 0,
      gatewayFee: order.gatewayFee || 0,
      gateway_fee: order.gatewayFee || 0,
      logisticsFee: paymentDetails.logisticsFee || 0,
      logistics_fee: paymentDetails.logisticsFee || 0,
      discountAmount: order.discountAmount || 0,
      discount_amount: order.discountAmount || 0,
      totalAmount: order.totalAmount || 0,
      total_amount: order.totalAmount || 0,
      total: order.totalAmount || 0,
      currency: order.currency || 'BDT',
      status: order.status,
      paymentStatus: order.paymentStatus,
      payment_status: order.paymentStatus,
      paymentMethod: order.paymentMethod,
      payment_method: order.paymentMethod,
      trackingNumber: order.trackingNumber,
      tracking_number: order.trackingNumber,
      trackingStatus: order.trackingStatus,
      tracking_status: order.trackingStatus,
      trackingHistory: order.trackingHistory || [],
      tracking_history: order.trackingHistory || [],
      warehouseId: order.warehouseId,
      warehouse_id: order.warehouseId,
      warehouseName: order.warehouse?.name || 'USA Logistics Hub',
      warehouse_name: order.warehouse?.name || 'USA Logistics Hub',
      createdAt: order.createdAt,
      created_at: order.createdAt,
      updatedAt: order.updatedAt,
      updated_at: order.updatedAt,
      items,
      parcels: order.parcels || [],
    };
  }

  /**
   * কাস্টমার ইমেইল অনুযায়ী অর্ডারের তালিকা (Storefront Customer Order History)
   */
  async getOrdersByCustomer(email: string, limit: number = 50) {
    if (!email) return [];
    const trimmedEmail = email.trim();
    const orders = await this.prisma.order.findMany({
      where: {
        OR: [
          { customerEmail: { equals: trimmedEmail, mode: 'insensitive' } },
          { user: { email: { equals: trimmedEmail, mode: 'insensitive' } } },
        ],
      },
      take: Math.min(100, Math.max(1, limit)),
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        parcels: true,
        warehouse: true,
      },
    });
    return orders.map((o) => this.formatStorefrontOrder(o));
  }

  /**
   * স্টোরফ্রন্ট থেকে একটি অর্ডারের সম্পূর্ণ বিবরণ
   */
  async getStorefrontOrder(idOrNumber: string, email?: string) {
    const trimmed = idOrNumber.trim();
    const where: any = {
      OR: [
        { id: trimmed },
        { orderNumber: trimmed },
        { orderNumber: { equals: trimmed, mode: 'insensitive' } },
        { trackingNumber: trimmed },
        { trackingNumber: { equals: trimmed, mode: 'insensitive' } },
      ],
    };

    if (email && email.trim()) {
      where.OR = where.OR.map((cond: any) => ({
        ...cond,
        customerEmail: { equals: email.trim(), mode: 'insensitive' },
      }));
    }

    let order = await this.prisma.order.findFirst({
      where,
      include: {
        items: true,
        parcels: true,
        warehouse: true,
      },
    });

    if (!order && email) {
      order = await this.prisma.order.findFirst({
        where: {
          OR: [
            { id: trimmed },
            { orderNumber: trimmed },
            { orderNumber: { equals: trimmed, mode: 'insensitive' } },
            { trackingNumber: trimmed },
          ],
        },
        include: {
          items: true,
          parcels: true,
          warehouse: true,
        },
      });
    }

    if (!order) {
      throw new NotFoundException(`অর্ডার পাওয়া যায়নি: ${idOrNumber}`);
    }

    return this.formatStorefrontOrder(order);
  }

  /**
   * স্টোরফ্রন্ট কাস্টমারের অর্ডার বাতিল রিকোয়েস্ট
   */
  async cancelOrderCustomer(orderId: string, email?: string, reason?: string) {
    const trimmed = orderId.trim();
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { id: trimmed },
          { orderNumber: trimmed },
          { orderNumber: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
    });

    if (!order) {
      throw new NotFoundException('অর্ডার পাওয়া যায়নি');
    }

    if (email && email.trim() && order.customerEmail) {
      if (order.customerEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
        throw new BadRequestException('Unauthorized to cancel this order');
      }
    }

    if (order.status === 'CANCELLED') {
      return { success: true, message: 'অর্ডারটি ইতিমধ্যে বাতিল করা হয়েছে' };
    }

    const cancellable = ['PENDING', 'CONFIRMED'];
    if (!cancellable.includes(order.status)) {
      throw new BadRequestException(
        `অর্ডার স্ট্যাটাস "${order.status}" থাকায় এখন সরাসরি বাতিল করা সম্ভব নয়। দয়া করে সাপোর্টে যোগাযোগ করুন।`,
      );
    }

    const history = Array.isArray(order.trackingHistory)
      ? (order.trackingHistory as any[])
      : [];
    history.push({
      status: 'CANCELLED',
      title: 'Customer Cancelled',
      description: reason || 'Customer requested order cancellation',
      timestamp: new Date().toISOString(),
    });

    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'CANCELLED',
        trackingStatus: 'Cancelled',
        trackingHistory: history as any,
      },
      include: {
        items: true,
        parcels: true,
        warehouse: true,
      },
    });

    return {
      success: true,
      message: 'অর্ডার সফলভাবে বাতিল করা হয়েছে',
      order: this.formatStorefrontOrder(updated),
    };
  }

  /**
   * ২. লাইভ অর্ডার ট্র্যাকিং (Public Tracking by Order Number, Tracking ID, or RFQ)
   */
  async trackOrder(identifier: string) {
    if (!identifier) {
      throw new BadRequestException('অনুসন্ধানের জন্য অর্ডার নম্বর বা ট্র্যাকিং আইডি প্রদান করুন');
    }
    const trimmed = identifier.trim();
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { orderNumber: trimmed },
          { orderNumber: { equals: trimmed, mode: 'insensitive' } },
          { trackingNumber: trimmed },
          { trackingNumber: { equals: trimmed, mode: 'insensitive' } },
          { id: trimmed },
          { courierTrackingCode: trimmed },
          { supplierTrackingNumber: trimmed },
        ],
      },
      include: {
        warehouse: true,
        items: true,
      },
    });

    if (order) {
      const history = Array.isArray(order.trackingHistory)
        ? (order.trackingHistory as any[])
        : [];
      return {
        id: order.id,
        orderId: order.orderNumber || order.id,
        order_id: order.orderNumber || order.id,
        orderNumber: order.orderNumber,
        order_number: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        payment_status: order.paymentStatus,
        trackingNumber: order.trackingNumber,
        tracking_number: order.trackingNumber,
        trackingStatus: order.trackingStatus || order.status,
        tracking_status: order.trackingStatus || order.status,
        trackingHistory: history,
        tracking_history: history,
        warehouse_id: order.warehouseId,
        warehouse_name: order.warehouse?.name || 'USA Logistics Hub',
        shipping_method: order.shippingMethod || 'Standard Air Freight',
        shippingMethod: order.shippingMethod || 'Standard Air Freight',
        courierName: order.courierName,
        courier_name: order.courierName,
        courierTrackingCode: order.courierTrackingCode,
        courier_tracking_code: order.courierTrackingCode,
        shippingCity: order.shippingCity,
        shipping_city: order.shippingCity,
        consolidation: order.consolidation,
        repacking: order.repacking,
        quality_check: order.qualityCheck,
        photo_check: order.photoCheck,
        customs_estimate: order.customsEstimate || 0,
        totalAmount: order.totalAmount,
        total_amount: order.totalAmount,
        currency: order.currency,
        createdAt: order.createdAt,
        created_at: order.createdAt,
        updatedAt: order.updatedAt,
        updated_at: order.updatedAt,
        items: (order.items || []).map((it) => ({
          productTitle: it.productTitle,
          product_title: it.productTitle,
          productImage: it.productImage,
          product_image: it.productImage,
          selectedSize: it.selectedSize,
          selected_size: it.selectedSize,
          selectedColor: it.selectedColor,
          selected_color: it.selectedColor,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          unit_price: it.unitPrice,
          totalPrice: it.totalPrice,
          total_price: it.totalPrice,
        })),
      };
    }

    // Fallback: check QuotationRequest (RFQ)
    const quote = await this.prisma.quotationRequest.findFirst({
      where: {
        OR: [
          { id: trimmed },
          { id: { equals: trimmed, mode: 'insensitive' } },
        ],
      },
    });

    if (quote) {
      return {
        id: quote.id,
        order_id: quote.id,
        orderId: quote.id,
        is_rfq: true,
        status: quote.status,
        tracking_status: quote.status,
        tracking_history: quote.adminNotes
          ? [
              {
                status: quote.status,
                description: quote.adminNotes,
                timestamp: quote.updatedAt.toISOString(),
              },
            ]
          : [],
        quoted_price: quote.quotedPrice,
        currency: quote.currency || 'USD',
        product_name: quote.productName,
        quantity: quote.quantity,
        admin_notes: quote.adminNotes,
        updated_at: quote.updatedAt.toISOString(),
        created_at: quote.createdAt.toISOString(),
        items: [
          {
            productTitle: quote.productName,
            product_title: quote.productName,
            quantity: quote.quantity,
            totalPrice: quote.quotedPrice || 0,
            total_price: quote.quotedPrice || 0,
          },
        ],
      };
    }

    throw new NotFoundException(`অর্ডার বা ট্র্যাকিং নম্বর পাওয়া যায়নি: ${identifier}`);
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

  async updateOrderPaymentStatus(
    orderId: string,
    paymentStatus: string,
    paymentMethod?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('অর্ডার পাওয়া যায়নি');

    const updateData: any = {
      paymentStatus: paymentStatus.toUpperCase(),
    };
    if (paymentMethod) {
      updateData.paymentMethod = paymentMethod.toUpperCase();
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: updateData,
      include: { items: true },
    });

    if (paymentStatus.toUpperCase() === 'PAID') {
      this.mailService.sendOrderInvoiceEmail(updated).catch((err) => {
        this.logger.error(`Failed to send invoice email after payment update for order ${orderId}: ${err.message}`);
      });
    }

    return updated;
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

  /**
   * ৯. গ্রাহক ও এডমিন ইনভয়েস প্রিন্ট HTML তৈরি
   */
  async generateOrderInvoiceHtml(id: string): Promise<string> {
    const order = await this.getOrderById(id);
    const settings = await this.prisma.systemSetting.findMany({
      where: { category: 'invoice' },
    });
    const map: Record<string, any> = {};
    settings.forEach((s) => {
      try {
        map[s.key] = JSON.parse(s.value);
      } catch {
        map[s.key] = s.value;
      }
    });

    const store = await this.prisma.storeSetting.findFirst().catch(() => null);

    const companyName = map['company_name'] || store?.storeName || 'A2Z Outlet Store';
    const legalName = map['legal_name'] || 'A2Z Outlet Store Ltd.';
    const tagline = map['tagline'] || store?.tagline || 'Authentic Cross-Border Shopping Platform';
    const logoUrl = map['logo_url'] || store?.logoUrl || '';
    const binNumber = map['bin_number'] || 'BIN: 004819284-0101 (Mushak 6.3)';
    const address = map['address'] || store?.officeAddress || 'House #12, Road #4, Dhanmondi, Dhaka-1205, Bangladesh';
    const phone = map['phone'] || store?.supportPhone || '+880 1700-000000';
    const email = map['email'] || store?.supportEmail || 'billing@a2zoutletstore.com';
    const website = map['website'] || 'https://a2zoutletstore.com';
    const invoiceTitle = map['invoice_title'] || 'TAX INVOICE / CASH MEMO';
    const invoicePrefix = map['invoice_prefix'] || 'A2Z-INV-';
    const accentColor = map['accent_color'] || '#0f172a';
    const showLogo = map['show_logo'] !== undefined ? (map['show_logo'] === 'true' || map['show_logo'] === true) : true;
    const showTagline = map['show_tagline'] !== undefined ? (map['show_tagline'] === 'true' || map['show_tagline'] === true) : true;
    const showTaxBin = map['show_tax_bin'] !== undefined ? (map['show_tax_bin'] === 'true' || map['show_tax_bin'] === true) : true;
    const showBarcode = map['show_barcode'] !== undefined ? (map['show_barcode'] === 'true' || map['show_barcode'] === true) : true;
    const showSku = map['show_sku'] !== undefined ? (map['show_sku'] === 'true' || map['show_sku'] === true) : true;
    const showShippingDetails = map['show_shipping_details'] !== undefined ? (map['show_shipping_details'] === 'true' || map['show_shipping_details'] === true) : true;
    const showPaymentStatus = map['show_payment_status'] !== undefined ? (map['show_payment_status'] === 'true' || map['show_payment_status'] === true) : true;
    const showLogisticsFee = map['show_logistics_fee'] !== undefined ? (map['show_logistics_fee'] === 'true' || map['show_logistics_fee'] === true) : true;
    const showGatewayFee = map['show_gateway_fee'] !== undefined ? (map['show_gateway_fee'] === 'true' || map['show_gateway_fee'] === true) : true;
    const showSignatureBlock = map['show_signature_block'] !== undefined ? (map['show_signature_block'] === 'true' || map['show_signature_block'] === true) : true;
    const showTerms = map['show_terms'] !== undefined ? (map['show_terms'] === 'true' || map['show_terms'] === true) : true;
    const signatoryTitle = map['signatory_title'] || 'Authorized Signatory';
    const signatoryName = map['signatory_name'] || 'Accounts & Billing Department';
    const termsText = map['terms_text'] || '1. Please inspect the parcel carefully upon delivery before signing.\n2. For issues, contact customer support within 48 hours with order ID.\n3. Return & warranty applicable as per A2Z Outlet Store refund terms.';
    const footerNote = map['footer_note'] || 'This is an authentic computer-generated tax invoice. Thank you for your business!';

    const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();
    const dateFormatted = createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeFormatted = createdAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const invoiceNo = order.orderNumber.startsWith('A2Z-')
      ? invoicePrefix + order.orderNumber.replace('A2Z-', '')
      : invoicePrefix + order.orderNumber;

    let addressStr = '';
    if (typeof order.shippingAddress === 'object' && order.shippingAddress !== null) {
      const parts = [
        (order.shippingAddress as any).house,
        (order.shippingAddress as any).street,
        (order.shippingAddress as any).area,
        (order.shippingAddress as any).postalCode,
      ].filter(Boolean);
      addressStr = parts.join(', ');
    } else if (typeof order.shippingAddress === 'string') {
      addressStr = order.shippingAddress;
    }
    if (!addressStr) addressStr = 'Doorstep Delivery Address';

    const itemsRows = (order.items || []).map((it, idx) => `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 9px 10px; color: #64748b; font-family: monospace; font-size: 11px;">${idx + 1}</td>
        <td style="padding: 9px 10px;">
          <div style="font-weight: 600; color: #0f172a; font-size: 12px;">${it.productTitle || 'Product Item'}</div>
          ${showSku && it.productId ? `<div style="font-size: 10px; color: #64748b; font-family: monospace; margin-top: 2px;">SKU: ${it.productId}</div>` : ''}
          ${it.selectedSize || it.selectedColor ? `<div style="font-size: 10px; color: #64748b; margin-top: 1px;">Variant: ${[it.selectedSize, it.selectedColor].filter(Boolean).join(' ')}</div>` : ''}
        </td>
        <td style="padding: 9px 10px; text-align: center; font-family: monospace; font-size: 12px;">${it.quantity}</td>
        <td style="padding: 9px 10px; text-align: right; font-family: monospace; font-size: 12px;">৳${Number(it.unitPrice || 0).toLocaleString()}</td>
        <td style="padding: 9px 10px; text-align: right; font-family: monospace; font-weight: 700; font-size: 12px;">৳${Number(it.totalPrice || 0).toLocaleString()}</td>
      </tr>
    `).join('');

    const isPaid = (order.paymentStatus || '').toUpperCase() === 'PAID';

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${invoiceNo} - ${companyName}</title>
      <style>
        @page { size: A4 portrait; margin: 10mm 12mm; }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; background: #fff; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      </style>
    </head>
    <body>
      <div style="max-width: 800px; margin: 0 auto; padding: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid ${accentColor}; margin-bottom: 16px;">
          <div>
            <div style="display: flex; align-items: center; gap: 12px;">
              ${showLogo && logoUrl ? `<img src="${logoUrl}" alt="${companyName}" style="height: 48px; max-width: 190px; object-fit: contain;" />` : showLogo ? `<div style="width: 44px; height: 44px; border-radius: 8px; background: ${accentColor}; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 18px;">A2Z</div>` : ''}
              <div>
                <div style="font-size: 20px; font-weight: 900; color: ${accentColor};">${companyName}</div>
                ${showTagline && tagline ? `<div style="font-size: 11px; color: #64748b;">${tagline}</div>` : ''}
              </div>
            </div>
            <div style="font-size: 11px; color: #475569; margin-top: 10px; line-height: 1.5;">
              <div>${address}</div>
              <div>Phone: ${phone} • Email: ${email}</div>
              ${showTaxBin && binNumber ? `<div style="font-weight: 700; color: #1e293b; margin-top: 3px;">${binNumber}</div>` : ''}
            </div>
          </div>
          <div style="text-align: right;">
            <div style="display: inline-block; padding: 4px 12px; background: ${accentColor}; color: #fff; font-size: 11px; font-weight: 800; text-transform: uppercase; border-radius: 4px; margin-bottom: 8px;">${invoiceTitle}</div>
            <div style="font-family: monospace; font-size: 14px; font-weight: 800;">${invoiceNo}</div>
            <div style="font-size: 11px; color: #64748b;">Date: ${dateFormatted}</div>
            <div style="font-size: 11px; color: #64748b;">Time: ${timeFormatted}</div>
            ${showPaymentStatus ? `
              <div style="margin-top: 6px;">
                <span style="font-size: 10px; font-weight: 700; font-family: monospace; padding: 2px 6px; border-radius: 4px; background: #ede9fe; color: #5b21b6;">${order.paymentMethod || 'COD'}</span>
                <span style="font-size: 10px; font-weight: 700; font-family: monospace; padding: 2px 6px; border-radius: 4px; background: ${isPaid ? '#dcfce7' : '#fef3c7'}; color: ${isPaid ? '#15803d' : '#92400e'};">${order.paymentStatus}</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 12px 0; border-bottom: 1px solid #e2e8f0; margin-bottom: 16px;">
          <div>
            <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px;">Billed & Shipped To:</div>
            <div style="font-size: 13px; font-weight: 700;">${order.customerName}</div>
            <div style="font-size: 11px; color: #475569; font-family: monospace;">Phone: ${order.customerPhone}</div>
            ${order.customerEmail ? `<div style="font-size: 11px; color: #475569;">Email: ${order.customerEmail}</div>` : ''}
            ${showShippingDetails ? `<div style="font-size: 11px; color: #475569; margin-top: 3px;">${addressStr}, ${order.shippingCity || 'Dhaka'}</div>` : ''}
          </div>
          <div style="text-align: right;">
            <div style="font-size: 10px; font-weight: 800; text-transform: uppercase; color: #94a3b8; margin-bottom: 4px;">Order Summary:</div>
            <div style="font-size: 12px; font-family: monospace; font-weight: 700;">Order #${order.orderNumber}</div>
            <div style="font-size: 11px; color: #64748b;">Method: ${order.shippingMethod || 'Standard Delivery'}</div>
            ${order.gatewayTransactionId ? `<div style="font-size: 10px; color: #64748b; font-family: monospace;">Trx: ${order.gatewayTransactionId}</div>` : ''}
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
          <thead>
            <tr style="background: ${accentColor}; color: #ffffff; font-size: 10px; text-transform: uppercase;">
              <th style="padding: 8px 10px; text-align: left;">SL</th>
              <th style="padding: 8px 10px; text-align: left;">Item Description</th>
              <th style="padding: 8px 10px; text-align: center;">Qty</th>
              <th style="padding: 8px 10px; text-align: right;">Unit Price</th>
              <th style="padding: 8px 10px; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: flex-start; margin-bottom: 20px;">
          <div>
            ${showBarcode ? `
              <div style="display: inline-flex; align-items: center; gap: 12px; padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                <div>
                  <div style="font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase;">Tracking Number</div>
                  <div style="font-family: monospace; font-size: 12px; font-weight: 800; color: #0f172a;">${order.orderNumber}</div>
                  <div style="font-size: 9px; color: #94a3b8;">Authentic E-Receipt</div>
                </div>
              </div>
            ` : ''}
          </div>
          <div style="font-size: 12px; line-height: 1.8;">
            <div style="display: flex; justify-content: space-between; color: #475569;">
              <span>Product Subtotal:</span>
              <span style="font-family: monospace; font-weight: 600;">৳${Number(order.productSubtotal || order.totalAmount).toLocaleString()}</span>
            </div>
            <div style="display: flex; justify-content: space-between; color: #475569;">
              <span>Delivery Fee:</span>
              <span style="font-family: monospace;">৳${Number(order.localDeliveryFee || order.shippingFee || 0).toLocaleString()}</span>
            </div>
            ${showLogisticsFee && ((order as any).logisticsFee || (order.paymentDetails as any)?.logisticsFee) ? `
              <div style="display: flex; justify-content: space-between; color: #475569;">
                <span>Logistics & Handling:</span>
                <span style="font-family: monospace;">৳${Number((order as any).logisticsFee || (order.paymentDetails as any)?.logisticsFee).toLocaleString()}</span>
              </div>
            ` : ''}
            ${showGatewayFee && order.gatewayFee && order.gatewayFee > 0 ? `
              <div style="display: flex; justify-content: space-between; color: #475569;">
                <span>Gateway Fee:</span>
                <span style="font-family: monospace;">৳${Number(order.gatewayFee).toLocaleString()}</span>
              </div>
            ` : ''}
            <div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 900; color: ${accentColor}; border-top: 2px solid ${accentColor}; padding-top: 6px;">
              <span>Net Total Amount:</span>
              <span style="font-family: monospace;">৳${Number(order.totalAmount).toLocaleString()}</span>
            </div>
          </div>
        </div>

        ${showTerms && termsText ? `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 20px; font-size: 10px; color: #475569; line-height: 1.5;">
            <div style="font-weight: 800; text-transform: uppercase; color: #334155; margin-bottom: 4px;">Terms & Return Guidelines:</div>
            <div style="white-space: pre-line;">${termsText}</div>
          </div>
        ` : ''}

        <div style="border-top: 1px solid #e2e8f0; padding-top: 16px;">
          ${showSignatureBlock ? `
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; font-size: 11px;">
              <div style="color: #64748b;">
                <div>Customer Signature: _______________________</div>
                <div style="font-size: 9px; margin-top: 3px;">Received merchandise in good condition</div>
              </div>
              <div style="text-align: right;">
                <div style="display: inline-block; border-bottom: 1px solid #94a3b8; padding-bottom: 2px; font-weight: 700;">${signatoryName}</div>
                <div style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase;">${signatoryTitle}</div>
              </div>
            </div>
          ` : ''}

          <div style="text-align: center; font-size: 10px; color: #64748b;">
            <div>${footerNote}</div>
            <div style="font-size: 9px; color: #94a3b8; margin-top: 2px;">Powered by ${legalName} • ${website}</div>
          </div>
        </div>
      </div>
      <script>
        window.onload = function() {
          setTimeout(function() { window.print(); }, 300);
        };
      </script>
    </body>
    </html>`;
  }
}

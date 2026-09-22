import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  private async getUddoktaPayConfig() {
    const config = await this.prisma.paymentGatewaySetting.findFirst();
    if (!config?.isUddoktapayActive || !config?.uddoktapayApiKey || !config?.uddoktapayBaseUrl) {
      throw new HttpException('UddoktaPay is not configured or disabled', HttpStatus.BAD_REQUEST);
    }
    let rawUrl = config.uddoktapayBaseUrl.trim();
    if (rawUrl.endsWith('/')) rawUrl = rawUrl.slice(0, -1);
    if (rawUrl.toLowerCase().endsWith('/api')) rawUrl = rawUrl.slice(0, -4);
    
    return {
      baseUrl: `${rawUrl}/`,
      apiKey: config.uddoktapayApiKey.trim(),
    };
  }

  async initializePayment(payload: any) {
    const { order_id, amount, customer_name, customer_email, customer_phone, phone, return_url, cancel_url } = payload;
    
    const config = await this.getUddoktaPayConfig();

    const order = await this.prisma.order.findUnique({
      where: { id: order_id },
      include: { items: true },
    });
    if (!order) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:5001';

    const resolvedAmount = (amount !== undefined && amount !== null && Number(amount) > 0) ? Number(amount) : order.totalAmount;
    const resolvedPhone = (customer_phone || phone || order.customerPhone || '').trim();
    const resolvedEmail = (customer_email || order.customerEmail || '').trim();
    const resolvedName = (customer_name || order.customerName || 'Customer').trim();

    // Format readable items summary (e.g. "1. Wet Ones Sanitizer (x1) | 2. ...")
    const itemsSummary = (order.items || [])
      .map(
        (item, index) =>
          `${index + 1}. ${item.productTitle || 'Product'} (x${item.quantity}) - ৳${item.unitPrice}`
      )
      .join(' | ')
      .slice(0, 300);

    // Format readable delivery address
    let deliveryAddress = order.shippingCity || '';
    if (order.shippingAddress) {
      try {
        const addr = typeof order.shippingAddress === 'string'
          ? JSON.parse(order.shippingAddress)
          : order.shippingAddress;
        const parts = [addr.house, addr.street, addr.area, order.shippingCity, addr.postalCode, order.shippingCountry].filter(Boolean);
        if (parts.length > 0) deliveryAddress = parts.join(', ');
      } catch (_) {
        deliveryAddress = String(order.shippingAddress);
      }
    }

    const paymentData = {
      full_name: resolvedName,
      email: resolvedEmail,
      phone: resolvedPhone,
      customer_phone: resolvedPhone,
      mobile: resolvedPhone,
      phone_number: resolvedPhone,
      amount: (Math.round(resolvedAmount * 100) / 100).toFixed(2),
      currency: (order.currency || 'BDT').toUpperCase(),
      product_name: itemsSummary || `Order #${order.orderNumber}`,
      description: `Order #${order.orderNumber} - ${resolvedName} (${resolvedPhone})`,
      metadata: {
        order_id: order.id,
        order_number: order.orderNumber,
        customer_name: resolvedName,
        customer_phone: resolvedPhone,
        customer_email: resolvedEmail,
        phone: resolvedPhone,
        email: resolvedEmail,
        order_items: itemsSummary || 'N/A',
        items_count: order.items?.length || 0,
        delivery_address: deliveryAddress,
        shipping_city: order.shippingCity,
        subtotal: order.productSubtotal,
        delivery_fee: order.localDeliveryFee,
        total_amount: resolvedAmount,
        currency: (order.currency || 'BDT').toUpperCase(),
      },
      redirect_url: return_url,
      return_type: 'GET', // UddoktaPay will append invoice_id as query param to return_url
      cancel_url: cancel_url,
      webhook_url: `${appUrl}/api/payments/ipn`,
    };

    try {
      const response = await fetch(`${config.baseUrl}api/checkout-v2`, {
        method: 'POST',
        headers: {
          'RT-UDDOKTAPAY-API-KEY': config.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(paymentData),
      });

      const result = await response.json();
      
      if (!response.ok || !result.status) {
        this.logger.error(`UddoktaPay Initialize Error: ${JSON.stringify(result)}`);
        throw new HttpException(result.message || 'Failed to initialize payment', HttpStatus.BAD_REQUEST);
      }

      return {
        redirect_url: result.payment_url,
      };
    } catch (error: any) {
      this.logger.error(`Failed to initiate UddoktaPay payment: ${error.message}`);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Payment initiation failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async handleIpn(payload: any) {
    // Both GET and POST callbacks from UddoktaPay provide invoice_id
    const invoice_id = payload.invoice_id || (payload.body && payload.body.invoice_id) || (payload.query && payload.query.invoice_id);
    
    if (!invoice_id) {
      throw new HttpException('Invoice ID is missing', HttpStatus.BAD_REQUEST);
    }

    const config = await this.getUddoktaPayConfig();

    try {
      const verifyRes = await fetch(`${config.baseUrl}api/verify-payment`, {
        method: 'POST',
        headers: {
          'RT-UDDOKTAPAY-API-KEY': config.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ invoice_id }),
      });

      const verifyData = await verifyRes.json();
      
      if (verifyData.status === 'COMPLETED') {
        const orderId = verifyData.metadata?.order_id || verifyData.metadata?.orderId;
        
        if (orderId) {
          const updateData: any = {
            paymentStatus: 'PAID',
            paymentMethod: verifyData.payment_method || 'UDDOKTAPAY',
            gatewayTransactionId: verifyData.transaction_id || invoice_id,
            paymentDetails: verifyData,
          };

          // If a valid payer phone is returned by the gateway, record it
          const payerPhone = verifyData.sender_number || verifyData.phone || verifyData.metadata?.phone || verifyData.metadata?.customer_phone;
          if (payerPhone && payerPhone !== 'N/A' && String(payerPhone).trim() !== '') {
            updateData.customerPhone = String(payerPhone).trim();
          }

          const updatedOrder = await this.prisma.order.update({
            where: { id: orderId },
            data: updateData,
            include: { items: true },
          });
          this.logger.log(`Order ${orderId} marked as PAID via UddoktaPay IPN.`);

          // Send paid order invoice email to customer asynchronously
          this.mailService.sendOrderInvoiceEmail(updatedOrder).catch((err) => {
            this.logger.error(`Failed to dispatch invoice email for order ${orderId}: ${err.message}`);
          });
        }
      } else {
        this.logger.warn(`UddoktaPay IPN Verification Failed or Not Completed: ${JSON.stringify(verifyData)}`);
      }
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Failed to verify UddoktaPay IPN: ${error.message}`);
      throw new HttpException('Failed to verify payment', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

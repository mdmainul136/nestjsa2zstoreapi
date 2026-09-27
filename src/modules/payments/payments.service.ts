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

  private async getStripeConfig() {
    const config = await this.prisma.paymentGatewaySetting.findFirst();
    if (!config?.isStripeActive || !config?.stripeSecretKey) {
      throw new HttpException('Stripe is not configured or disabled', HttpStatus.BAD_REQUEST);
    }
    return {
      secretKey: config.stripeSecretKey.trim(),
      publishableKey: config.stripePublishableKey?.trim() || '',
    };
  }

  async initializePayment(payload: any) {
    const { order_id, gateway } = payload;

    const order = await this.prisma.order.findUnique({
      where: { id: order_id },
      include: { items: true },
    });
    if (!order) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    const selectedGateway = (gateway || order.paymentMethod || 'uddoktapay').toLowerCase().trim();

    if (selectedGateway === 'stripe') {
      return this.initializeStripePayment(order, payload);
    }

    return this.initializeUddoktapayPayment(order, payload);
  }

  private async initializeStripePayment(order: any, payload: any) {
    const { amount, return_url, cancel_url, customer_email } = payload;
    const config = await this.getStripeConfig();

    const resolvedAmount = (amount !== undefined && amount !== null && Number(amount) > 0)
      ? Number(amount)
      : order.totalAmount;
    const resolvedEmail = (customer_email || order.customerEmail || '').trim();
    const currency = (order.currency || 'USD').toLowerCase();
    const unitAmount = Math.round(resolvedAmount * 100);

    const sep = return_url.includes('?') ? '&' : '?';
    const successUrl = `${return_url}${sep}gateway=stripe&session_id={CHECKOUT_SESSION_ID}`;
    const cancelSep = cancel_url.includes('?') ? '&' : '?';
    const resolvedCancelUrl = `${cancel_url}${cancelSep}gateway=stripe`;

    const bodyParams = new URLSearchParams();
    bodyParams.append('mode', 'payment');
    bodyParams.append('success_url', successUrl);
    bodyParams.append('cancel_url', resolvedCancelUrl);
    bodyParams.append('client_reference_id', order.id);
    if (resolvedEmail) {
      bodyParams.append('customer_email', resolvedEmail);
    }
    bodyParams.append('line_items[0][price_data][currency]', currency);
    bodyParams.append('line_items[0][price_data][unit_amount]', String(unitAmount));
    bodyParams.append('line_items[0][price_data][product_data][name]', `Order #${order.orderNumber}`);
    bodyParams.append('line_items[0][quantity]', '1');
    bodyParams.append('metadata[order_id]', order.id);
    bodyParams.append('metadata[order_number]', String(order.orderNumber));

    try {
      const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: bodyParams.toString(),
      });

      const session = await response.json();
      if (!response.ok || !session.url) {
        this.logger.error(`Stripe Initialize Error: ${JSON.stringify(session)}`);
        throw new HttpException(session.error?.message || 'Failed to initialize Stripe payment', HttpStatus.BAD_REQUEST);
      }

      // Save Stripe session id on the order record
      const existingDetails = typeof order.paymentDetails === 'object' && order.paymentDetails !== null ? order.paymentDetails : {};
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentMethod: 'STRIPE',
          paymentDetails: {
            ...existingDetails,
            stripe_session_id: session.id,
            stripe_url: session.url,
          },
        },
      }).catch((e) => this.logger.warn(`Could not save stripe session to order: ${e.message}`));

      return {
        redirect_url: session.url,
        session_id: session.id,
      };
    } catch (error: any) {
      this.logger.error(`Failed to initiate Stripe payment: ${error.message}`);
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Stripe payment initiation failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async verifyStripePayment(sessionId?: string, orderId?: string) {
    if (!sessionId && !orderId) {
      throw new HttpException('session_id or order_id is required', HttpStatus.BAD_REQUEST);
    }

    const config = await this.getStripeConfig();
    let targetSessionId = sessionId?.trim();
    let targetOrder: any = null;

    if (orderId) {
      targetOrder = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!targetOrder) {
        throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
      }
      if (!targetSessionId) {
        const details: any = targetOrder.paymentDetails;
        targetSessionId = details?.stripe_session_id || details?.id;
      }
    }

    if (!targetSessionId) {
      // If we don't have session_id but order is already marked PAID
      if (targetOrder?.paymentStatus === 'PAID') {
        return { success: true, status: 'PAID', order: targetOrder };
      }
      return { success: false, message: 'No Stripe session ID available to verify' };
    }

    try {
      const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${targetSessionId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.secretKey}`,
        },
      });

      const session = await response.json();
      if (!response.ok || session.error) {
        this.logger.error(`Stripe verify session error: ${JSON.stringify(session)}`);
        throw new HttpException(session.error?.message || 'Failed to retrieve Stripe session', HttpStatus.BAD_REQUEST);
      }

      const isPaid = session.payment_status === 'paid' || session.status === 'complete';
      const resolvedOrderId = orderId || session.client_reference_id || session.metadata?.order_id;

      if (isPaid && resolvedOrderId) {
        const existingDetails = targetOrder?.paymentDetails && typeof targetOrder.paymentDetails === 'object' ? targetOrder.paymentDetails : {};
        const updatedOrder = await this.prisma.order.update({
          where: { id: resolvedOrderId },
          data: {
            paymentStatus: 'PAID',
            paymentMethod: 'STRIPE',
            gatewayTransactionId: (session.payment_intent as string) || session.id,
            paymentDetails: {
              ...existingDetails,
              stripe_session_id: session.id,
              payment_intent: session.payment_intent,
              amount_total: session.amount_total,
              currency: session.currency,
              payment_status: session.payment_status,
            },
          },
          include: { items: true },
        });

        this.logger.log(`Order ${resolvedOrderId} verified and marked as PAID via Stripe.`);

        this.mailService.sendOrderInvoiceEmail(updatedOrder).catch((err) => {
          this.logger.error(`Failed to send invoice email for Stripe order ${resolvedOrderId}: ${err.message}`);
        });

        return {
          success: true,
          status: 'PAID',
          order: updatedOrder,
        };
      }

      return {
        success: isPaid,
        status: session.payment_status || 'unpaid',
      };
    } catch (error: any) {
      this.logger.error(`Failed to verify Stripe payment: ${error.message}`);
      if (error instanceof HttpException) throw error;
      throw new HttpException(error.message || 'Stripe verification failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private async initializeUddoktapayPayment(order: any, payload: any) {
    const { amount, customer_name, customer_email, customer_phone, phone, return_url, cancel_url } = payload;
    const config = await this.getUddoktaPayConfig();
    const appUrl = this.configService.get<string>('APP_URL') || 'http://localhost:5001';

    const resolvedAmount = (amount !== undefined && amount !== null && Number(amount) > 0) ? Number(amount) : order.totalAmount;
    const resolvedPhone = (customer_phone || phone || order.customerPhone || '').trim();
    const resolvedEmail = (customer_email || order.customerEmail || '').trim();
    const resolvedName = (customer_name || order.customerName || 'Customer').trim();

    // Format readable items summary
    const itemsSummary = (order.items || [])
      .map(
        (item: any, index: number) =>
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
      return_type: 'GET',
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

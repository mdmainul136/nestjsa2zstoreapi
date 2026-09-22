import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';

export interface SendMailOptions {
  to: string;
  subject?: string;
  html?: string;
  text?: string;
  templateCode?: string;
  variables?: Record<string, any>;
  senderName?: string;
  senderEmail?: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Dynamic transporter resolver based on live DB NotificationSetting
   */
  private async getTransporter() {
    const settings = await this.prisma.notificationSetting.findFirst();

    if (!settings || !settings.isSmtpActive || !settings.smtpHost) {
      return {
        transporter: null,
        senderEmail: settings?.senderEmail || 'orders@a2zoutletstore.com',
        senderName: settings?.senderName || 'A2Z Crossborder Operations',
        isActive: false,
      };
    }

    const isSecure = Number(settings.smtpPort) === 465;

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: Number(settings.smtpPort) || 587,
      secure: isSecure,
      auth:
        settings.smtpUser && settings.smtpPassword
          ? {
              user: settings.smtpUser,
              pass: settings.smtpPassword,
            }
          : undefined,
      tls: {
        rejectUnauthorized: false, // Prevents self-signed cert issues in dev
      },
    });

    return {
      transporter,
      senderEmail: settings.senderEmail || 'orders@a2zoutletstore.com',
      senderName: settings.senderName || 'A2Z Crossborder Operations',
      isActive: true,
    };
  }

  /**
   * Helper to replace {{placeholder}} tags
   */
  private renderTemplate(content: string, variables: Record<string, any> = {}): string {
    let output = content;
    for (const [key, val] of Object.entries(variables)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      output = output.replace(regex, String(val ?? ''));
    }
    return output;
  }

  /**
   * Core dispatching function with DB NotificationLog recording
   */
  async sendMail(options: SendMailOptions) {
    const { to, templateCode, variables = {} } = options;
    let subject = options.subject || '';
    let html = options.html || '';
    let text = options.text || '';

    // 1. Check if an EmailTemplate exists for this code
    if (templateCode) {
      const template = await this.prisma.emailTemplate.findUnique({
        where: { code: templateCode },
      });

      if (template && template.isActive) {
        subject = subject || this.renderTemplate(template.subject, variables);
        html = html || this.renderTemplate(template.bodyHtml, variables);
        if (template.bodyText) {
          text = text || this.renderTemplate(template.bodyText, variables);
        }
      }
    }

    // Fallback subject if still empty
    if (!subject) {
      subject = 'Notification from A2Z Outlet Store';
    }

    const { transporter, senderEmail, senderName, isActive } = await this.getTransporter();
    const fromAddress = `"${options.senderName || senderName}" <${options.senderEmail || senderEmail}>`;

    let status = 'SENT';
    let errorMessage: string | null = null;

    if (transporter && isActive) {
      try {
        await transporter.sendMail({
          from: fromAddress,
          to,
          subject,
          html,
          text: text || html.replace(/<[^>]*>?/gm, ''),
        });
        this.logger.log(`[SMTP DISPATCH SUCCESS] Sent to: ${to} | Subject: "${subject}"`);
      } catch (error: any) {
        status = 'FAILED';
        errorMessage = error?.message || 'SMTP dispatch error';
        this.logger.warn(`[SMTP DISPATCH FAILED] ${errorMessage}. Logging to audit log.`);
      }
    } else {
      // In sandbox/dev without active SMTP config
      status = 'SENT'; // marked as sent in sandbox
      this.logger.log(
        `[SANDBOX EMAIL SIMULATOR] To: ${to} | Subject: "${subject}" | OTP/Vars: ${JSON.stringify(variables)}`,
      );
    }

    // 2. Persist notification log
    try {
      await this.prisma.notificationLog.create({
        data: {
          recipient: to,
          channel: 'EMAIL',
          templateCode: templateCode || 'CUSTOM_EMAIL',
          subject,
          contentSnapshot: html.substring(0, 1000),
          status,
          errorMessage,
        },
      });
    } catch (e: any) {
      this.logger.error(`Failed to record notification log: ${e.message}`);
    }

    return {
      success: status === 'SENT',
      recipient: to,
      subject,
      status,
      errorMessage,
    };
  }

  /**
   * Auth Verification OTP Email
   */
  async sendAuthVerificationEmail(email: string, name: string, otp: string) {
    const defaultHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
          <!-- Header -->
          <tr>
            <td style="padding: 32px 32px 24px 32px; text-align: center; border-bottom: 1px solid #27272a;">
              <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; color: #10b981;">
                A2Z <span style="color: #ffffff;">OUTLET</span>
              </h1>
              <p style="margin: 6px 0 0 0; font-size: 13px; color: #a1a1aa; text-transform: uppercase; letter-spacing: 1px;">
                Crossborder Authentication
              </p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #ffffff;">
                Verify Your Email Address
              </h2>
              <p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #d4d4d8;">
                Hello <strong>${name || 'Valued Customer'}</strong>,<br>
                Thank you for registering at A2Z Outlet Store. Use the one-time verification code below to activate your crossborder shopping account:
              </p>
              
              <!-- OTP Box -->
              <div style="background-color: #09090b; border: 1px dashed #10b981; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                <span style="display: block; font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px;">
                  Your Verification OTP
                </span>
                <span style="display: inline-block; font-family: 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #ffffff;">
                  ${otp}
                </span>
                <span style="display: block; font-size: 12px; color: #71717a; margin-top: 8px;">
                  ⏰ Valid for the next 5 minutes only
                </span>
              </div>

              <p style="margin: 20px 0 0 0; font-size: 13px; line-height: 1.5; color: #71717a;">
                If you did not initiate this request, please safely ignore this email. Do not share this code with anyone.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #121215; border-top: 1px solid #27272a; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #52525b;">
                © ${new Date().getFullYear()} A2Z Outlet Store. All rights reserved.<br>
                Direct USA & Global Import Logistics to Bangladesh.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    return this.sendMail({
      to: email,
      subject: `Your A2Z Outlet Verification Code: ${otp}`,
      html: defaultHtml,
      templateCode: 'AUTH_VERIFY_EMAIL',
      variables: {
        customerName: name || 'Customer',
        otp,
        expiryMinutes: '5',
      },
    });
  }

  /**
   * Password Reset Email
   */
  async sendPasswordResetEmail(email: string, name: string, resetToken: string, resetUrl?: string) {
    const resolvedUrl =
      resetUrl || `https://a2zoutletstore.com/auth/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}`;

    const defaultHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: sans-serif; color: #f4f4f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 32px;">
          <tr>
            <td>
              <h1 style="color: #ef4444; margin: 0 0 16px 0; font-size: 22px;">Password Reset Request</h1>
              <p style="color: #d4d4d8; font-size: 14px; line-height: 1.6;">
                Hi <strong>${name || 'Customer'}</strong>,<br>
                We received a request to reset your password for your A2Z Outlet account. Click the button below to proceed:
              </p>
              <div style="text-align: center; margin: 28px 0;">
                <a href="${resolvedUrl}" style="background-color: #ef4444; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 14px; display: inline-block;">
                  Reset My Password
                </a>
              </div>
              <p style="color: #71717a; font-size: 12px; margin-top: 24px;">
                Token: <code style="color: #f4f4f5; background: #27272a; padding: 2px 6px; border-radius: 4px;">${resetToken}</code><br>
                This link expires in 60 minutes. If you did not make this request, please disregard this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    return this.sendMail({
      to: email,
      subject: `Reset your A2Z Outlet Password`,
      html: defaultHtml,
      templateCode: 'AUTH_FORGOT_PASSWORD',
      variables: {
        customerName: name || 'Customer',
        resetToken,
        resetUrl: resolvedUrl,
      },
    });
  }

  /**
   * Order Invoice & Confirmation Email
   */
  async sendOrderInvoiceEmail(order: any) {
    if (!order || !order.customerEmail) return;

    // Filter out dummy placeholder emails
    if (order.customerEmail.includes('@placeholder.com')) return;

    let addressStr = order.shippingCity || '';
    if (order.shippingAddress) {
      try {
        const addr = typeof order.shippingAddress === 'string'
          ? JSON.parse(order.shippingAddress)
          : order.shippingAddress;
        const parts = [addr.house, addr.street, addr.area, order.shippingCity, addr.postalCode, order.shippingCountry].filter(Boolean);
        if (parts.length > 0) addressStr = parts.join(', ');
      } catch (_) {
        addressStr = String(order.shippingAddress);
      }
    }

    const items = Array.isArray(order.items) ? order.items : [];
    const itemsHtml = items.map((item: any) => {
      const variantStr = [item.selectedColor, item.selectedSize].filter(Boolean).join(' / ');
      return `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 12px 8px; font-size: 13px; color: #1e293b;">
            <div style="font-weight: 600;">${item.productTitle || 'Product'}</div>
            ${variantStr ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">Variant: ${variantStr}</div>` : ''}
          </td>
          <td style="padding: 12px 8px; font-size: 13px; color: #475569; text-align: center;">
            ${item.quantity || 1}
          </td>
          <td style="padding: 12px 8px; font-size: 13px; color: #475569; text-align: right;">
            ৳${Number(item.unitPrice || 0).toLocaleString()}
          </td>
          <td style="padding: 12px 8px; font-size: 13px; font-weight: 600; color: #0f172a; text-align: right;">
            ৳${Number(item.totalPrice || ((item.unitPrice || 0) * (item.quantity || 1)) || 0).toLocaleString()}
          </td>
        </tr>
      `;
    }).join('');

    const subtotal = Number(order.productSubtotal || 0).toLocaleString();
    const deliveryFee = Number(order.localDeliveryFee || 0).toLocaleString();
    const totalAmount = Number(order.totalAmount || 0).toLocaleString();
    const isPaid = (order.paymentStatus || '').toUpperCase() === 'PAID';
    const statusBadge = isPaid
      ? `<span style="background-color: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase;">PAID</span>`
      : `<span style="background-color: #fef9c3; color: #854d0e; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase;">PENDING / COD</span>`;

    const trackUrl = `https://a2zoutletstore.com/order-successful?order_id=${order.id}`;

    const defaultHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice - #${order.orderNumber || order.id}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 24px 32px; background-color: #0f172a; color: #ffffff;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: #f4a100;">
                      A2Z <span style="color: #ffffff;">OUTLET STORE</span>
                    </h1>
                    <p style="margin: 4px 0 0 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px;">
                      USA & Global Imports to Bangladesh
                    </p>
                  </td>
                  <td style="text-align: right;">
                    <div style="font-size: 12px; color: #cbd5e1; font-weight: 600;">INVOICE</div>
                    <div style="font-size: 14px; font-weight: 800; color: #ffffff;">#${order.orderNumber || order.id}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 32px 16px 32px; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="font-size: 15px; font-weight: 700; color: #0f172a;">Thank you for your order!</div>
                    <div style="font-size: 12px; color: #64748b; margin-top: 4px;">
                      Order Date: ${new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                    </div>
                  </td>
                  <td style="text-align: right;">
                    ${statusBadge}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-bottom: 1px solid #f1f5f9;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="width: 50%; vertical-align: top; padding-right: 12px;">
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 6px;">Customer Details</div>
                    <div style="font-size: 13px; font-weight: 600; color: #0f172a;">${order.customerName || 'Customer'}</div>
                    <div style="font-size: 12px; color: #475569; margin-top: 2px;">📞 ${order.customerPhone || 'N/A'}</div>
                    <div style="font-size: 12px; color: #475569; margin-top: 2px;">✉️ ${order.customerEmail}</div>
                  </td>
                  <td style="width: 50%; vertical-align: top; padding-left: 12px;">
                    <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 6px;">Shipment Address</div>
                    <div style="font-size: 12px; color: #1e293b; line-height: 1.4;">${addressStr}</div>
                    <div style="font-size: 12px; color: #475569; margin-top: 4px;">Method: <strong>${order.shippingMethod || 'Standard Delivery'}</strong></div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 32px 16px 32px;">
              <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse;">
                <thead>
                  <tr style="border-bottom: 2px solid #e2e8f0; text-align: left;">
                    <th style="padding: 8px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Item</th>
                    <th style="padding: 8px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; text-align: center;">Qty</th>
                    <th style="padding: 8px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; text-align: right;">Unit Price</th>
                    <th style="padding: 8px; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <table width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="width: 50%;"></td>
                  <td style="width: 50%;">
                    <table width="100%" cellspacing="0" cellpadding="0" style="font-size: 13px;">
                      <tr>
                        <td style="padding: 6px 0; color: #64748b;">Sub-Total:</td>
                        <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #1e293b;">৳${subtotal}</td>
                      </tr>
                      <tr>
                        <td style="padding: 6px 0; color: #64748b;">Delivery Fee:</td>
                        <td style="padding: 6px 0; font-weight: 600; text-align: right; color: #1e293b;">৳${deliveryFee}</td>
                      </tr>
                      <tr style="border-top: 2px solid #e2e8f0;">
                        <td style="padding: 10px 0; font-size: 15px; font-weight: 800; color: #0f172a;">Total Amount:</td>
                        <td style="padding: 10px 0; font-size: 16px; font-weight: 800; text-align: right; color: #ea580c;">৳${totalAmount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
              <a href="${trackUrl}" style="background-color: #f4a100; color: #ffffff; padding: 12px 28px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 13px; display: inline-block;">
                Track Your Parcel Live
              </a>
              <div style="font-size: 11px; color: #94a3b8; margin-top: 10px;">
                Tracking Code: <strong>${order.trackingNumber || 'TRK-' + (order.orderNumber || order.id)}</strong>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding: 20px 32px; background-color: #ffffff; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #f1f5f9;">
              If you have any questions, reply to this email or contact support at <a href="mailto:support@a2zoutletstore.com" style="color: #f4a100; text-decoration: none;">support@a2zoutletstore.com</a>.<br>
              © ${new Date().getFullYear()} A2Z Outlet Store. Dhaka, Bangladesh.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();

    return this.sendMail({
      to: order.customerEmail,
      subject: `Order Confirmation & Invoice #${order.orderNumber || order.id} - A2Z Outlet Store`,
      html: defaultHtml,
      templateCode: 'ORDER_INVOICE_CONFIRMATION',
      variables: {
        orderNumber: order.orderNumber || order.id,
        customerName: order.customerName,
        totalAmount,
      },
    });
  }
}

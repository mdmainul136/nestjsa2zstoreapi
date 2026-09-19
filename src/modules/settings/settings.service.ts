import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  /**
   * ১. জেনারেল স্টোর সেটিংস আনা (Public Store Info)
   */
  async getStoreSettings() {
    let settings = await this.prisma.storeSetting.findFirst();
    if (!settings) {
      settings = await this.prisma.storeSetting.create({
        data: {
          storeName: 'A2Z Outlet Store',
          tagline: 'Shop Global, Delivered Local',
          defaultCurrency: 'BDT',
          baseCurrency: 'USD',
          currencySymbol: '৳',
          supportEmail: 'support@a2zoutletstore.com',
          supportPhone: '+8801700000000',
        },
      });
    }
    return settings;
  }

  /**
   * ২. জেনারেল স্টোর সেটিংস আপডেট (Admin Only)
   */
  async updateStoreSettings(data: any) {
    const current = await this.getStoreSettings();
    return this.prisma.storeSetting.update({
      where: { id: current.id },
      data,
    });
  }

  /**
   * ৩. অ্যাক্টিভ পেমেন্ট গেটওয়ে তালিকা আনা (Public for Checkout)
   * সংবেদনশীল এপিআই কি ফিল্টার করে শুধু অ্যাক্টিভ মেথডগুলো রিটার্ন করে
   */
  async getPaymentGateways() {
    let config = await this.prisma.paymentGatewaySetting.findFirst();
    if (!config) {
      config = await this.prisma.paymentGatewaySetting.create({ data: {} });
    }
    return config;
  }

  async getPublicPaymentMethods() {
    const config = await this.prisma.paymentGatewaySetting.findFirst();
    return {
      bkash: {
        isActive: config?.isBkashActive ?? true,
        feePct: config?.bkashFeePct ?? 1.5,
      },
      nagad: {
        isActive: config?.isNagadActive ?? true,
        feePct: config?.nagadFeePct ?? 1.5,
      },
      sslcommerz: { isActive: config?.isSslcommerzActive ?? false },
      stripe: { isActive: config?.isStripeActive ?? true },
      uddoktapay: { isActive: config?.isUddoktapayActive ?? false },
      cod: {
        isActive: config?.isCodActive ?? true,
        maxAmount: config?.codMaxAmount ?? 10000,
      },
    };
  }

  /**
   * ৪. পেমেন্ট গেটওয়ে সম্পূর্ণ ক্রেডেনশিয়াল আপডেট (Admin Only)
   */
  async updatePaymentGateways(data: any) {
    let config = await this.prisma.paymentGatewaySetting.findFirst();
    if (!config) {
      config = await this.prisma.paymentGatewaySetting.create({ data: {} });
    }
    return this.prisma.paymentGatewaySetting.update({
      where: { id: config.id },
      data,
    });
  }

  /**
   * ৫. স্টোরফ্রন্ট সম্পূর্ণ সিএমএস কন্টেন্ট আনা (Next.js SSR এর জন্য)
   * থিম কালার, হিরো ব্যানার, হেডার মেনু ও ফুটার
   * StoreSetting থেকে কেন্দ্রীয় ব্র্যান্ডিং, ফোন, ইমেইল ও সোশ্যাল হ্যান্ডেল অটো-মার্জ করা হয়
   */
  async getCmsContent() {
    let cms = await this.prisma.cmsSetting.findFirst();
    if (!cms) {
      // ডিফল্ট সিএমএস তৈরি (যদি না থাকে)
      cms = await this.prisma.cmsSetting.create({
        data: {
          siteConfig: {
            name: 'A2Z Outlet Store',
            primaryColor: '#00AB55',
            accentColor: '#FFC107',
            currency: 'BDT',
            currencySymbol: '৳',
          },
          headerConfig: {
            topBarEnabled: true,
            topBarText: '🚀 ফ্রি ডেলিভারি পাচ্ছেন ৫০০০ টাকার উপরের অর্ডারে!',
            supportPhone: '+8801700000000',
            searchPlaceholder: 'আমাজন, ওয়ালমার্ট বা ব্র্যান্ডের পণ্য খুঁজুন...',
          },
          heroConfig: {
            enabled: true,
            slides: [
              {
                id: 1,
                title: 'আমাজনের আসল পণ্য এখন আপনার দরজায়',
                subtitle:
                  '১০০% অরিজিনাল ইউএসএ ব্র্যান্ডস সরাসরি বাংলাদেশে ৭ দিনে ডেলিভারি',
                buttonText: 'এখনই শপ করুন',
                buttonHref: '/shop',
                imageUrl:
                  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200',
              },
            ],
          },
          homepageConfig: {
            sectionOrder: [
              'hero',
              'categories',
              'features',
              'flash_deals',
              'new_arrivals',
              'banners',
              'best_sellers',
              'newsletter',
            ],
            flashSaleEnabled: true,
            featuredCategoriesEnabled: true,
          },
          footerConfig: {
            description: "A2Z Outlet Store is Bangladesh's #1 trusted crossborder shopping platform delivering authentic products from Amazon, Walmart, and USA retail outlets directly to your doorstep.",
            copyrightText: '© 2026 A2Z Outlet Store. All rights reserved. Crossborder delivery operated under Bangladesh Trade License.',
            phone: '+8801700000000',
            email: 'support@a2zoutletstore.com',
            showAppStore: true,
            showGooglePlay: true,
            appStoreLink: 'https://apple.com/app-store',
            googlePlayLink: 'https://play.google.com/store',
          },
        },
      });
    }

    // কেন্দ্রীয় StoreSetting থেকে ব্র্যান্ড পরিচিতি, কন্টাক্ট ও সোশ্যাল লিঙ্ক মার্জ করা (Single Source of Truth)
    const store = await this.getStoreSettings();

    const currentSite = (typeof cms.siteConfig === 'object' && cms.siteConfig) ? (cms.siteConfig as any) : {};
    const currentHeader = (typeof cms.headerConfig === 'object' && cms.headerConfig) ? (cms.headerConfig as any) : {};
    const currentFooter = (typeof cms.footerConfig === 'object' && cms.footerConfig) ? (cms.footerConfig as any) : {};

    const mergedSiteConfig = {
      ...currentSite,
      name: store?.storeName || currentSite.name || 'A2Z Outlet Store',
      tagline: store?.tagline || currentSite.tagline || 'Shop Global, Delivered Local',
      logo: store?.logoUrl || currentSite.logo || '',
      logoWhite: store?.logoWhiteUrl || currentSite.logoWhite || '',
      favicon: store?.faviconUrl || currentSite.favicon || '',
      currency: store?.defaultCurrency || currentSite.currency || 'BDT',
      currencySymbol: store?.currencySymbol || currentSite.currencySymbol || '৳',
      language: store?.defaultLanguage || currentSite.language || 'bn',
    };

    const mergedHeaderConfig = {
      ...currentHeader,
      supportPhone: store?.supportPhone || currentHeader.supportPhone || '+8801700000000',
      whatsappNumber: store?.whatsappNumber || currentHeader.whatsappNumber || '',
    };

    const mergedFooterConfig = {
      ...currentFooter,
      aboutTitle: currentFooter.aboutTitle || 'About',
      accountTitle: currentFooter.accountTitle || 'My Account',
      categoryTitle: currentFooter.categoryTitle || 'Categories',
      contactTitle: currentFooter.contactTitle || 'Contact Information',
      copyrightText: currentFooter.copyrightText || '© 2026 A2Z Outlet Store. All rights reserved. Crossborder delivery operated under Bangladesh Trade License.',
      address: store?.officeAddress || currentFooter.address || currentFooter.officeAddress || 'Suite 402, Road 11, Banani, Dhaka-1213, Bangladesh',
      phone: store?.supportPhone || currentFooter.phone || '+8801700000000',
      email: store?.supportEmail || currentFooter.email || 'support@a2zoutletstore.com',
      whatsapp: store?.whatsappNumber || currentFooter.whatsapp || '+8801700000000',
      showAppStore: currentFooter.showAppStore !== undefined ? currentFooter.showAppStore : true,
      showGooglePlay: currentFooter.showGooglePlay !== undefined ? currentFooter.showGooglePlay : true,
      appStoreLink: currentFooter.appStoreLink || 'https://apple.com/app-store',
      googlePlayLink: currentFooter.googlePlayLink || 'https://play.google.com/store',
      socialLinks: {
        facebook: store?.facebookUrl || currentFooter.socialLinks?.facebook || 'https://facebook.com/a2zoutlet',
        instagram: store?.instagramUrl || currentFooter.socialLinks?.instagram || 'https://instagram.com/a2zoutlet',
        youtube: store?.youtubeUrl || currentFooter.socialLinks?.youtube || 'https://youtube.com/@a2zoutlet',
        tiktok: store?.tiktokUrl || currentFooter.socialLinks?.tiktok || 'https://tiktok.com/@a2zoutlet',
      },
      aboutLinks: Array.isArray(currentFooter.aboutLinks) && currentFooter.aboutLinks.length > 0
        ? currentFooter.aboutLinks
        : [
            { label: 'About Us', href: '/about' },
            { label: 'Contact Us', href: '/contact' },
            { label: 'Privacy Policy', href: '/privacy-policy' },
            { label: 'Terms & Conditions', href: '/terms-and-conditions' },
            { label: 'Return & Refund Policy', href: '/return-policy' },
            { label: 'FAQ & Help Center', href: '/faq' },
          ],
      accountLinks: Array.isArray(currentFooter.accountLinks) && currentFooter.accountLinks.length > 0
        ? currentFooter.accountLinks
        : [
            { label: 'My Account', href: '/my-account' },
            { label: 'Track Order', href: '/track-order' },
            { label: 'Wishlist', href: '/wishlist' },
            { label: 'Shipping Calculator', href: '/shipping-calculator' },
            { label: 'Request a Quote (RFQ)', href: '/request-quote' },
            { label: 'Compare Products', href: '/compare' },
          ],
      categoryLinks: Array.isArray(currentFooter.categoryLinks) && currentFooter.categoryLinks.length > 0
        ? currentFooter.categoryLinks
        : [
            { label: 'Amazon USA Store', href: '/shop?source=amazon' },
            { label: 'Walmart Deals', href: '/shop?source=walmart' },
            { label: 'Best Sellers', href: '/shop?badge=bestseller' },
            { label: 'Flash Deals', href: '/shop?badge=flashdeal' },
            { label: 'USA Fashion & Apparel', href: '/shop?category=fashion' },
            { label: 'Electronics & Gadgets', href: '/shop?category=electronics' },
          ],
    };

    return {
      ...cms,
      siteConfig: mergedSiteConfig,
      headerConfig: mergedHeaderConfig,
      footerConfig: mergedFooterConfig,
    };
  }

  /**
   * ৬. সিএমএস কন্টেন্ট আপডেট করা (Admin Only)
   */
  async updateCmsContent(data: any) {
    const current = await this.prisma.cmsSetting.findFirst();
    if (!current) {
      await this.getCmsContent();
    }
    const targetId = current ? current.id : (await this.prisma.cmsSetting.findFirst())?.id;
    return this.prisma.cmsSetting.update({
      where: { id: targetId },
      data,
    });
  }

  /**
   * ৭. লোকাল কুরিয়ার গেটওয়ে কনফিগ আনা ও আপডেট (Pathao, Steadfast)
   */
  async getCourierConfigs() {
    return this.prisma.courierGatewayConfig.findMany();
  }

    async updateCourierConfig(provider: string, data: any) {
    const { id, updatedAt, createdAt, ...cleanData } = data || {};
    const prov = provider.toLowerCase();
    return this.prisma.courierGatewayConfig.upsert({
      where: { provider: prov },
      update: cleanData,
      create: { provider: prov, ...cleanData },
    });
  }


  /**
   * ৮. নতুন ক্রিপ্টোগ্রাফিক API Key জেনারেশন (Admin Only)
   */
  async generateApiKey(dto?: { name?: string; scopes?: any }) {
    const safeDto = dto || {};
    let normalizedScopes = 'catalog:sync';
    if (Array.isArray(safeDto.scopes)) {
      normalizedScopes = safeDto.scopes.filter(Boolean).join(',') || 'catalog:sync';
    } else if (typeof safeDto.scopes === 'string' && safeDto.scopes.trim()) {
      normalizedScopes = safeDto.scopes.trim();
    }
    // 32-byte secure random secret
    const rawSecret = 'sk_live_a2z_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawSecret).digest('hex');
    const keyPrefix = rawSecret.substring(0, 16) + '...';

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: safeDto.name || 'Chrome Extension Key',
        keyHash,
        keyPrefix,
        scopes: normalizedScopes,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        createdAt: true,
      },
    });

    return {
      success: true,
      message: 'API Key successfully generated! Please copy it now as it will not be shown again.',
      apiKey: rawSecret, // শুধুমাত্র এই একবারই ফুল কি দেখানো হবে
      details: apiKey,
    };
  }

  /**
   * ৯. সব API Key তালিকা দেখা (Admin Only)
   */
  async getApiKeys() {
    return this.prisma.apiKey.findMany({
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * ১০. API Key রিভোক / ডিঅ্যাক্টিভ করা (Admin Only)
   */
  async revokeApiKey(id: string) {
    const key = await this.prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
      select: { id: true, name: true, keyPrefix: true, isActive: true },
    });
    return {
      success: true,
      message: 'API Key revoked successfully!',
      key,
    };
  }

  /**
   * ১১. API Key চিরতরে ডাটাবেস থেকে ডিলিট করা
   */
  async deleteApiKey(id: string) {
    const deleted = await this.prisma.apiKey.delete({
      where: { id },
      select: { id: true, name: true, keyPrefix: true },
    });
    return {
      success: true,
      message: 'API Key permanently deleted!',
      key: deleted,
    };
  }


  /**
   * ১২. AI ইঞ্জিন ও এলএলএম সেটিংস পাওয়া
   */
  async getAiSettings() {
    const settings = await this.prisma.systemSetting.findMany({
      where: { category: 'ai' },
    });
    const map: Record<string, any> = {};
    settings.forEach((s) => {
      try {
        map[s.key] = JSON.parse(s.value);
      } catch {
        map[s.key] = s.value;
      }
    });

    return {
      provider: map['ai_default_provider'] || 'gemini',
      defaultModel: map['ai_default_model'] || 'gemini-2.0-flash',
      temperature: map['ai_temperature'] !== undefined ? Number(map['ai_temperature']) : 0.7,
      geminiApiKey: map['ai_gemini_api_key'] || '',
      openaiApiKey: map['ai_openai_api_key'] || '',
      claudeApiKey: map['ai_claude_api_key'] || '',
      autoTranslate: map['ai_auto_translate'] !== undefined ? (map['ai_auto_translate'] === true || map['ai_auto_translate'] === 'true') : true,
      autoSeo: map['ai_auto_seo'] !== undefined ? (map['ai_auto_seo'] === true || map['ai_auto_seo'] === 'true') : true,
      autoHsCode: map['ai_auto_hs_code'] !== undefined ? (map['ai_auto_hs_code'] === true || map['ai_auto_hs_code'] === 'true') : true,
      autoEnrichOnScrape: map['ai_auto_enrich_on_scrape'] !== undefined ? (map['ai_auto_enrich_on_scrape'] === true || map['ai_auto_enrich_on_scrape'] === 'true') : true,
    };
  }

  /**
   * ১৩. AI সেটিংস আপডেট করা
   */
  async updateAiSettings(data: any) {
    const entries = [
      ['ai_default_provider', data.provider || 'gemini'],
      ['ai_default_model', data.defaultModel || 'gemini-2.0-flash'],
      ['ai_temperature', data.temperature !== undefined ? Number(data.temperature) : 0.7],
      ['ai_gemini_api_key', data.geminiApiKey || ''],
      ['ai_openai_api_key', data.openaiApiKey || ''],
      ['ai_claude_api_key', data.claudeApiKey || ''],
      ['ai_auto_translate', !!data.autoTranslate],
      ['ai_auto_seo', !!data.autoSeo],
      ['ai_auto_hs_code', !!data.autoHsCode],
      ['ai_auto_enrich_on_scrape', !!data.autoEnrichOnScrape],
    ];

    for (const [key, val] of entries) {
      const strVal = String(val);
      await this.prisma.systemSetting.upsert({
        where: { key },
        update: { value: strVal, category: 'ai' },
        create: { key, value: strVal, category: 'ai' },
      });
    }

    return this.getAiSettings();
  }

  /**
   * ১৪. Auth ও সোশ্যাল লগইন সেটিংস পাওয়া
   */
  async getAuthSettings() {
    const settings = await this.prisma.systemSetting.findMany({
      where: { category: 'auth' },
    });
    const map: Record<string, any> = {};
    settings.forEach((s) => {
      try {
        map[s.key] = JSON.parse(s.value);
      } catch {
        map[s.key] = s.value;
      }
    });

    return {
      isGoogleActive: map['auth_google_active'] === 'true' || map['auth_google_active'] === true,
      googleClientId: map['auth_google_client_id'] || '',
      googleClientSecret: map['auth_google_client_secret'] || '',
      googleCallbackUrl: map['auth_google_callback_url'] || 'http://localhost:5001/api/auth/google/callback',

      isFacebookActive: map['auth_facebook_active'] === 'true' || map['auth_facebook_active'] === true,
      facebookAppId: map['auth_facebook_app_id'] || '',
      facebookAppSecret: map['auth_facebook_app_secret'] || '',
      facebookCallbackUrl: map['auth_facebook_callback_url'] || 'http://localhost:5001/api/auth/facebook/callback',

      isAppleActive: map['auth_apple_active'] === 'true' || map['auth_apple_active'] === true,
      appleServiceId: map['auth_apple_service_id'] || '',
      appleTeamId: map['auth_apple_team_id'] || '',
      appleKeyId: map['auth_apple_key_id'] || '',
      applePrivateKey: map['auth_apple_private_key'] || '',

      allowRegistration: map['auth_allow_registration'] !== undefined ? (map['auth_allow_registration'] === 'true' || map['auth_allow_registration'] === true) : true,
      requireEmailVerification: map['auth_require_email_verification'] === 'true' || map['auth_require_email_verification'] === true,
      enable2fa: map['auth_enable_2fa'] === 'true' || map['auth_enable_2fa'] === true,
      sessionExpiryDays: map['auth_session_expiry_days'] ? Number(map['auth_session_expiry_days']) : 30,
    };
  }

  /**
   * ১৫. Auth ও সোশ্যাল লগইন সেটিংস আপডেট করা
   */
  async updateAuthSettings(data: any) {
    const entries = [
      ['auth_google_active', !!data.isGoogleActive],
      ['auth_google_client_id', data.googleClientId || ''],
      ['auth_google_client_secret', data.googleClientSecret || ''],
      ['auth_google_callback_url', data.googleCallbackUrl || 'http://localhost:5001/api/auth/google/callback'],

      ['auth_facebook_active', !!data.isFacebookActive],
      ['auth_facebook_app_id', data.facebookAppId || ''],
      ['auth_facebook_app_secret', data.facebookAppSecret || ''],
      ['auth_facebook_callback_url', data.facebookCallbackUrl || 'http://localhost:5001/api/auth/facebook/callback'],

      ['auth_apple_active', !!data.isAppleActive],
      ['auth_apple_service_id', data.appleServiceId || ''],
      ['auth_apple_team_id', data.appleTeamId || ''],
      ['auth_apple_key_id', data.appleKeyId || ''],
      ['auth_apple_private_key', data.applePrivateKey || ''],

      ['auth_allow_registration', data.allowRegistration !== undefined ? !!data.allowRegistration : true],
      ['auth_require_email_verification', !!data.requireEmailVerification],
      ['auth_enable_2fa', !!data.enable2fa],
      ['auth_session_expiry_days', Number(data.sessionExpiryDays) || 30],
    ];

    for (const [key, val] of entries) {
      const strVal = String(val);
      await this.prisma.systemSetting.upsert({
        where: { key },
        update: { value: strVal, category: 'auth' },
        create: { key, value: strVal, category: 'auth' },
      });
    }

    return this.getAuthSettings();
  }

  /**
   * ১৬. নোটিফিকেশন ও SMTP গেটওয়ে সেটিংস আনা
   */
  async getNotificationSettings() {
    let settings = await this.prisma.notificationSetting.findFirst();
    if (!settings) {
      settings = await this.prisma.notificationSetting.create({
        data: {
          smtpHost: 'smtp.sendgrid.net',
          smtpPort: 587,
          smtpUser: 'apikey',
          smtpPassword: '',
          senderEmail: 'orders@a2zoutletstore.com',
          senderName: 'A2Z Crossborder Operations',
          isSmtpActive: true,
          smsProvider: 'greenweb',
          smsApiKey: '',
          smsSenderId: 'A2ZOUTLET',
          isSmsActive: true,
          isWhatsappActive: false,
          sendOrderPlacedSms: true,
          sendOrderShippedSms: true,
          sendDeliverySms: true,
          sendAuthVerifyEmail: true,
          sendWelcomeEmail: true,
          sendPasswordResetEmail: true,
          sendOrderPlacedEmail: true,
          sendPaymentSuccessEmail: true,
          sendOrderShippedEmail: true,
          sendOutForDeliveryEmail: true,
          sendOrderDeliveredEmail: true,
          sendOrderCancelledEmail: true,
          sendAbandonedCartEmail: true,
          sendPriceDropEmail: true,
          sendAdminNewOrderAlert: true,
          adminNotificationEmail: 'admin@a2zoutletstore.com',
        },
      });
    }
    return settings;
  }

  /**
   * ১৭. নোটিফিকেশন ও SMTP গেটওয়ে সেটিংস আপডেট করা
   */
  async updateNotificationSettings(data: any) {
    const current = await this.getNotificationSettings();
    return this.prisma.notificationSetting.update({
      where: { id: current.id },
      data: {
        smtpHost: data.smtpHost,
        smtpPort: data.smtpPort ? Number(data.smtpPort) : 587,
        smtpUser: data.smtpUser,
        smtpPassword: data.smtpPassword !== undefined && data.smtpPassword !== '' ? data.smtpPassword : current.smtpPassword,
        senderEmail: data.senderEmail || 'orders@a2zoutletstore.com',
        senderName: data.senderName || 'A2Z Crossborder Operations',
        isSmtpActive: data.isSmtpActive !== undefined ? !!data.isSmtpActive : true,
        smsProvider: data.smsProvider || 'greenweb',
        smsApiKey: data.smsApiKey !== undefined && data.smsApiKey !== '' ? data.smsApiKey : current.smsApiKey,
        smsSenderId: data.smsSenderId || 'A2ZOUTLET',
        isSmsActive: data.isSmsActive !== undefined ? !!data.isSmsActive : true,
        isWhatsappActive: data.isWhatsappActive !== undefined ? !!data.isWhatsappActive : false,
        whatsappApiKey: data.whatsappApiKey || current.whatsappApiKey,
        whatsappPhoneNumber: data.whatsappPhoneNumber || current.whatsappPhoneNumber,
        sendOrderPlacedSms: data.sendOrderPlacedSms !== undefined ? !!data.sendOrderPlacedSms : true,
        sendOrderShippedSms: data.sendOrderShippedSms !== undefined ? !!data.sendOrderShippedSms : true,
        sendDeliverySms: data.sendDeliverySms !== undefined ? !!data.sendDeliverySms : true,

        // Email Triggers
        sendAuthVerifyEmail: data.sendAuthVerifyEmail !== undefined ? !!data.sendAuthVerifyEmail : true,
        sendWelcomeEmail: data.sendWelcomeEmail !== undefined ? !!data.sendWelcomeEmail : true,
        sendPasswordResetEmail: data.sendPasswordResetEmail !== undefined ? !!data.sendPasswordResetEmail : true,
        sendOrderPlacedEmail: data.sendOrderPlacedEmail !== undefined ? !!data.sendOrderPlacedEmail : true,
        sendPaymentSuccessEmail: data.sendPaymentSuccessEmail !== undefined ? !!data.sendPaymentSuccessEmail : true,
        sendOrderShippedEmail: data.sendOrderShippedEmail !== undefined ? !!data.sendOrderShippedEmail : true,
        sendOutForDeliveryEmail: data.sendOutForDeliveryEmail !== undefined ? !!data.sendOutForDeliveryEmail : true,
        sendOrderDeliveredEmail: data.sendOrderDeliveredEmail !== undefined ? !!data.sendOrderDeliveredEmail : true,
        sendOrderCancelledEmail: data.sendOrderCancelledEmail !== undefined ? !!data.sendOrderCancelledEmail : true,
        sendAbandonedCartEmail: data.sendAbandonedCartEmail !== undefined ? !!data.sendAbandonedCartEmail : true,
        sendPriceDropEmail: data.sendPriceDropEmail !== undefined ? !!data.sendPriceDropEmail : true,
        sendAdminNewOrderAlert: data.sendAdminNewOrderAlert !== undefined ? !!data.sendAdminNewOrderAlert : true,
        adminNotificationEmail: data.adminNotificationEmail || current.adminNotificationEmail || 'admin@a2zoutletstore.com',
      },
    });
  }

  /**
   * ১৮. টেস্ট ইমেইল পাঠানো
   */
  async sendTestEmail(recipientEmail: string) {
    const config = await this.getNotificationSettings();
    if (!recipientEmail) {
      throw new Error('Recipient email is required.');
    }

    const testHtml = `
<div style="font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; background: #18181b; color: #f4f4f5; padding: 32px; border-radius: 12px; border: 1px solid #27272a;">
  <h2 style="color: #10b981; margin: 0 0 12px 0;">A2Z Outlet Store — SMTP Handshake Test 🚀</h2>
  <p style="color: #d4d4d8; font-size: 14px; line-height: 1.6;">Congratulations! Your SMTP Mail Server integration is active and working properly.</p>
  <div style="background: #09090b; padding: 16px; border-radius: 8px; border: 1px solid #27272a; margin: 20px 0; font-size: 13px; font-family: monospace;">
    <p style="margin: 0 0 6px 0; color: #a1a1aa;"><strong>Host:</strong> ${config.smtpHost || 'smtp.sendgrid.net'}:${config.smtpPort || 587}</p>
    <p style="margin: 0 0 6px 0; color: #a1a1aa;"><strong>Sender:</strong> ${config.senderEmail || 'orders@a2zoutletstore.com'}</p>
    <p style="margin: 0; color: #10b981;"><strong>Status:</strong> Handshake Verified</p>
  </div>
  <p style="font-size: 12px; color: #71717a; margin: 0;">Dispatched on: ${new Date().toISOString()}</p>
</div>`.trim();

    return this.mailService.sendMail({
      to: recipientEmail,
      subject: `[A2Z TEST] SMTP Server Handshake Verification`,
      html: testHtml,
      templateCode: 'TEST_EMAIL',
      senderName: config.senderName,
      senderEmail: config.senderEmail,
    });
  }

  /**
   * ১৯. ইমেইল টেমপ্লেট লাইব্রেরি পাওয়া (Seeds defaults if empty)
   */
  async getEmailTemplates() {
    let templates = await this.prisma.emailTemplate.findMany({
      orderBy: { createdAt: 'asc' },
    });

    if (templates.length === 0) {
      const defaultTemplates = [
        {
          code: 'AUTH_VERIFY_EMAIL',
          name: 'Customer Registration OTP Verification',
          subject: 'Your A2Z Outlet Verification Code: {{otp}} 🔒',
          bodyHtml: `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #18181b; color: #f4f4f5; padding: 32px; border-radius: 12px; border: 1px solid #27272a;">
  <h2 style="color: #10b981; margin: 0 0 16px 0;">Verify Your Email Address</h2>
  <p style="color: #d4d4d8; font-size: 14px; line-height: 1.6;">Hello <strong>{{customerName}}</strong>,<br>Use the 6-digit one-time code below to activate your A2Z crossborder account:</p>
  <div style="background: #09090b; border: 1px dashed #10b981; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
    <span style="font-size: 32px; font-family: monospace; font-weight: bold; letter-spacing: 8px; color: #ffffff;">{{otp}}</span>
    <p style="margin: 8px 0 0 0; font-size: 12px; color: #71717a;">Valid for 5 minutes only</p>
  </div>
</div>`.trim(),
          variables: ['customerName', 'otp', 'expiryMinutes'],
          senderName: 'A2Z Security',
          senderEmail: 'security@a2zoutletstore.com',
          isActive: true,
        },
        {
          code: 'AUTH_FORGOT_PASSWORD',
          name: 'Account Password Reset Link',
          subject: 'Reset your A2Z Outlet Password 🔑',
          bodyHtml: `
<div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; background: #18181b; color: #f4f4f5; padding: 32px; border-radius: 12px; border: 1px solid #27272a;">
  <h2 style="color: #ef4444; margin: 0 0 16px 0;">Password Reset Request</h2>
  <p style="color: #d4d4d8; font-size: 14px; line-height: 1.6;">Hi <strong>{{customerName}}</strong>,<br>Click below to securely reset your account password:</p>
  <div style="text-align: center; margin: 24px 0;">
    <a href="{{resetUrl}}" style="background: #ef4444; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Reset Password</a>
  </div>
</div>`.trim(),
          variables: ['customerName', 'resetToken', 'resetUrl'],
          senderName: 'A2Z Security',
          senderEmail: 'security@a2zoutletstore.com',
          isActive: true,
        },
        {
          code: 'ORDER_CONFIRMATION',
          name: 'Order Confirmation & Invoice',
          subject: 'Your A2Z Order #{{orderNumber}} has been Confirmed! ✈️',
          bodyHtml: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e4e4e7;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h1 style="color: #059669; margin: 0;">A2Z Outlet Store</h1>
    <p style="color: #71717a; font-size: 14px; margin: 4px 0 0 0;">Crossborder Shopping Delivered to Bangladesh</p>
  </div>
  <p style="color: #18181b; font-size: 16px;">Dear <strong>{{customerName}}</strong>,</p>
  <p style="color: #3f3f46; font-size: 14px; line-height: 1.6;">Thank you for shopping with A2Z! Your crossborder order <strong>#{{orderNumber}}</strong> has been confirmed and forwarded to our US warehouse hub.</p>
  <div style="background: #f4f4f5; padding: 16px; border-radius: 6px; margin: 20px 0;">
    <p style="margin: 0 0 8px 0; font-size: 14px; color: #18181b;"><strong>Total Amount:</strong> ৳ {{totalAmount}} BDT</p>
    <p style="margin: 0; font-size: 14px; color: #18181b;"><strong>Shipping Method:</strong> Express Air Freight (USA ➔ BD)</p>
  </div>
  <div style="text-align: center; margin-top: 24px;">
    <a href="{{trackingUrl}}" style="background: #059669; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Track Your Parcel Live</a>
  </div>
</div>`.trim(),
          variables: ['customerName', 'orderNumber', 'totalAmount', 'trackingUrl'],
          senderName: 'A2Z Orders',
          senderEmail: 'orders@a2zoutletstore.com',
          isActive: true,
        },
        {
          code: 'ORDER_DISPATCHED',
          name: 'Air Dispatch & Courier Handover',
          subject: 'Your Crossborder Parcel is on its way! 📦 Tracking #{{trackingNumber}}',
          bodyHtml: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e4e4e7;">
  <h2 style="color: #0284c7;">Your Parcel has been Dispatched! 🚀</h2>
  <p style="color: #3f3f46; font-size: 14px;">Hi {{customerName}}, your shipment for Order #{{orderNumber}} has cleared customs and is now with our delivery partner ({{courierName}}).</p>
  <p style="font-size: 14px; color: #18181b;">Air Waybill / Tracking ID: <strong>{{trackingNumber}}</strong></p>
  <div style="margin-top: 20px;">
    <a href="{{trackingUrl}}" style="background: #0284c7; color: #ffffff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">View Live Flight Status</a>
  </div>
</div>`.trim(),
          variables: ['customerName', 'orderNumber', 'courierName', 'trackingNumber', 'trackingUrl'],
          senderName: 'A2Z Logistics',
          senderEmail: 'logistics@a2zoutletstore.com',
          isActive: true,
        },
        {
          code: 'CART_ABANDONED_RECOVERY',
          name: 'Abandoned Cart Recovery & Special Promo',
          subject: 'You left something special behind! Here is an exclusive 10% coupon 🎁',
          bodyHtml: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e4e4e7;">
  <h2 style="color: #7c3aed;">Still thinking about your wishlist items? ✨</h2>
  <p style="color: #3f3f46; font-size: 14px;">Hi {{customerName}}, your favorite US marketplace items in cart <strong>({{itemCount}} items)</strong> are waiting for you.</p>
  <div style="background: #faf5ff; border: 1px dashed #c084fc; padding: 16px; border-radius: 8px; text-align: center; margin: 20px 0;">
    <p style="margin: 0 0 4px 0; font-size: 12px; color: #6b21a8; text-transform: uppercase; font-weight: bold;">Use Special Recovery Voucher</p>
    <h3 style="margin: 0; color: #7c3aed; font-size: 24px; font-family: monospace;">{{couponCode}}</h3>
    <p style="margin: 4px 0 0 0; font-size: 12px; color: #71717a;">Valid for the next 24 hours only</p>
  </div>
  <div style="text-align: center;">
    <a href="{{checkoutUrl}}" style="background: #7c3aed; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; display: inline-block;">Complete Your Order Now</a>
  </div>
</div>`.trim(),
          variables: ['customerName', 'itemCount', 'couponCode', 'checkoutUrl'],
          senderName: 'A2Z Rewards',
          senderEmail: 'promotions@a2zoutletstore.com',
          isActive: true,
        },
        {
          code: 'WELCOME_DISCOUNT',
          name: 'New Customer Welcome Voucher',
          subject: 'Welcome to A2Z Outlet! Claim ৳500 off on your first global order 🎉',
          bodyHtml: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; padding: 24px; border-radius: 8px; border: 1px solid #e4e4e7;">
  <h2 style="color: #059669;">Welcome to the Global Shopping Family! 🌍</h2>
  <p style="color: #3f3f46; font-size: 14px;">Shop directly from Amazon US, Walmart, Sephora, Nike & eBay with all-inclusive landed pricing delivered to your doorstep in Dhaka and across Bangladesh.</p>
  <div style="background: #ecfdf5; border: 1px dashed #34d399; padding: 16px; border-radius: 8px; text-align: center; margin: 20px 0;">
    <p style="margin: 0 0 4px 0; font-size: 12px; color: #065f46; font-weight: bold;">YOUR FIRST ORDER COUPON</p>
    <h3 style="margin: 0; color: #059669; font-size: 24px; font-family: monospace;">WELCOME500</h3>
  </div>
</div>`.trim(),
          variables: ['customerName', 'couponCode', 'shopUrl'],
          senderName: 'A2Z Outlet',
          senderEmail: 'welcome@a2zoutletstore.com',
          isActive: true,
        },
      ];

      for (const t of defaultTemplates) {
        await this.prisma.emailTemplate.create({ data: t });
      }

      templates = await this.prisma.emailTemplate.findMany({
        orderBy: { createdAt: 'asc' },
      });
    }

    return templates;
  }

  /**
   * ২০. ইমেইল টেমপ্লেট আপডেট
   */
  async updateEmailTemplate(id: string, data: any) {
    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        name: data.name,
        subject: data.subject,
        bodyHtml: data.bodyHtml,
        bodyText: data.bodyText,
        senderName: data.senderName,
        senderEmail: data.senderEmail,
        isActive: data.isActive !== undefined ? !!data.isActive : true,
        variables: data.variables,
      },
    });
  }

  /**
   * ২১. নতুন ইমেইল টেমপ্লেট তৈরি
   */
  async createEmailTemplate(data: any) {
    return this.prisma.emailTemplate.create({
      data: {
        code: data.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
        name: data.name,
        subject: data.subject,
        bodyHtml: data.bodyHtml,
        bodyText: data.bodyText,
        senderName: data.senderName || 'A2Z Outlet',
        senderEmail: data.senderEmail || 'orders@a2zoutletstore.com',
        variables: data.variables || [],
        isActive: data.isActive !== undefined ? !!data.isActive : true,
      },
    });
  }

  /**
   * ২২. ইমেইল টেমপ্লেট মুছে ফেলা
   */
  async deleteEmailTemplate(id: string) {
    return this.prisma.emailTemplate.delete({
      where: { id },
    });
  }

  /**
   * ২৩. নোটিফিকেশন অডিট লগ্স দেখা
   */
  async getNotificationLogs(limit: number = 50) {
    return this.prisma.notificationLog.findMany({
      take: limit,
      orderBy: { sentAt: 'desc' },
      include: {
        emailTemplate: { select: { name: true, code: true } },
        smsTemplate: { select: { name: true, code: true } },
      },
    });
  }
}


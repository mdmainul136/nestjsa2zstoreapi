import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GoogleGenAI } from '@google/genai';

export interface PriceBreakdownResult {
  success?: boolean;
  breakdown?: PriceBreakdownResult;
  sourcePriceUsd: number;
  weightKg: number;
  exchangeRate: number;
  basePriceBdt: number;
  airRatePerKgUsd: number;
  internationalAirFreightUsd: number;
  internationalAirFreightBdt: number;
  dutyPct: number;
  customsTaxBdt: number;
  profitMarginPct: number;
  profitMarginBdt: number;
  finalSellingPriceBdt: number;
  finalSellingPriceUsd: number;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private aiClient: GoogleGenAI | null = null;

  constructor(private readonly prisma: PrismaService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.aiClient = new GoogleGenAI({ apiKey });
    }
  }

  /**
   * ১. এআই ইঞ্জিন ওভারভিউ ও হেলথ মেট্রিক্স
   */
  async getOverview() {
    const [totalProducts, totalVariants, seoCount, recentLogs, pendingScrapedCount] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.variant.count(),
      this.prisma.seoMetadata.count({ where: { aiOptimized: true } }),
      (this.prisma as any).productEnrichmentLog.findMany({
        take: 12,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: { title: true, slug: true },
          },
        },
      }),
      (this.prisma as any).rawScrapedItem.count({
        where: { status: { in: ['scraped', 'pending', 'draft', 'raw', 'ready'] } },
      }),
    ]);

    const rate = await this.prisma.currencyExchangeRate.findFirst({
      where: { sourceCurrency: 'USD', targetCurrency: 'BDT' },
    });

    return {
      success: true,
      metrics: {
        totalProducts,
        totalVariants,
        aiEnrichedProducts: seoCount,
        seoOptimizedCount: seoCount,
        pendingEnrichment: Math.max(0, totalProducts - seoCount),
        pendingScrapedCount: pendingScrapedCount || 0,
        exchangeRate: rate?.rate || 139.91,
        exchangeRateUsdToBdt: rate?.rate || 139.91,
        aiModel: 'Gemini 2.0 Flash / Cross-Border Copywriting Engine',
        geminiActive: !!this.aiClient,
      },
      recentLogs,
    };
  }

  /**
   * Helper: Smart weight string parser
   */
  private parseWeightStringToKg(text: any): number | null {
    if (!text) return null;
    const str = String(text).trim();

    if (/^\d+(?:\.\d+)?$/.test(str)) {
      const num = parseFloat(str);
      if (num >= 0.01 && num <= 50) return num;
    }

    let packCount = 1;
    const packMatch = str.match(/(?:pack\s*of\s*(\d+)|(\d+)\s*[-–]?\s*pack|\((\d+)\s*pack\)|(\d+)\s*x\s*\d+)/i);
    if (packMatch) {
      packCount = parseInt(packMatch[1] || packMatch[2] || packMatch[3] || packMatch[4] || '1', 10);
      if (packCount < 1 || packCount > 24) packCount = 1;
    }

    const lbMatch = str.match(/(\d*\.?\d+)\s*(?:lbs?|pounds?)\b/i);
    if (lbMatch) {
      return parseFloat((parseFloat(lbMatch[1]) * 0.453592 * packCount).toFixed(3));
    }

    const ozMatches = [...str.matchAll(/(\d*\.?\d+)\s*(?:fl\.?\s*oz|fluid\s*ounces?|ounces?|oz)\b/gi)];
    if (ozMatches.length > 0) {
      const best = ozMatches.reduce((a, b) => parseFloat(a[1]) >= parseFloat(b[1]) ? a : b);
      const ozVal = parseFloat(best[1]);
      const netKg = ozVal * 0.0283495 * packCount;
      const tare = ozVal > 16 ? 0.15 : ozVal > 8 ? 0.09 : ozVal > 4 ? 0.06 : 0.03;
      return parseFloat((netKg + tare).toFixed(3));
    }

    const kgMatch = str.match(/(\d*\.?\d+)\s*(?:kg|kilos?|kilograms?)\b/i);
    if (kgMatch) {
      return parseFloat((parseFloat(kgMatch[1]) * packCount).toFixed(3));
    }

    const mlMatch = str.match(/(\d*\.?\d+)\s*(?:ml|milliliters?)\b/i);
    if (mlMatch) {
      const netKg = (parseFloat(mlMatch[1]) / 1000) * packCount;
      const tare = netKg > 0.25 ? 0.08 : 0.04;
      return parseFloat((netKg + tare).toFixed(3));
    }

    const gMatch = str.match(/(\d*\.?\d+)\s*(?:grams?|gm)\b|(?<!\d)(\d*\.?\d+)\s*g(?!m\b)/i);
    if (gMatch) {
      const raw = parseFloat(gMatch[1] || gMatch[2] || '0');
      if (raw > 0 && raw < 5000) {
        const netKg = (raw / 1000) * packCount;
        const tare = netKg > 0.2 ? 0.05 : 0.02;
        return parseFloat((netKg + tare).toFixed(3));
      }
    }

    return null;
  }

  /**
   * Helper: Smart price_per_unit mathematical converter (Walmart/Target)
   */
  private parsePricePerUnitToKg(priceStr: any, pricePerUnitStr: any): number | null {
    if (!priceStr || !pricePerUnitStr) return null;
    const pMatch = String(priceStr).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    if (!pMatch) return null;
    const price = parseFloat(pMatch[1]);
    if (!price || price <= 0) return null;

    const ppu = String(pricePerUnitStr).trim();
    const unitMatch = ppu.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*\/\s*(lbs?|pounds?|fl\.?\s*oz|fluid\s*ounces?|oz|ounces?|kg|kilos?|grams?|gm|g)\b/i);
    if (!unitMatch) return null;

    const unitRate = parseFloat(unitMatch[1]);
    const unitName = unitMatch[2].toLowerCase();
    if (unitRate <= 0) return null;

    const totalUnits = price / unitRate;
    if (/lbs?|pounds?/i.test(unitName)) {
      return parseFloat((totalUnits * 0.453592).toFixed(3));
    }
    if (/fl\.?\s*oz|fluid\s*ounces?|oz|ounces?/i.test(unitName)) {
      const netKg = totalUnits * 0.0283495;
      const tare = totalUnits > 16 ? 0.15 : totalUnits > 8 ? 0.09 : totalUnits > 4 ? 0.06 : 0.03;
      return parseFloat((netKg + tare).toFixed(3));
    }
    if (/kg|kilos?/i.test(unitName)) {
      return parseFloat(totalUnits.toFixed(3));
    }
    if (/grams?|gm|g/i.test(unitName)) {
      return parseFloat((totalUnits / 1000).toFixed(3));
    }
    return null;
  }

  /**
   * Helper: Smart product weight resolver across all raw data structures.
   * Extracts ONLY genuine source weight (direct fields, product specs, price_per_unit, variations, title/description units).
   * Returns null if no weight is found in the source data (NO fake defaults).
   */
  private extractItemWeightKg(item: any): number | null {
    const raw = item?.rawData || {};
    const data = raw?.data || raw?.raw || raw || {};
    const pim = raw?.pim_data || {};
    const title = data.title || item.title || '';

    // 1. Direct fields
    const directCandidates = [
      pim.weight, pim.weight_kg,
      raw.weight_kg, data.weight_kg,
      raw.weight, data.weight, data.shipping_weight, raw.shipping_weight
    ];
    for (const c of directCandidates) {
      if (c !== null && c !== undefined && c !== '') {
        const w = this.parseWeightStringToKg(c);
        if (w && w >= 0.01 && w <= 50) return w;
      }
    }

    // 2. Product Specs array
    const specsList = [];
    if (Array.isArray(data.product_specs)) specsList.push(...data.product_specs);
    if (Array.isArray(raw.product_specs)) specsList.push(...raw.product_specs);
    if (Array.isArray(data.specifications)) specsList.push(...data.specifications);

    for (const s of specsList) {
      const name = s?.name || s?.key || '';
      const val = s?.value || '';
      if (/weight|dimension/i.test(name)) {
        const w = this.parseWeightStringToKg(val);
        if (w && w >= 0.01 && w <= 50) return w;
      }
    }

    // 3. Specs Object
    const specsObj = data.specifications || raw.specifications || data.specs || raw.specs;
    if (specsObj && typeof specsObj === 'object' && !Array.isArray(specsObj)) {
      for (const [k, v] of Object.entries(specsObj)) {
        if (/weight/i.test(k)) {
          const w = this.parseWeightStringToKg(String(v));
          if (w && w >= 0.01 && w <= 50) return w;
        }
      }
    }

    // 4. Price-per-unit mathematical calculation (e.g. Walmart "$40.98/lb" + "$32.78")
    const ppu = raw?.price_per_unit || data?.price_per_unit || item?.price_per_unit;
    const pVal = raw?.price || data?.price || raw?.raw_price || data?.raw_price || item?.priceParsed || item?.priceRaw;
    if (ppu && pVal) {
      const w = this.parsePricePerUnitToKg(pVal, ppu);
      if (w && w >= 0.01 && w <= 50) return w;
    }

    // 5. Variations (sizes / titles / price_per_unit)
    const varSource = raw?.variations || data?.variations || pim?.variants || [];
    const varList: any[] = [];
    if (Array.isArray(varSource)) {
      varList.push(...varSource);
    } else if (varSource && typeof varSource === 'object') {
      Object.values(varSource).forEach((group: any) => {
        if (Array.isArray(group)) varList.push(...group);
        else if (group && typeof group === 'object' && Array.isArray(group.variations)) varList.push(...group.variations);
      });
    }

    if (varList.length > 0) {
      const varKgs: number[] = [];
      for (const v of varList) {
        const explicit = v.weightKg ?? v.weight_kg ?? v.weight;
        if (explicit) {
          const w = this.parseWeightStringToKg(explicit);
          if (w && w > 0) varKgs.push(w);
        } else if (v.price_per_unit && (v.price || v.raw_price)) {
          const w = this.parsePricePerUnitToKg(v.price || v.raw_price, v.price_per_unit);
          if (w && w > 0) varKgs.push(w);
        } else {
          const text = `${v.title || ''} ${v.size || ''} ${v.color || ''}`.trim();
          const w = text ? this.parseWeightStringToKg(text) : null;
          if (w && w > 0) varKgs.push(w);
        }
      }
      if (varKgs.length > 0) return Math.min(...varKgs);
    }

    // 6. Product Title regex (oz, fl oz, lbs, kg, g, ml)
    if (title) {
      const w = this.parseWeightStringToKg(title);
      if (w && w >= 0.01 && w <= 50) return w;
    }

    // No fake default — return null if weight is not in source data
    return null;
  }

  /**
   * ১.১ স্ক্র্যাপড কিউ থেকে পেন্ডিং আইটেম লিস্ট (AI Publish এর জন্য)
   */
  async getScrapedQueue(limit = 40, page = 1, search?: string) {
    const take = Math.min(limit, 100);
    const skip = Math.max(0, (page - 1) * take);

    const where: any = {
      status: { in: ['scraped', 'pending', 'draft', 'raw', 'ready'] },
    };

    if (search && search.trim()) {
      const q = search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
        { externalId: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [totalScraped, items] = await Promise.all([
      (this.prisma as any).rawScrapedItem.count({ where }),
      (this.prisma as any).rawScrapedItem.findMany({
        where,
        take,
        skip,
        orderBy: { scrapedAt: 'desc' },
      }),
    ]);

    return {
      success: true,
      totalCount: totalScraped,
      count: items.length,
      items: items.map((item: any) => {
        let images: string[] = [];
        try {
          const raw = typeof item.rawData === 'string' ? JSON.parse(item.rawData) : item.rawData;
          const d = raw?.data || raw?.raw || raw;
          if (Array.isArray(d?.images)) images = d.images;
          else if (d?.image) images = [d.image];
          else if (d?.image_url) images = [d.image_url];
        } catch (_) {}

        const weightKg = this.extractItemWeightKg(item);

        return {
          id: item.id,
          externalId: item.externalId,
          source: item.source || 'amazon',
          title: item.title || 'Untitled Scraped Product',
          url: item.url,
          brand: item.brand || 'Unbranded',
          category: item.category || 'General',
          priceRaw: item.priceRaw,
          priceParsed: item.priceParsed || 0,
          weightKg,
          images,
          status: item.status,
          scrapedAt: item.scrapedAt,
        };
      }),
    };
  }

  /**
   * ২. ক্যাটালগ প্রোডাক্ট কিউ (প্রাইস, ওজন ও এসইও স্ট্যাটাস সহ)
   */
  async getProductsQueue(options?: {
    filter?: 'all' | 'optimized' | 'pending';
    search?: string;
    limit?: number;
    page?: number;
  }) {
    const filter = options?.filter || 'all';
    const search = options?.search?.trim();
    const limit = Math.min(options?.limit || 50, 100);
    const page = Math.max(options?.page || 1, 1);
    const skip = (page - 1) * limit;

    const [totalProducts, optimizedProductsCount] = await Promise.all([
      this.prisma.product.count(),
      this.prisma.seoMetadata.count({ where: { aiOptimized: true } }),
    ]);
    const pendingProductsCount = Math.max(0, totalProducts - optimizedProductsCount);

    const where: any = {};
    if (filter === 'optimized') {
      where.seo = { is: { aiOptimized: true } };
    } else if (filter === 'pending') {
      where.OR = [
        { seo: null },
        { seo: { is: { aiOptimized: false } } },
      ];
    }

    if (search) {
      const searchConditions = [
        { title: { contains: search, mode: 'insensitive' } },
        { asin: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { brand: { is: { name: { contains: search, mode: 'insensitive' } } } },
      ];
      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          { OR: searchConditions },
        ];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    const [filteredCount, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          seo: true,
          variants: {
            select: {
              id: true,
              title: true,
              size: true,
              color: true,
              weightKg: true,
              sourcePrice: true,
              sellingPrice: true,
              stock: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      success: true,
      counts: {
        total: totalProducts,
        optimized: optimizedProductsCount,
        pending: pendingProductsCount,
        filtered: filteredCount,
      },
      page,
      limit,
      totalPages: Math.ceil(filteredCount / limit),
      items: products.map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        asin: p.asin,
        sku: p.sku,
        weightKg: p.weightKg || 0.2,
        sourcePrice: p.sourcePrice || 0,
        sellingPrice: p.sellingPrice || 0,
        currency: p.currency || 'USD',
        hsCode: p.hsCode || '8517.13',
        brand: p.brand?.name || 'Generic',
        category: p.category?.name || 'General',
        variantsCount: p.variants.length,
        variants: p.variants,
        aiOptimized: Boolean(p.seo?.aiOptimized),
        seoScore: p.seo?.seoScore || 0,
        metaTitle: p.seo?.metaTitle || null,
        metaDescription: p.seo?.metaDescription || null,
        focusKeyword: p.seo?.focusKeyword || null,
      })),
    };
  }

  /**
   * ৩. ওয়েট ও প্রাইস অটোমেশন ক্যালকুলেটর (Weight & Landed Price Calculation Engine)
   */
  async calculateLandedPrice(params: {
    sourcePriceUsd: number;
    weightKg: number;
    categoryId?: string;
    hsCode?: string;
  }): Promise<PriceBreakdownResult> {
    const { sourcePriceUsd, weightKg = 0.2, categoryId, hsCode } = params;

    let exchangeRate = 136.5;
    try {
      const activeRate = await this.prisma.currencyExchangeRate.findFirst({
        where: { sourceCurrency: 'USD', targetCurrency: 'BDT' },
      });
      if (activeRate?.rate) exchangeRate = activeRate.rate;
    } catch (e) {
      this.logger.warn(`Exchange rate fetch failed: ${(e as any)?.message}`);
    }

    const basePriceBdt = sourcePriceUsd * exchangeRate;

    // এয়ার ফ্রেইট রেট (US to BD)
    let airRatePerKgUsd = 12.0;
    try {
      const shipRate = await this.prisma.shippingRate.findFirst({
        where: { shippingMethod: 'air', originCountry: 'US', destCountry: 'BD', isActive: true },
      });
      if (shipRate?.ratePerKg) airRatePerKgUsd = shipRate.ratePerKg;
    } catch (e) {
      this.logger.warn(`Shipping rate fetch failed: ${(e as any)?.message}`);
    }

    const internationalAirFreightUsd = Math.max(weightKg * airRatePerKgUsd + 2.0, 5.0);
    const internationalAirFreightBdt = internationalAirFreightUsd * exchangeRate;

    // NBR শুল্ক ও ট্যাক্স পার্সেন্টেজ
    let dutyPct = 0.10; // ডিফল্ট ১০%
    if (hsCode) {
      if (hsCode.startsWith('3304')) dutyPct = 0.45; // কসমেটিকস
      else if (hsCode.startsWith('6403')) dutyPct = 0.25; // জুতো/লেদার
      else if (hsCode.startsWith('8517')) dutyPct = 0.10; // মোবাইল ও ইলেকট্রনিক্স
      else if (hsCode.startsWith('8471')) dutyPct = 0.05; // ল্যাপটপ/কম্পিউটার
    }

    const customsTaxBdt = basePriceBdt * dutyPct;
    const profitMarginPct = 0.15; // ১৫% প্রফিট মার্জিন
    const profitMarginBdt = basePriceBdt * profitMarginPct;

    // রাউন্ডেড সেলস প্রাইস (BDT)
    const rawTotalBdt = basePriceBdt + internationalAirFreightBdt + customsTaxBdt + profitMarginBdt;
    const finalSellingPriceBdt = Math.ceil(rawTotalBdt / 50) * 50;
    const finalSellingPriceUsd = Number((finalSellingPriceBdt / exchangeRate).toFixed(2));

    const breakdown = {
      sourcePriceUsd,
      weightKg,
      exchangeRate,
      basePriceBdt: Math.round(basePriceBdt),
      airRatePerKgUsd,
      internationalAirFreightUsd: Number(internationalAirFreightUsd.toFixed(2)),
      internationalAirFreightBdt: Math.round(internationalAirFreightBdt),
      dutyPct: Math.round(dutyPct * 100),
      customsTaxBdt: Math.round(customsTaxBdt),
      profitMarginPct: Math.round(profitMarginPct * 100),
      profitMarginBdt: Math.round(profitMarginBdt),
      finalSellingPriceBdt,
      finalSellingPriceUsd,
    };
    return {
      success: true,
      breakdown,
      ...breakdown,
    };
  }

  /**
   * ৪. প্রোডাক্ট ও তার সকল ভ্যারিয়েন্টের স্বয়ংক্রিয় প্রাইসিং ও ওজন ক্যালকুলেশন
   */
  async automateVariantPricing(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });

    if (!product) {
      throw new NotFoundException('প্রোডাক্ট পাওয়া যায়নি');
    }

    const baseWeight = product.weightKg || 0.2;
    const basePriceUsd = product.sourcePrice || 50;

    // মেইন প্রোডাক্টের প্রাইস ক্যালকুলেশন
    const baseCalc = await this.calculateLandedPrice({
      sourcePriceUsd: basePriceUsd,
      weightKg: baseWeight,
      hsCode: product.hsCode || undefined,
    });

    // Don't overwrite human-entered or existing selling price if > 0
    if (!product.sellingPrice || product.sellingPrice <= 0) {
      await this.prisma.product.update({
        where: { id: product.id },
        data: {
          sellingPrice: baseCalc.finalSellingPriceBdt,
        },
      });
    }

    // ভ্যারিয়েন্ট সমূহের স্বয়ংক্রিয় প্রাইস আপডেট
    const updatedVariants: any[] = [];
    for (const v of product.variants) {
      const vWeight = v.weightKg || baseWeight;
      const vSourcePrice = v.sourcePrice || basePriceUsd;

      const vCalc = await this.calculateLandedPrice({
        sourcePriceUsd: vSourcePrice,
        weightKg: vWeight,
        hsCode: product.hsCode || undefined,
      });

      let updatedV = v;
      if (!v.sellingPrice || v.sellingPrice <= 0) {
        updatedV = await this.prisma.variant.update({
          where: { id: v.id },
          data: {
            sellingPrice: vCalc.finalSellingPriceBdt,
          },
        });
      }

      updatedVariants.push({
        ...updatedV,
        calculation: vCalc,
      });
    }

    // লগ রেকর্ড
    await (this.prisma as any).productEnrichmentLog.create({
      data: {
        product: { connect: { id: product.id } },
        productTitle: product.title,
        status: 'SUCCESS',
        hsCode: product.hsCode || null,
        newDescription: 'Automated variant prices computed with weight & air freight.',
      },
    });

    return {
      success: true,
      title: product.title,
      baseCalculation: baseCalc,
      updatedVariants,
    };
  }

  /**
   * ৫. ফুল এআই প্রোডাক্ট এনরিচমেন্ট (Gemini AI বাংলা কপি, এসইও মেটা, স্কিমা ও প্রাইস)
   */
  async enrichProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { category: true, brand: true, variants: true },
    });

    if (!product) {
      throw new NotFoundException('প্রোডাক্ট পাওয়া যায়নি');
    }

    this.logger.log(`🤖 AI Full Product Enrichment: ${product.title}`);

    // ১. চেক করা প্রোডাক্টের আসল ওজন আছে নাকি ফাঁকা/ডিফল্ট (<= 0.1)
    const isWeightBlank = !product.weightKg || product.weightKg <= 0.1;
    let resolvedWeight = product.weightKg && product.weightKg > 0.1 ? product.weightKg : 0.25;

    // ২. এসইও ও কপিরাইটিং তৈরি
    let enrichedTitle = product.title;
    let enrichedDescription = product.description || `Buy authentic ${product.title} in Bangladesh with fast USA air freight.`;
    let seoMetaTitle = `${product.title.slice(0, 50)} | Buy Online in BD - A2Z`;
    let seoMetaDescription = `Get authentic ${product.title} in Bangladesh. Guaranteed original from USA with cash on delivery & express air delivery.`;
    let focusKeyword = `${product.brand?.name || ''} ${product.title.split(' ').slice(0, 3).join(' ')} Bangladesh`.trim();
    let aiSummary = `${product.title} is available in Bangladesh at A2Z Outlet with genuine USA import guarantee.`;

    if (this.aiClient) {
      try {
        const prompt = `
          You are an elite cross-border e-commerce AI copywriter, logistics freight engineer, and SEO specialist for Bangladesh.
          Product Title: ${product.title}
          Brand: ${product.brand?.name || 'Original'}
          Category: ${product.category?.name || 'General'}
          Description: ${product.description ? product.description.slice(0, 300) : ''}
          Current Shipping Weight: ${!isWeightBlank ? `${product.weightKg} KG` : 'NOT SPECIFIED (Please estimate realistic gross shipping weight in KG)'}

          Analyze this product carefully (e.g. bottle size/volume in oz/ml, container material tare weight, packaging box, footwear vs electronics vs skincare).

          Generate a JSON object with:
          1. "estimatedWeightKg": Realistic gross shipping weight in KG as a float (e.g. 0.25 for standard skincare serum/lotion, 0.45 for large shampoo/conditioner, 0.95 for running shoes, 1.8 for laptop, 0.35 for smartphone, 0.15 for vitamins). If current weight is already accurate, keep that value or refine it.
          2. "marketingTitle": High-converting clean title (max 70 chars)
          3. "bengaliDescription": 2-3 engaging persuasive paragraphs in natural high-converting Bengali describing authentic features, benefits and import guarantee.
          4. "keyFeatures": Array of 4-5 core bullet points in Bengali.
          5. "seoTitle": Google SERP title under 60 chars ending with "| A2Z BD"
          6. "seoDescription": Click-worthy Google meta description under 155 chars with price and delivery info.
          7. "focusKeyword": Primary ranking keyword in Bangladesh.
          8. "aiSummary": 2 sentences summarizing the product for Google AI Overviews and Voice Search.
          Return ONLY valid raw JSON.
        `;

        const response = await this.aiClient.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: prompt,
        });

        const textResponse = response.text || '';
        const cleanJson = textResponse.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        if (parsed.estimatedWeightKg && typeof parsed.estimatedWeightKg === 'number' && parsed.estimatedWeightKg >= 0.05 && parsed.estimatedWeightKg <= 50) {
          if (isWeightBlank) {
            resolvedWeight = parseFloat(parsed.estimatedWeightKg.toFixed(3));
            await this.prisma.product.update({
              where: { id: product.id },
              data: { weightKg: resolvedWeight },
            });
            this.logger.log(`✨ AI estimated and fixed blank weight for "${product.title}": ${resolvedWeight} kg`);
          }
        }

        if (parsed.marketingTitle) enrichedTitle = parsed.marketingTitle;
        if (parsed.bengaliDescription) enrichedDescription = parsed.bengaliDescription;
        if (parsed.seoTitle) seoMetaTitle = parsed.seoTitle;
        if (parsed.seoDescription) seoMetaDescription = parsed.seoDescription;
        if (parsed.focusKeyword) focusKeyword = parsed.focusKeyword;
        if (parsed.aiSummary) aiSummary = parsed.aiSummary;
      } catch (err) {
        this.logger.warn(`⚠️ Gemini API error or fallback: ${String(err)}`);
      }
    }

    // ৩. সঠিক ওজন দিয়ে প্রাইস ও ভ্যারিয়েন্ট অটোমেশন চালানো
    const priceResult = await this.automateVariantPricing(productId);

    // প্রোডাক্ট ও এসইও মেটাডাটা সেভ করা
    await this.prisma.product.update({
      where: { id: product.id },
      data: {
        description: enrichedDescription,
      },
    });

    const seoRecord = await this.prisma.seoMetadata.upsert({
      where: { productId: product.id },
      update: {
        metaTitle: seoMetaTitle,
        metaDescription: seoMetaDescription,
        focusKeyword,
        aiSummary,
        aiOptimized: true,
        seoScore: 94,
        lastAuditedAt: new Date(),
      },
      create: {
        metaTitle: seoMetaTitle,
        metaDescription: seoMetaDescription,
        focusKeyword,
        aiSummary,
        canonicalUrl: `https://a2zoutletstore.com/products/${product.slug}`,
        schemaType: 'Product',
        aiOptimized: true,
        seoScore: 94,
        lastAuditedAt: new Date(),
      },
    });

    // এনরিচমেন্ট লগ তৈরি
    await (this.prisma as any).productEnrichmentLog.create({
      data: {
        productTitle: product.title,
        brand: product.brand?.name || null,
        category: product.category?.name || null,
        status: 'SUCCESS',
        newSeoTitle: seoMetaTitle,
        newSeoDescription: seoMetaDescription,
        newDescription: enrichedDescription,
        hsCode: product.hsCode || null,
      },
    });

    return {
      success: true,
      title: enrichedTitle,
      description: enrichedDescription,
      seo: seoRecord,
      pricing: priceResult.baseCalculation,
      variantsUpdated: priceResult.updatedVariants.length,
    };
  }

  /**
   * ৬. ব্যাচ এআই এনরিচমেন্ট (Batch Process Catalog)
   */
  async batchEnrich(productIds?: string[]) {
    let targets: { id: string }[] = [];
    if (productIds && productIds.length > 0) {
      targets = productIds.map((id) => ({ id }));
    } else {
      targets = await this.prisma.product.findMany({
        take: 10,
        select: { id: true },
      });
    }

    const results: any[] = [];
    for (const t of targets) {
      try {
        const res = await this.enrichProduct(t.id);
        results.push({ id: t.id, status: 'SUCCESS', title: res.title });
      } catch (err: any) {
        results.push({ id: t.id, status: 'FAILED', error: err.message });
      }
    }

    return {
      success: true,
      totalProcessed: results.length,
      results,
    };
  }

  /**
   * ৭. ইনস্ট্যান্ট এআই এসইও ও প্রাইস প্লে-গ্রাউন্ড জেনারেটর
   */
  async generateSeoContent(payload: {
    title: string;
    description?: string;
    brand?: string;
    category?: string;
    weightKg?: number;
    sourcePrice?: number;
  }) {
    const weight = payload.weightKg || 0.25;
    const price = payload.sourcePrice || 99;

    const pricing = await this.calculateLandedPrice({
      sourcePriceUsd: price,
      weightKg: weight,
    });

    const hsCodeResult = await this.classifyHsCode(payload.title);

    const seoTitle = `${payload.title.slice(0, 50)} | Buy Online in Bangladesh - A2Z`;
    const seoDescription = `Buy authentic ${payload.title} from USA. Landed price ${pricing.finalSellingPriceBdt} BDT with express international air delivery & official warranty.`;
    const focusKeyword = `${payload.brand || ''} ${payload.title.split(' ').slice(0, 3).join(' ')} Price in Bangladesh`.trim();
    const aiSummary = `${payload.title} can be imported directly to Bangladesh via A2Z for ${pricing.finalSellingPriceBdt} BDT (approx $${pricing.finalSellingPriceUsd} USD) including air freight & customs duty.`;

    const schemaJson = {
      '@context': 'https://schema.org/',
      '@type': 'Product',
      name: payload.title,
      brand: { '@type': 'Brand', name: payload.brand || 'Original Brand' },
      offers: {
        '@type': 'Offer',
        priceCurrency: 'BDT',
        price: pricing.finalSellingPriceBdt,
        availability: 'https://schema.org/InStock',
      },
    };

    const keyFeatures = [
      '১০০% জেনুইন ইউএসএ ইমপোর্ট গ্যারান্টি',
      `ওজন অনুযায়ী ফেয়ার এয়ার ফ্রেইট রেট (${weight} কেজি)`,
      `সম্পূর্ণ কাস্টমস ডিউটি ক্লিয়ারেন্স সহ মোট দাম: ${pricing.finalSellingPriceBdt} টাকা`,
      'দ্রুততম ৭-১০ দিনের মধ্যে এক্সপ্রেস হোম ডেলিভারি',
    ];
    const data = {
      marketingTitle: payload.title,
      bengaliDescription: `প্রিমিয়াম কোয়ালিটির আসল ${payload.title} এখন সরাসরি ইউএসএ থেকে বাংলাদেশে হোম ডেলিভারি। সম্পূর্ণ লিগ্যাল চ্যানেল ও কাস্টমস ডিউটি পেইড ল্যান্ডেড প্রাইস মাত্র ${pricing.finalSellingPriceBdt} টাকা।`,
      seoTitle,
      seoDescription,
      focusKeyword,
      aiSummary,
      keyFeatures,
      schemaJson,
      estimatedSeoScore: 95,
    };
    return {
      success: true,
      data,
      input: payload,
      pricing,
      hsCode: hsCodeResult,
      seo: data,
      bengaliCopy: {
        marketingTitle: payload.title,
        bulletPoints: keyFeatures,
      },
    };
  }

  /**
   * ৮. NBR কাস্টমস শুল্ক ও এইচএস কোড ডিটেকশন
   */
  async classifyHsCode(productTitle: string) {
    let estimatedDutyPct = 10.0;
    let suggestedCategory = 'General Goods';
    let predictedHsCode = '8517.13';

    const lower = productTitle.toLowerCase();
    if (
      lower.includes('serum') ||
      lower.includes('cream') ||
      lower.includes('lipstick') ||
      lower.includes('lotion') ||
      lower.includes('olaplex')
    ) {
      estimatedDutyPct = 45.0; // কসমেটিকস শুল্ক
      suggestedCategory = 'Beauty & Cosmetics';
      predictedHsCode = '3304.99';
    } else if (
      lower.includes('laptop') ||
      lower.includes('macbook') ||
      lower.includes('pc') ||
      lower.includes('ram')
    ) {
      estimatedDutyPct = 5.0; // ল্যাপটপ/আইটি পণ্য
      suggestedCategory = 'Electronics & IT';
      predictedHsCode = '8471.30';
    } else if (
      lower.includes('phone') ||
      lower.includes('iphone') ||
      lower.includes('galaxy') ||
      lower.includes('s24')
    ) {
      estimatedDutyPct = 10.0; // স্মার্টফোন
      suggestedCategory = 'Smartphones & Mobile';
      predictedHsCode = '8517.13';
    } else if (
      lower.includes('shoe') ||
      lower.includes('jordan') ||
      lower.includes('nike') ||
      lower.includes('sneaker')
    ) {
      estimatedDutyPct = 25.0; // জুতো/ফুটওয়্যার
      suggestedCategory = 'Footwear & Fashion';
      predictedHsCode = '6403.99';
    } else if (lower.includes('watch')) {
      estimatedDutyPct = 25.0;
      suggestedCategory = 'Luxury Watches';
      predictedHsCode = '9102.11';
    }

    return {
      productTitle,
      suggestedCategory,
      predictedHsCode,
      estimatedDutyPct,
    };
  }

  /**
   * ৯. সাম্প্রতিক এনরিচমেন্ট কাজের লগ দেখা
   */
  async getEnrichmentLogs() {
    return (this.prisma as any).productEnrichmentLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: { title: true, slug: true },
        },
      },
    });
  }

  /**
   * ১০. এআই গ্রস শিপিং ওজন প্রেডিকশন (AI Gross Shipping Weight Estimator)
   */
  async estimateWeightOnly(params: {
    title: string;
    category?: string;
    description?: string;
    variations?: any[];
  }): Promise<{ success: boolean; weightKg: number; reasoning: string }> {
    const { title, category, description, variations } = params;

    // 1. Try deterministic math / text parsing first
    const fromTitle = this.parseWeightStringToKg(title);
    if (fromTitle && fromTitle > 0) {
      return { success: true, weightKg: fromTitle, reasoning: `Extracted directly from product title: ${fromTitle} kg` };
    }

    if (Array.isArray(variations) && variations.length > 0) {
      for (const v of variations) {
        const vPrice = v.price || v.sourcePrice;
        const vPpu = v.price_per_unit || v.pricePerUnit;
        if (vPpu && vPrice) {
          const kg = this.parsePricePerUnitToKg(vPrice, vPpu);
          if (kg && kg > 0) {
            return { success: true, weightKg: kg, reasoning: `Calculated from variation price per unit: ${kg} kg` };
          }
        }
      }
    }

    // 2. Query Gemini 2.0 Flash
    if (this.aiClient) {
      try {
        const prompt = `
          You are a precision international cross-border freight weight estimator for e-commerce items shipped by air freight to Bangladesh.
          Product Title: "${title}"
          Category: "${category || 'General'}"
          Description: "${description ? description.slice(0, 400) : ''}"

          Analyze the product carefully:
          - Consider bottle/container tare weight (glass vs plastic), tablet/capsule count, fluid volume (oz, ml), density, and standard protective mailer packaging.
          - For standard vitamins/supplements (30-60 tablets): ~0.25 to 0.40 kg.
          - For 100-200 capsules: ~0.45 to 0.65 kg.
          - For skincare serum/creams (30-50ml): ~0.20 to 0.35 kg.
          - For shampoos/lotions (12-16 oz): ~0.45 to 0.60 kg.
          - For running shoes: ~0.85 to 1.1 kg.
          - For laptops: ~1.8 to 2.6 kg.
          - For smartphones: ~0.35 to 0.45 kg.

          Respond ONLY with a JSON object:
          {
            "estimatedWeightKg": 0.35,
            "reasoning": "Brief explanation of bottle/packaging calculation in English"
          }
        `;

        const response = await this.aiClient.models.generateContent({
          model: 'gemini-2.0-flash',
          contents: prompt,
        });

        const textResponse = response.text || '';
        const cleanJson = textResponse.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleanJson);

        if (
          parsed.estimatedWeightKg &&
          typeof parsed.estimatedWeightKg === 'number' &&
          parsed.estimatedWeightKg >= 0.02 &&
          parsed.estimatedWeightKg <= 50
        ) {
          const weightKg = parseFloat(parsed.estimatedWeightKg.toFixed(3));
          return {
            success: true,
            weightKg,
            reasoning: parsed.reasoning || 'Estimated using Gemini logistics AI model',
          };
        }
      } catch (err) {
        this.logger.warn(`AI standalone weight estimation failed: ${String(err)}`);
      }
    }

    // 3. Category & Container Tare Logistics Rules Engine (Deterministic Fallback)
    const combined = `${title} ${description || ''} ${category || ''}`.toLowerCase();

    // Supplements / Vitamins / Count detection
    const countMatch = combined.match(/(\d+)\s*(?:tablets?|capsules?|softgels?|gummies|count|pills?|caplets?|ct\b)/i);
    if (countMatch) {
      const count = parseInt(countMatch[1], 10);
      if (count > 0 && count <= 1000) {
        // Glass/plastic bottle tare (~0.20-0.24 kg) + tablet weight (~0.002 kg per tablet) + packaging
        const tabletWeight = count * 0.002;
        const bottleTare = count > 120 ? 0.28 : count > 60 ? 0.24 : 0.20;
        const total = parseFloat((tabletWeight + bottleTare).toFixed(3));
        return {
          success: true,
          weightKg: total,
          reasoning: `Calculated from ${count} count bottle + container tare (${total} kg)`,
        };
      }
    }

    // Footwear / Shoes
    if (/shoes?|sneakers?|boots?|sandals?|footwear|loafers?|running shoes?/i.test(combined)) {
      return { success: true, weightKg: 0.95, reasoning: 'Standard footwear box shipping weight: 0.95 kg' };
    }

    // Laptops / Computers
    if (/laptops?|notebook|macbook|thinkpad|gaming laptop/i.test(combined)) {
      return { success: true, weightKg: 2.2, reasoning: 'Standard laptop + power brick shipping weight: 2.2 kg' };
    }

    // Smartphones / Handheld
    if (/iphone|smartphone|samsung galaxy|pixel \d|android phone/i.test(combined)) {
      return { success: true, weightKg: 0.38, reasoning: 'Standard smartphone retail packaging: 0.38 kg' };
    }

    // Watches
    if (/watch|timepiece|chronograph|smartwatch/i.test(combined)) {
      return { success: true, weightKg: 0.28, reasoning: 'Standard watch box packaging: 0.28 kg' };
    }

    // Perfumes / Fragrances
    if (/perfume|eau de parfum|cologne|fragrance|edt\b|edp\b/i.test(combined)) {
      return { success: true, weightKg: 0.42, reasoning: 'Standard glass perfume bottle + box tare: 0.42 kg' };
    }

    // Handbags / Backpacks
    if (/backpack|handbag|tote bag|crossbody|duffle/i.test(combined)) {
      return { success: true, weightKg: 0.75, reasoning: 'Standard bag shipping weight: 0.75 kg' };
    }

    return { success: false, weightKg: 0, reasoning: 'Could not determine weight' };
  }
}

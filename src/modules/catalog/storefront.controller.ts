import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { SettingsService } from '../settings/settings.service';
import { OrdersService } from '../orders/orders.service';
import { PricingService } from '../pricing/pricing.service';
import { CustomerService } from '../customer/customer.service';
import { CreateReviewDto } from '../customer/dto/customer.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { runBackgroundScrape } from './scraper.util';

@Controller('storefront')
export class StorefrontController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly settingsService: SettingsService,
    private readonly ordersService: OrdersService,
    private readonly pricingService: PricingService,
    private readonly customerService: CustomerService,
    private readonly prisma: PrismaService,
    private readonly searchService: SearchService,
  ) {}

  private async applyDynamicPricing(product: any) {
    if (!product || !product.sourcePrice || product.sourcePrice <= 0) return product;
    try {
      const bd = await this.pricingService.calculateLandedPrice({
        sourcePriceUsd: product.sourcePrice,
        weightKg: product.weightKg || product.netWeightKg || 0.1,
        source: product.source,
        categoryId: product.categoryId,
        categoryName: product.category?.name || product.categoryName,
        lengthCm: product.lengthCm,
        widthCm: product.widthCm,
        heightCm: product.heightCm,
        hsCode: product.hsCode,
        originCountry: product.originCountry,
      });
      const finalPrice = bd.finalSellingPriceBdt;
      return {
        ...product,
        sellingPrice: finalPrice,
        comparePrice: finalPrice > product.sellingPrice ? Math.round(finalPrice * 1.1) : product.comparePrice,
      };
    } catch (e) {
      return product;
    }
  }

  /**
   * ১. Next.js সিএমএস কন্টেন্ট (হিরো স্লাইডার, মেগা মেনু, থিম কালার)
   * GET /storefront/cms/content
   */
  @Get('cms/content')
  async getCmsContent() {
    const cms: any = await this.settingsService.getCmsContent();
    return {
      success: true,
      data: cms,
      site: cms.siteConfig || cms.site,
      header: cms.headerConfig || cms.header,
      hero: cms.heroConfig || cms.hero,
      homepage: cms.homepageConfig || cms.homepage,
      footer: cms.footerConfig || cms.footer,
      pages: cms.pagesConfig || cms.pages,
      seo: cms.seoConfig || cms.seo,
      ...cms,
    };
  }

  /**
   * ২. স্টোর জেনারেল কনফিগ (কারেন্সি, লোগো, ফোন)
   * GET /storefront/config
   */
  @Get('config')
  async getStoreConfig() {
    const config: any = await this.settingsService.getStoreSettings();
    const paymentMethods = await this.settingsService.getPublicPaymentMethods();
    
    // Add gateway enabled flags for frontend usage
    const paymentConfig = {
      bkash_enabled: paymentMethods.bkash?.isActive ? 'true' : 'false',
      nagad_enabled: paymentMethods.nagad?.isActive ? 'true' : 'false',
      sslcommerz_enabled: paymentMethods.sslcommerz?.isActive ? 'true' : 'false',
      stripe_enabled: paymentMethods.stripe?.isActive ? 'true' : 'false',
      cod_enabled: paymentMethods.cod?.isActive ? 'true' : 'false',
      uddoktapay_enabled: paymentMethods.uddoktapay?.isActive ? 'true' : 'false',
    };

    const finalConfig = { ...config, ...paymentConfig };
    return { success: true, data: finalConfig, ...finalConfig };
  }

  /**
   * ৩. স্টোরফ্রন্ট ক্যাটালগ প্রডাক্টস (ফিল্টারিং, সার্চ ও পেজিনেশন)
   * GET /storefront/products
   */
  @Get('products')
  async getProducts(@Query() query: any) {
    const searchTerm = (query.search || query.q || '').trim();

    // ✅ যদি ইউজার কিছু সার্চ করে, তবে আমাদের পূর্ণাঙ্গ PostgreSQL GIN Trigram & BM25 Search Engine ব্যবহার করবে!
    if (searchTerm) {
      const searchResult: any = await this.searchService.searchProducts({
        q: searchTerm,
        page: query.page,
        limit: query.limit,
        category: query.category,
        brand: query.brand,
        minPrice: query.min_price || query.minPrice,
        maxPrice: query.max_price || query.maxPrice,
        sort: query.sort_by || query.sort,
        inStock: query.in_stock ? String(query.in_stock) : undefined,
      });

      const itemsWithPricing = await Promise.all(
        searchResult.items.map(async (item: any) => this.applyDynamicPricing(item)),
      );

      return {
        success: true,
        engine: searchResult.engine,
        didYouMean: searchResult.didYouMean,
        data: itemsWithPricing,
        products: itemsWithPricing,
        total: searchResult.total,
        pages: searchResult.totalPages,
        meta: searchResult,
      };
    }

    // অন্যথায় স্ট্যান্ডার্ড ক্যাটাগরি ও স্টোরফ্রন্ট ব্রাউজিং
    const productsData = await this.catalogService.getStorefrontProducts({
      page: query.page,
      limit: query.limit,
      category: query.category,
      brand: query.brand,
      source: query.source,
      badge: query.badge,
      minPrice: query.min_price || query.minPrice,
      maxPrice: query.max_price || query.maxPrice,
      sort: query.sort_by || query.sort,
      search: searchTerm,
      has_discount: query.has_discount || query.deal,
    });
    const itemsWithPricing = await Promise.all(
      productsData.items.map(async (item: any) => this.applyDynamicPricing(item))
    );

    return {
      success: true,
      data: itemsWithPricing,
      products: itemsWithPricing,
      total: productsData.total,
      pages: productsData.totalPages,
      meta: productsData,
    };
  }

  /**
   * লাইভ প্রোডাক্ট স্ক্র্যাপ রিকোয়েস্ট
   * GET /storefront/products/live-scrape?url=...
   */
  @Get('products/live-scrape')
  async liveScrape(@Query('url') url: string) {
    if (!url) {
      return { success: false, error: 'URL is required' };
    }
    try {
      const data = await this.catalogService.requestLiveScrape(url);
      return { success: true, data };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }


  /**
   * ৪.০. সেফ প্রডাক্ট লুকআপ (Query param বা Body দিয়ে, 414 URI Too Long প্রতিরোধ করতে)
   * GET /storefront/products/lookup?slug=...
   * POST /storefront/products/lookup
   */
  @Get('products/lookup')
  async lookupProduct(
    @Query('slug') slug?: string,
    @Query('id') id?: string,
    @Query('asin') asin?: string,
  ) {
    const key = (slug || id || asin || '').trim();
    if (!key) return { success: false, data: null };
    try {
      let product = await this.catalogService.getProductBySlug(key);
      product = await this.applyDynamicPricing(product);
      return { success: true, data: product };
    } catch (e) {
      return { success: false, data: null };
    }
  }

  @Post('products/lookup')
  async lookupProductPost(@Body() body: { slug?: string; id?: string; asin?: string }) {
    const key = (body?.slug || body?.id || body?.asin || '').trim();
    if (!key) return { success: false, data: null };
    try {
      let product = await this.catalogService.getProductBySlug(key);
      product = await this.applyDynamicPricing(product);
      return { success: true, data: product };
    } catch (e) {
      return { success: false, data: null };
    }
  }

  /**
   * ৪. স্ল্যাগ দিয়ে সিঙ্গেল প্রডাক্ট ডিটেইলস
   * GET /storefront/products/slug/:slug
   */
  @Get('products/slug/:slug')
  async getProductBySlug(@Param('slug') slug: string) {
    try {
      let product = await this.catalogService.getProductBySlug(slug);
      product = await this.applyDynamicPricing(product);
      return { success: true, data: product };
    } catch (e) {
      return { success: false, data: null };
    }
  }

  /**
   * ৫. আইডি দিয়ে প্রডাক্ট ডিটেইলস
   * GET /storefront/products/:id
   */
  @Get('products/:id')
  async getProductById(@Param('id') id: string) {
    let product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        brand: true,
        variants: true,
        seo: true,
        reviews: { where: { isApproved: true } },
      },
    });
    product = await this.applyDynamicPricing(product);
    return { success: true, data: product };
  }

  /**
   * ৬. সব ক্যাটাগরি তালিকা (হেডার মেগা মেনুর জন্য)
   * GET /storefront/categories
   */
  @Get('categories')
  async getCategories() {
    const categories = await this.catalogService.getCategories();

    // Build 3-tier category tree
    const rootCats = categories.filter((c: any) => !c.parentId);
    const tree = rootCats.map((root: any) => {
      const subcats = categories
        .filter((c: any) => c.parentId === root.id)
        .map((sub: any) => {
          const subSubcats = categories
            .filter((c: any) => c.parentId === sub.id)
            .map((ss: any) => ({
              name: ss.name,
              slug: ss.slug,
              imageUrl: ss.imageUrl || '',
              count: ss._count?.products || 0,
            }));
          return {
            name: sub.name,
            slug: sub.slug,
            imageUrl: sub.imageUrl || '',
            count: sub._count?.products || 0,
            sub_subcategories: subSubcats,
          };
        });
      return {
        name: root.name,
        slug: root.slug,
        icon: root.icon || '',
        imageUrl: root.imageUrl || '',
        count: root._count?.products || 0,
        subcategories: subcats,
      };
    });

    return { 
      success: true, 
      data: categories,
      categories: categories,
      category_tree: tree 
    };
  }

  /**
   * ৭. সাইডবার ফিল্টার্স তালিকা (ব্র্যান্ডস, রেঞ্জ)
   * GET /storefront/filters
   */
  @Get('filters')
  async getFilters(
    @Query('brand_page') brandPage?: string,
    @Query('brand_limit') brandLimit?: string,
  ) {
    const bPage = Number(brandPage) || 1;
    const bLimit = Number(brandLimit) || 50;

    const [brandsResult, categories] = await Promise.all([
      this.catalogService.getBrands({ page: bPage, limit: bLimit }),
      this.catalogService.getCategories(),
    ]);

    const formattedBrands = (brandsResult?.items || []).map((b: any) => ({
      name: b.name,
      count: b._count?.products ?? 0,
      logo_url: b.logoUrl,
    }));

    const formattedCats = (categories || []).map((c: any) => ({
      name: c.name,
      count: c._count?.products ?? 0,
      slug: c.slug,
    }));

    const brands_pagination = {
      total: brandsResult?.total ?? 0,
      page: bPage,
      limit: bLimit,
      pages: brandsResult?.totalPages ?? 1,
      has_more: bPage < (brandsResult?.totalPages ?? 1),
    };

    return {
      success: true,
      brands: formattedBrands,
      categories: formattedCats,
      brands_pagination,
      data: {
        brands: formattedBrands,
        categories: formattedCats,
        brands_pagination,
      },
    };
  }

  /**
   * ৮. প্রডাক্টের ৩-ধাপের প্রাইস ব্রেকডাউন পপআপ
   * GET /storefront/products/:id/price-breakdown
   */
  @Get('products/:id/price-breakdown')
  async getPriceBreakdown(
    @Param('id') id: string,
    @Query('variantId') variantId?: string,
    @Query('destinationZone') destinationZone?: string,
    @Query('hasMembership') hasMembership?: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { variants: true, category: true } as any,
    });
    if (!product) return { success: false, message: 'Not found' };

    let sourcePrice = (product as any).sourcePrice ?? 0;
    let weightKg = (product as any).weightKg || 0.2;
    let lengthCm: number | undefined = (product as any).lengthCm ?? undefined;
    let widthCm: number | undefined = (product as any).widthCm ?? undefined;
    let heightCm: number | undefined = (product as any).heightCm ?? undefined;

    if (variantId && (product as any).variants) {
      const variant = (product as any).variants.find((v: any) => v.id === variantId);
      if (variant) {
        if (variant.sourcePrice) sourcePrice = variant.sourcePrice;
        if (variant.weightKg) weightKg = variant.weightKg;
        if (variant.lengthCm) lengthCm = variant.lengthCm;
        if (variant.widthCm) widthCm = variant.widthCm;
        if (variant.heightCm) heightCm = variant.heightCm;
      }
    }

    const categoryName = (product as any).category?.name ?? undefined;

    const breakdown = await this.pricingService.calculateLandedPrice({
      sourcePriceUsd: sourcePrice,
      weightKg,
      lengthCm,
      widthCm,
      heightCm,
      categoryId: (product as any).categoryId || undefined,
      categoryName,
      source: (product as any).source || undefined,
      hasMembership: hasMembership === 'true',
      destinationZone: destinationZone || 'Inside Dhaka',
    });
    return { success: true, data: breakdown };
  }

  /**
   * ৯. প্রডাক্ট রিভিউ দেখা ও পোস্ট করা
   * GET & POST /storefront/products/:id/reviews
   */
  @Get('products/:id/reviews')
  async getReviews(@Param('id') id: string) {
    const reviews = await this.prisma.productReview.findMany({
      where: { productId: id, isApproved: true },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, data: reviews };
  }

  @Post('products/:id/reviews')
  async addReview(@Param('id') id: string, @Body() dto: CreateReviewDto) {
    dto.productId = id;
    const review = await this.customerService.addReview(dto);
    return { success: true, data: review };
  }

  /**
   * ১০. লাইভ অর্ডার ট্র্যাকিং (Next.js Track Order Page)
   * GET /storefront/orders/track/:orderNumber
   */
  @Get('orders/track/:orderNumber')
  async trackOrder(@Param('orderNumber') orderNumber: string) {
    const tracking = await this.ordersService.trackOrder(orderNumber);
    return { success: true, data: tracking };
  }

  /**
   * ১১. Request a Quote (RFQ) Submit
   * POST /storefront/request-quote
   */
  @Post('request-quote')
  async requestQuote(@Body() body: any) {
    try {
      const { name, email, phone, company, currency, message, items } = body;
      const quoteIds = [];
      let itemArray = Array.isArray(items) ? items : [];
      
      // Fallback for single item submission from older forms
      if (itemArray.length === 0 && (body.product_name || body.product_url)) {
        itemArray = [body];
      }

      for (const item of itemArray) {
        const adminNoteStr = item.category ? `Category: ${item.category}` : undefined;
        const finalMessage = item.notes ? `${message || ''}\n\nItem Notes: ${item.notes}` : message;

        const req = await this.prisma.quotationRequest.create({
          data: {
            name: name || 'Unknown',
            email: email,
            phone: phone,
            company: company,
            productName: item.product_name,
            productUrl: item.product_url,
            quantity: item.quantity || 1,
            currency: currency || 'BDT',
            message: finalMessage,
            adminNotes: adminNoteStr,
            status: 'pending',
          },
        });
        quoteIds.push(req.id);
        
        // Background scraping is now handled in the frontend via live-scrape and extension
      }

      return {
        success: true,
        quote_id: quoteIds[0] || 'Q-UNKNOWN',
        quote_ids: quoteIds,
        count: quoteIds.length,
      };
    } catch (e: any) {
      return { success: false, message: e.message };
    }
  }

  // ─── RFQ Save ─────────────────────────────────────────────────────────────
  @Post('rfq-save')
  async saveRfqProduct(@Body() body: any) {
    return this.catalogService.saveRfqProduct(body);
  }
}

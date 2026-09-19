import { ApiTags, ApiSecurity, ApiOperation } from '@nestjs/swagger';
import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Req,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { PricingService } from '../pricing/pricing.service';
import { ExtensionSyncDto } from './dto/extension-sync.dto';
import { GetProductsQueryDto } from './dto/get-products-query.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { ExtensionTaskFilterDto } from './dto/extension-task-filter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';


import { QueueService } from '../queue/queue.service';
import { Inject, forwardRef } from '@nestjs/common';

@ApiTags('Catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
  ) { }

  /**
   * ক্রোম এক্সটেনশন সিঙ্ক এন্ডপয়েন্ট: POST /catalog/extension/sync
   * ?async=true দিলে BullMQ কিউতে ব্যাকগ্রাউন্ডে প্রসেস হবে
   */
  @ApiOperation({ summary: 'ক্রোম এক্সটেনশন সিঙ্ক (BullMQ ব্যাকগ্রাউন্ড সাপোর্ট সহ)' })
  @ApiSecurity('x-api-key')
  @UseGuards(ApiKeyGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }))
  @Post('extension/sync')
  async syncFromExtension(
    @Body() payload: ExtensionSyncDto,
    @Query('async') asyncMode?: string,
  ) {
    if (asyncMode === 'true' || asyncMode === '1') {
      return this.queueService.addScrapeSyncJob(payload);
    }
    return this.catalogService.syncFromExtension(payload);
  }

  /**
   * ক্রোম এক্সটেনশন বাল্ক ব্যাকগ্রাউন্ড সিঙ্ক: POST /catalog/extension/sync-bulk
   */
  @ApiOperation({ summary: 'ক্রোম এক্সটেনশন বাল্ক ব্যাকগ্রাউন্ড সিঙ্ক (BullMQ)' })
  @ApiSecurity('x-api-key')
  @UseGuards(ApiKeyGuard)
  @Post('extension/sync-bulk')
  async syncBulkFromExtension(@Body() items: ExtensionSyncDto[]) {
    return this.queueService.addBulkScrapeJobs(Array.isArray(items) ? items : [items]);
  }

  @ApiOperation({ summary: 'ক্রোম এক্সটেনশন কানেকশন ও কি ভ্যালিডেশন টেস্ট' })
  @ApiSecurity('x-api-key')
  @UseGuards(ApiKeyGuard)
  @Get('extension/ping')
  async pingExtension(@Req() req: any) {
    return {
      success: true,
      message: 'Extension successfully connected and activated!',
      keyName: req.apiKey.name,
      scopes: req.apiKey.scopes,
    };
  }

  @ApiOperation({ summary: 'Get Live Scrape Tasks' })
  @ApiSecurity('x-api-key')
  @UseGuards(ApiKeyGuard)
  @Get('extension/live-tasks')
  getLiveTasks() {
    return this.catalogService.getPendingLiveTasks();
  }

  @ApiOperation({ summary: 'Submit Live Scrape Result' })
  @ApiSecurity('x-api-key')
  @UseGuards(ApiKeyGuard)
  @Post('extension/live-tasks/:id/result')
  submitLiveTaskResult(@Param('id') id: string, @Body() body: any) {
    return { success: this.catalogService.submitLiveTaskResult(id, body) };
  }

  /**

   * ক্রোম এক্সটেনশনের বাল্ক ও শিডিউল টাস্ক কিউ: GET /catalog/extension/batch-tasks
   */
  @ApiOperation({ summary: 'ক্রোম এক্সটেনশনের বাল্ক ও শিডিউল টাস্ক কিউ' })
  @ApiSecurity('x-api-key')
  @UseGuards(ApiKeyGuard)
  @Get('extension/batch-tasks')
  async getExtensionBatchTasks(@Query() query: ExtensionTaskFilterDto) {
    const take = Number(query.limit) || 250;
    const where: any = {};

    // ১. স্ট্যাটাস ফিল্টার (DRAFT, PUBLISHED অথবা ALL)
    if (query.status && query.status.toUpperCase() !== 'ALL') {
      where.status = query.status.toUpperCase();
    } else {
      // ডিফল্টভাবে DRAFT এবং PUBLISHED দুটোই আসবে
      where.status = { in: ['DRAFT', 'PUBLISHED'] };
    }

    // ২. স্টক ফিল্টার (In-Stock vs Out-Of-Stock)
    if (query.inStock !== undefined && query.inStock !== null) {
      where.stock = query.inStock ? { gt: 0 } : { lte: 0 };
    }

    // ৩. সোর্স ফিল্টার (amazon, walmart ইত্যাদি)
    if (query.source) {
      where.source = { equals: query.source.toLowerCase(), mode: 'insensitive' };
    }

    // ৪. ব্র্যান্ড ফিল্টার (Brand Relation)
    if (query.brand) {
      where.brand = {
        name: { contains: query.brand, mode: 'insensitive' },
      };
    }

    // ৫. ক্যাটাগরি ফিল্টার (Category Relation)
    if (query.category) {
      where.category = {
        OR: [
          { name: { contains: query.category, mode: 'insensitive' } },
          { slug: { contains: query.category, mode: 'insensitive' } },
        ],
      };
    }

    // ৬. লাস্ট স্ক্র্যাপ ফিল্টার (updatedAt)
    if (query.lastScrapedDays) {
      const cutoffDate = new Date(
        Date.now() - Number(query.lastScrapedDays) * 24 * 60 * 60 * 1000,
      );
      where.updatedAt = { lte: cutoffDate };
    }

    // ৭. ডাটাবেজ থেকে প্রোডাক্ট ফেচ
    const products = await this.prisma.product.findMany({
      where,
      take,
      orderBy: { updatedAt: 'asc' }, // সবচেয়ে পুরোনো স্ক্র্যাপ হওয়া প্রোডাক্ট আগে আসবে
      select: {
        id: true,
        title: true,
        asin: true,
        source: true,
        sourceUrl: true,
        status: true,
        stock: true, // 👈 পণ্যের বর্তমান স্টক সংখ্যা
        sourcePrice: true,
        sellingPrice: true,
        discountPrice: true, // 👈 কাটা দাম
        badge: true, // 👈 Best Seller, Limited Time Deal ইত্যাদি
        updatedAt: true,
        brand: { select: { name: true } },
        category: { select: { name: true } },
      },
    });

    return {
      success: true,
      count: products.length,
      tasks: products.map((p) => ({
        taskId: p.id,
        title: p.title,
        url: p.sourceUrl || (p.asin ? `https://www.amazon.com/dp/${p.asin}` : null),
        asin: p.asin,
        source: p.source,
        status: p.status,
        stock: p.stock,
        inStock: p.stock > 0, // 👈 true হলে ইন-স্টক, false হলে স্টক-আউট
        sellingPrice: p.sellingPrice,
        discountPrice: p.discountPrice,
        badges: p.badge || [],
        brand: p.brand?.name || null,
        category: p.category?.name || null,
        lastScrapedAt: p.updatedAt,
      })),
    };
  }

  /**
   * স্টোরফ্রন্ট ক্যাটালগ লিস্ট: GET /catalog
   */
  @Get()
  async getProducts(@Query() query: GetProductsQueryDto) {
    return this.catalogService.getStorefrontProducts(query);
  }

  /**
   * ক্যাটালগ স্ট্যাটস: GET /catalog/stats
   */
  @ApiOperation({ summary: 'ক্যাটালগ সার্বিক স্ট্যাটস' })
  @Get('stats')
  async getStats() {
    return this.catalogService.getCatalogStats();
  }

  /**
   * সব ক্যাটাগরি লিস্ট: GET /catalog/categories
   */
  @Get('categories')
  async getCategories() {
    return this.catalogService.getCategories();
  }

  /**
   * ৩-লেভেল ক্যাটাগরি ট্যাক্সোনমি হায়ারার্কি: GET /catalog/taxonomy
   */
  @ApiOperation({ summary: '৩-লেভেল ক্যাটাগরি ট্যাক্সোনমি হায়ারার্কি' })
  @Get('taxonomy')
  async getTaxonomy() {
    return this.catalogService.getTaxonomy();
  }

  /**
   * সব ব্র্যান্ড লিস্ট: GET /catalog/brands
   */
  @Get('brands')
  async getBrands(@Query() query: any) {
    return this.catalogService.getBrands(query);
  }

  /**
   * র স্ক্র্যাপড আইটেমস কিউ: GET /catalog/scraped
   */
  @ApiOperation({ summary: 'র স্ক্র্যাপড আইটেমস কিউ' })
  @Get('scraped')
  async getScrapedItems(@Query() query: any) {
    return this.catalogService.getRawScrapedItems(query);
  }

  /**
   * নির্দিষ্ট র স্ক্র্যাপড আইটেম বিস্তারিত: GET /catalog/scraped/:id
   */
  @ApiOperation({ summary: 'নির্দিষ্ট র স্ক্র্যাপড আইটেম বিস্তারিত' })
  @Get('scraped/:id')
  async getSingleScrapedItem(@Param('id') id: string) {
    return this.catalogService.getSingleRawScrapedItem(id);
  }

  /**
   * র স্ক্র্যাপড আইটেম ক্যাটালগে পুশ / এডিট করে পাবলিশ: POST /catalog/scraped/:id/ingest
   */
  @ApiOperation({ summary: 'র স্ক্র্যাপড আইটেম ক্যাটালগে পুশ / এডিট করে পাবলিশ' })
  @Post('scraped/:id/ingest')
  async ingestScrapedItem(
    @Param('id') id: string,
    @Body() body?: any,
  ) {
    try {
      return await this.catalogService.ingestRawScrapedItem(id, body);
    } catch (err: any) {
      console.error('❌ Error in ingestScrapedItem:', err);
      throw err;
    }
  }

  /**
   * মাল্টিপল স্ক্র্যাপড আইটেম বাল্ক এআই পাবলিশ / ড্রাফট: POST /catalog/scraped/bulk-ingest
   */
  @ApiOperation({ summary: 'মাল্টিপল স্ক্র্যাপড আইটেম বাল্ক এআই পাবলিশ / ড্রাফট' })
  @Post('scraped/bulk-ingest')
  async bulkIngestScraped(
    @Body() body: { ids: string[]; status?: 'PUBLISHED' | 'DRAFT'; aiOptimize?: boolean },
  ) {
    return this.catalogService.bulkIngestScraped(
      body.ids,
      body.status || 'PUBLISHED',
      body.aiOptimize !== undefined ? body.aiOptimize : true,
    );
  }

  /**
   * মাল্টিপল স্ক্র্যাপড আইটেম বাল্ক আর্কাইভ: POST /catalog/scraped/bulk-archive
   */
  @ApiOperation({ summary: 'মাল্টিপল স্ক্র্যাপড আইটেম বাল্ক আর্কাইভ' })
  @Post('scraped/bulk-archive')
  async bulkArchiveScraped(
    @Body() body: { ids: string[] },
  ) {
    return this.catalogService.bulkArchiveScraped(body.ids);
  }

  /**
   * মাল্টিপল প্রডাক্ট বাল্ক স্ট্যাটাস আপডেট: POST /catalog/products/bulk-status
   */
  @ApiOperation({ summary: 'মাল্টিপল প্রডাক্ট বাল্ক স্ট্যাটাস আপডেট' })
  @Post('products/bulk-status')
  async bulkUpdateProductStatus(
    @Body() body: { ids: string[]; status: any },
  ) {
    return this.catalogService.bulkUpdateProductStatus(body.ids, body.status);
  }

  /**
   * মাল্টিপল প্রডাক্ট বাল্ক ডিলিট (আর্কাইভ বা পার্মানেন্ট): POST /catalog/products/bulk-delete
   */
  @ApiOperation({ summary: 'মাল্টিপল প্রডাক্ট বাল্ক ডিলিট' })
  @Post('products/bulk-delete')
  async bulkDeleteProducts(
    @Body() body: { ids: string[]; permanent?: boolean },
  ) {
    return this.catalogService.bulkDeleteProducts(body.ids, body.permanent);
  }

  /**
   * আর্কাইভ কিউ (রিস্টোর ও পার্মানেন্ট ডিলিট): GET /catalog/archive
   */
  @ApiOperation({ summary: 'আর্কাইভ কিউ লিস্ট' })
  @Get('archive')
  async getArchiveItems(@Query() query: any) {
    return this.catalogService.getArchiveItems(query);
  }

  /**
   * আর্কাইভ থেকে রিস্টোর: POST /catalog/archive/:id/restore
   */
  @ApiOperation({ summary: 'আর্কাইভ থেকে রিস্টোর করা' })
  @Post('archive/:id/restore')
  async restoreArchiveItem(
    @Param('id') id: string,
    @Body() body: { itemType: string },
  ) {
    return this.catalogService.restoreArchiveItem(id, body.itemType || 'scraped');
  }

  /**
   * আর্কাইভ থেকে স্থায়ীভাবে মুছে ফেলা: DELETE /catalog/archive/:id/permanent
   */
  @ApiOperation({ summary: 'আর্কাইভ থেকে স্থায়ীভাবে ডিলিট' })
  @Delete('archive/:id/permanent')
  async permanentDeleteArchiveItem(
    @Param('id') id: string,
    @Query('itemType') itemType: string,
  ) {
    return this.catalogService.permanentDeleteArchiveItem(id, itemType || 'scraped');
  }

  /**
   * এডমিন ড্যাশবোর্ড প্রোডাক্ট লিস্ট: GET /catalog/products
   */
  @ApiOperation({ summary: 'এডমিন ড্যাশবোর্ড প্রোডাক্ট লিস্ট' })
  @Get('products')
  async getAdminProducts(@Query() query: any) {
    const result = await this.catalogService.getAdminProducts(query);
    // Apply dynamic BDT pricing so admin sees correct prices (not stale DB values)
    if (result?.items?.length) {
      result.items = await Promise.all(
        result.items.map(async (p: any) => {
          if (!p.sourcePrice || p.sourcePrice <= 0) return p;
          try {
            const bd = await this.pricingService.calculateLandedPrice({
              sourcePriceUsd: p.sourcePrice,
              weightKg: p.weightKg || 0.1,
              source: p.source,
              categoryId: p.categoryId,
              categoryName: p.category?.name,
              lengthCm: p.lengthCm,
              widthCm: p.widthCm,
              heightCm: p.heightCm,
              hsCode: p.hsCode,
            });
            return { ...p, sellingPrice: bd.finalSellingPriceBdt };
          } catch {
            return p;
          }
        })
      );
    }
    return result;
  }

  /**
   * নির্দিষ্ট প্রোডাক্ট আইডি দিয়ে বিস্তারিত: GET /catalog/products/:id
   */
  @ApiOperation({ summary: 'নির্দিষ্ট প্রোডাক্ট আইডি দিয়ে বিস্তারিত' })
  @Get('products/:id')
  async getProductById(@Param('id') id: string) {
    return this.catalogService.getProductBySlug(id);
  }

  /**
   * নির্দিষ্ট প্রোডাক্ট বিস্তারিত: GET /catalog/:slug
   */
  @Get(':slug')
  async getProductBySlug(@Param('slug') slug: string) {
    return this.catalogService.getProductBySlug(slug);
  }

  // ─── Admin Product CRUD ───────────────────────────────────────────────────

  /** POST /catalog/products — ম্যানুয়াল প্রোডাক্ট তৈরি */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('products')
  async createProduct(@Body() body: any) {
    return this.catalogService.createProduct(body);
  }

  /** PATCH /catalog/products/:id — প্রাইস/স্টক/স্ট্যাটাস আপডেট */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'STAFF')
  @Patch('products/:id')
  async updateProduct(
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.catalogService.updateProduct(id, body);
  }

  /** POST /catalog/products/:id/ingest-images — প্রোডাক্ট ইমেজ মিডিয়া লাইব্রেরিতে ডাউনলোড ও সিঙ্ক */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'STAFF')
  @Post('products/:id/ingest-images')
  async ingestProductImages(@Param('id') id: string) {
    return this.catalogService.ingestProductImages(id);
  }

  /** POST /catalog/products/bulk-ingest-images — বাল্ক প্রোডাক্ট ইমেজ মিডিয়া লাইব্রেরিতে ডাউনলোড */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'STAFF')
  @Post('products/bulk-ingest-images')
  async bulkIngestProductImages(@Body() body: { ids: string[] }) {
    return this.catalogService.bulkIngestProductImages(body.ids);
  }

  /** DELETE /catalog/products/:id — সফট-আর্কাইভ */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('products/:id')
  async deleteProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.deleteProduct(id);
  }

  /** DELETE /catalog/products/:productId/variants/:variantId — ভ্যারিয়েন্ট ডিলিট */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN', 'STAFF')
  @Delete('products/:productId/variants/:variantId')
  async deleteProductVariant(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
  ) {
    return this.catalogService.deleteProductVariant(productId, variantId);
  }

  // ─── Category Admin ───────────────────────────────────────────────────────

  /** POST /catalog/categories — নতুন ক্যাটাগরি */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('categories')
  async createCategory(@Body() body: { name: string; icon?: string; imageUrl?: string; displayOrder?: number; parentId?: string }) {
    return this.catalogService.createCategory(body);
  }

  /** PATCH /catalog/categories/:id — ক্যাটাগরি এডিট */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Patch('categories/:id')
  async updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { name?: string; icon?: string; imageUrl?: string; displayOrder?: number; parentId?: string }
  ) {
    return this.catalogService.updateCategory(id, body);
  }

  /** POST /catalog/categories/reorder — ক্যাটাগরি রি-অর্ডার */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('categories/reorder')
  async reorderCategories(@Body() body: { items: { id: string; displayOrder: number }[] }) {
    return this.catalogService.reorderCategories(body.items);
  }

  /** DELETE /catalog/categories/:id */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('categories/:id')
  async deleteCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.deleteCategory(id);
  }

  // ─── Brand Admin ──────────────────────────────────────────────────────────

  /** POST /catalog/brands — নতুন ব্র্যান্ড */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Post('brands')
  async createBrand(@Body() body: { name: string; logoUrl?: string; website?: string }) {
    return this.catalogService.createBrand(body);
  }

  /** DELETE /catalog/brands/:id */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Delete('brands/:id')
  async deleteBrand(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalogService.deleteBrand(id);
  }

  // ─── RFQ Save ─────────────────────────────────────────────────────────────
  @ApiOperation({ summary: 'Save RFQ Scraped Product to Inventory' })
  @Post('rfq-save')
  async saveRfqProduct(@Body() body: any) {
    return this.catalogService.saveRfqProduct(body);
  }

  @ApiOperation({ summary: 'প্রোডাক্টের ইনভেন্টরি স্টক মুভমেন্ট অডিট লেজার হিস্টোরি' })
  @Get('products/:id/inventory-movements')
  async getInventoryMovements(@Param('id') id: string) {
    return this.catalogService.getInventoryMovements(id);
  }
}


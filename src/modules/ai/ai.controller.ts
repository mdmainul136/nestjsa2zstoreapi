import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AiService } from './ai.service';

@ApiTags('AI Engine')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * ১. এআই ইঞ্জিন ওভারভিউ ও মেট্রিক্স: GET /ai/overview
   */
  @ApiOperation({ summary: 'এআই ইঞ্জিন ওভারভিউ ও হেলথ মেট্রিক্স' })
  @Get('overview')
  async getOverview() {
    return this.aiService.getOverview();
  }

  /**
   * ১.১ স্ক্র্যাপড কিউ: GET /ai/scraped-queue
   */
  @ApiOperation({ summary: 'স্ক্র্যাপড পেন্ডিং কিউ (AI Publish এর জন্য)' })
  @Get('scraped-queue')
  async getScrapedQueue(
    @Query('limit') limit?: string,
    @Query('page') page?: string,
    @Query('search') search?: string,
  ) {
    return this.aiService.getScrapedQueue(
      limit ? parseInt(limit, 10) : 40,
      page ? parseInt(page, 10) : 1,
      search,
    );
  }

  /**
   * ২. ক্যাটালগ প্রোডাক্ট কিউ: GET /ai/products
   */
  @ApiOperation({ summary: 'প্রোডাক্ট কিউ (প্রাইস, ওজন ও এসইও স্ট্যাটাস)' })
  @Get('products')
  async getProductsQueue(
    @Query('filter') filter?: 'all' | 'optimized' | 'pending',
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.aiService.getProductsQueue({
      filter,
      search,
      limit: limit ? parseInt(limit, 10) : 50,
      page: page ? parseInt(page, 10) : 1,
    });
  }

  /**
   * ৩. সিঙ্গেল প্রোডাক্ট এআই এনরিচমেন্ট: POST /ai/enrich/:productId
   */
  @ApiOperation({ summary: 'ফুল এআই প্রোডাক্ট কপিরাইটিং, এসইও ও প্রাইস এনরিচমেন্ট' })
  @Post('enrich/:productId')
  async enrichProduct(@Param('productId') productId: string) {
    return this.aiService.enrichProduct(productId);
  }

  /**
   * ৪. ব্যাচ এআই এনরিচমেন্ট: POST /ai/batch-enrich
   */
  @ApiOperation({ summary: 'মাল্টিপল প্রোডাক্ট ব্যাচ এনরিচমেন্ট' })
  @Post('batch-enrich')
  async batchEnrich(@Body() body: { productIds?: string[] }) {
    return this.aiService.batchEnrich(body?.productIds);
  }

  /**
   * ৫. ওজন ও ভ্যারিয়েন্ট প্রাইসিং অটোমেশন: POST /ai/calculate-variant-pricing
   */
  @ApiOperation({ summary: 'প্রোডাক্ট ও ভ্যারিয়েন্টের স্বয়ংক্রিয় ওয়েট ও প্রাইস ক্যালকুলেশন' })
  @Post('calculate-variant-pricing')
  async calculateVariantPricing(@Body() body: { productId: string }) {
    return this.aiService.automateVariantPricing(body.productId);
  }

  /**
   * ৬. লাইভ ল্যান্ডেড প্রাইস ক্যালকুলেটর: POST /ai/calculate-landed-price
   */
  @ApiOperation({ summary: 'লাইভ এয়ার ফ্রেইট, শুল্ক ও বিক্রয়মূল্য ক্যালকুলেটর' })
  @Post('calculate-landed-price')
  async calculateLandedPrice(
    @Body()
    body: {
      sourcePriceUsd: number;
      weightKg: number;
      categoryId?: string;
      hsCode?: string;
    },
  ) {
    return this.aiService.calculateLandedPrice(body);
  }

  /**
   * ৭. ইনস্ট্যান্ট এআই এসইও ও কপি প্লে-গ্রাউন্ড: POST /ai/generate-seo
   */
  @ApiOperation({ summary: 'ইনস্ট্যান্ট এআই এসইও ও বাংলা কপিরাইটিং জেনারেটর' })
  @Post('generate-seo')
  async generateSeo(
    @Body()
    body: {
      title: string;
      description?: string;
      brand?: string;
      category?: string;
      weightKg?: number;
      sourcePrice?: number;
    },
  ) {
    return this.aiService.generateSeoContent(body);
  }

  /**
   * ৮. কাস্টমস শুল্ক ও ক্যাটাগরি ডিটেকশন: POST /ai/classify-hs-code
   */
  @ApiOperation({ summary: 'NBR কাস্টমস শুল্ক ও এইচএস কোড ডিটেকশন' })
  @Post('classify-hs-code')
  async classifyHsCode(@Body('productTitle') productTitle: string) {
    return this.aiService.classifyHsCode(productTitle);
  }

  /**
   * ১০. এআই গ্রস শিপিং ওজন প্রেডিকশন: POST /ai/estimate-weight
   */
  @ApiOperation({ summary: 'প্রোডাক্টের টাইটেল ও ডিসক্রিপশন দেখে বাস্তবসম্মত গ্রস ওজন প্রেডিক্ট করা' })
  @Post('estimate-weight')
  async estimateWeight(
    @Body()
    body: {
      title: string;
      category?: string;
      description?: string;
      variations?: any[];
    },
  ) {
    return this.aiService.estimateWeightOnly(body);
  }
}

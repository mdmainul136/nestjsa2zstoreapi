import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { SearchService } from './search.service';
import { SearchSuggestDto, ProductSearchDto } from './dto/search-query.dto';
import { GlobalSearchDto } from './dto/global-search.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Search')
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * ১. লাইভ টাইপ-অ্যাহেড সাজেশন: GET /search/suggest
   */
  @ApiOperation({ summary: 'লাইভ টাইপ-অ্যাহেড প্রোডাক্ট সাজেশন' })
  @Get('suggest')
  async suggest(@Query() query: SearchSuggestDto) {
    return this.searchService.suggest(query);
  }

  /**
   * ২. অ্যাডমিন গ্লোবাল সার্চ (Admin ⌘K): GET /search/global
   */
  @ApiOperation({ summary: 'অ্যাডমিন গ্লোবাল সার্চ (প্রোডাক্ট, অর্ডার, পার্সেল ও টিকেট)' })
  @Get('global')
  async globalSearch(@Query() query: GlobalSearchDto) {
    return this.searchService.globalSearch(query);
  }

  /**
   * ৩. অ্যাডভান্সড ফ্যাসেটেড প্রোডাক্ট সার্চ: GET /search/products
   */
  @ApiOperation({ summary: 'অ্যাডভান্সড ফ্যাসেটেড প্রোডাক্ট সার্চ' })
  @Get('products')
  async searchProducts(@Query() query: ProductSearchDto) {
    return this.searchService.searchProducts(query);
  }

  /**
   * ৪. ট্রেন্ডিং ও পপুলার সার্চ কিওয়ার্ড: GET /search/trending
   */
  @ApiOperation({ summary: 'ট্রেন্ডিং ও জনপ্রিয় সার্চ কিওয়ার্ড' })
  @Get('trending')
  async getTrending() {
    return this.searchService.getTrending();
  }
  /**
   * ৫. সার্চ ইঞ্জিন ইনডেক্সিং ও এলগরিদম ওভারভিউ: GET /search/indexing-overview
   */
  @ApiOperation({ summary: 'সার্চ ইঞ্জিন ইনডেক্সিং ও এলগরিদম মেট্রিক্স' })
  @Get('indexing-overview')
  async getIndexingOverview() {
    return this.searchService.getIndexingOverview();
  }

  /**
   * ৬. ম্যানুয়াল সার্চ ইঞ্জিন সাবমিশন: POST /search/submit-indexing
   */
  @ApiOperation({ summary: 'গুগল বা ইন্ডেক্সনাউ-এ নতুন URL সাবমিট' })
  @Post('submit-indexing')
  async submitIndexing(@Body() body: { url: string; engine?: string; action?: string }) {
    return this.searchService.submitIndexing(body);
  }

  /**
   * ৭. ইনডেক্সিং সেটিংস আপডেট: POST /search/config
   */
  @ApiOperation({ summary: 'ইনডেক্সিং কনফিগারেশন আপডেট' })
  @Post('config')
  async updateConfig(@Body() body: any) {
    return this.searchService.updateConfig(body);
  }

  /**
   * ৮. ম্যানুয়াল ডাটাবেজ ফুল-টেক্সট ও ট্রাইগ্রাম ইনডেক্স রিবিল্ড: POST /search/reindex
   */
  @ApiOperation({ summary: 'PostgreSQL GIN Full-Text & Trigram ইনডেক্স পুনর্নির্মাণ' })
  @Post('reindex')
  async reindex() {
    return this.searchService.reindexAll();
  }
}

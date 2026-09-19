import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AddTrackerDto, UpdateTrackerDto } from './dto/competitor.dto';

@Injectable()
export class CompetitorService {
  private readonly logger = new Logger(CompetitorService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────────
  // ১. মার্কেটপ্লেস আইডি এক্সট্র্যাক্ট (ASIN / Walmart Item ID)
  // ─────────────────────────────────────────────────────────────────────────────
  private extractMarketplaceId(
    productUrl: string,
    source: string,
  ): string | null {
    try {
      if (source === 'amazon') {
        // /dp/B08N5WRWNW or /gp/product/B08N5WRWNW
        const match = productUrl.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
        return match ? match[1] : null;
      }

      if (source === 'walmart') {
        // /ip/Product-Name/123456789
        const match = productUrl.match(/\/ip\/[^/]+\/(\d+)/);
        return match ? match[1] : null;
      }

      if (source === 'ebay') {
        // /itm/123456789012
        const match = productUrl.match(/\/itm\/(\d+)/);
        return match ? match[1] : null;
      }

      return null;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ২. নতুন ট্র্যাকার যোগ করা
  // ─────────────────────────────────────────────────────────────────────────────
  async addTracker(dto: AddTrackerDto) {
    // একই URL দিয়ে ডুপ্লিকেট ট্র্যাকার থাকলে এরর
    const existing = await this.prisma.competitorTracker.findFirst({
      where: { productUrl: dto.productUrl },
    });

    if (existing) {
      throw new BadRequestException(
        `এই URL টি ইতিমধ্যে ট্র্যাক হচ্ছে (ID: ${existing.id})`,
      );
    }

    const marketplaceId = this.extractMarketplaceId(dto.productUrl, dto.source);

    const tracker = await this.prisma.competitorTracker.create({
      data: {
        productTitle: dto.productTitle,
        source: dto.source,
        productUrl: dto.productUrl,
        marketplaceId,
        currentPrice: dto.currentPrice,
        previousPrice: null,
        targetAlertPrice: dto.targetAlertPrice ?? null,
        availability: 'In Stock',
        alertTriggered: false,
        lastCheckedAt: new Date(),
      },
    });

    this.logger.log(
      `✅ Tracker Added: [${dto.source.toUpperCase()}] "${dto.productTitle}" @ $${dto.currentPrice} | ASIN/ID: ${marketplaceId ?? 'N/A'}`,
    );

    return tracker;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ৩. সব ট্র্যাকার লিস্ট (ফিল্টার + স্ট্যাটস সহ)
  // ─────────────────────────────────────────────────────────────────────────────
  async listTrackers(source?: string, alertOnly?: boolean) {
    const where: any = {};
    if (source) where.source = source;
    if (alertOnly) where.alertTriggered = true;

    const [trackers, total, alertCount] = await this.prisma.$transaction([
      this.prisma.competitorTracker.findMany({
        where,
        orderBy: { lastCheckedAt: 'desc' },
      }),
      this.prisma.competitorTracker.count({ where }),
      this.prisma.competitorTracker.count({ where: { alertTriggered: true } }),
    ]);

    return {
      total,
      alertCount,
      trackers,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ৪. একটি ট্র্যাকার ডিটেইল ও প্রাইস হিস্ট্রি
  // ─────────────────────────────────────────────────────────────────────────────
  async getTrackerById(id: string) {
    const tracker = await this.prisma.competitorTracker.findUnique({
      where: { id },
    });

    if (!tracker) {
      throw new NotFoundException(`Tracker ID "${id}" পাওয়া যায়নি`);
    }

    // প্রাইস চেঞ্জ ক্যালকুলেশন
    const priceChange =
      tracker.previousPrice !== null
        ? parseFloat(
            (tracker.currentPrice - tracker.previousPrice).toFixed(2),
          )
        : null;

    const priceChangePct =
      tracker.previousPrice !== null && tracker.previousPrice > 0
        ? parseFloat(
            (
              ((tracker.currentPrice - tracker.previousPrice) /
                tracker.previousPrice) *
              100
            ).toFixed(2),
          )
        : null;

    return {
      ...tracker,
      priceChange,
      priceChangePct,
      alertStatus:
        tracker.targetAlertPrice !== null &&
        tracker.currentPrice <= tracker.targetAlertPrice
          ? 'TRIGGERED'
          : 'MONITORING',
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ৫. ট্র্যাকার আপডেট (ম্যানুয়াল প্রাইস আপডেট)
  // ─────────────────────────────────────────────────────────────────────────────
  async updateTracker(id: string, dto: UpdateTrackerDto) {
    const existing = await this.prisma.competitorTracker.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Tracker ID "${id}" পাওয়া যায়নি`);
    }

    // প্রাইস পরিবর্তন হলে previousPrice সেভ করা এবং alert চেক
    const priceUpdated =
      dto.currentPrice !== undefined &&
      dto.currentPrice !== existing.currentPrice;

    let alertTriggered = existing.alertTriggered;
    if (priceUpdated && existing.targetAlertPrice !== null) {
      alertTriggered = dto.currentPrice! <= existing.targetAlertPrice;
    }

    const updated = await this.prisma.competitorTracker.update({
      where: { id },
      data: {
        ...(dto.productTitle && { productTitle: dto.productTitle }),
        ...(priceUpdated && {
          previousPrice: existing.currentPrice,
          currentPrice: dto.currentPrice,
        }),
        ...(dto.targetAlertPrice !== undefined && {
          targetAlertPrice: dto.targetAlertPrice,
        }),
        ...(dto.availability && { availability: dto.availability }),
        alertTriggered,
        lastCheckedAt: new Date(),
      },
    });

    if (priceUpdated) {
      const delta = (dto.currentPrice! - existing.currentPrice).toFixed(2);
      const emoji = dto.currentPrice! < existing.currentPrice ? '📉' : '📈';
      this.logger.log(
        `${emoji} Price Update: "${existing.productTitle}" $${existing.currentPrice} → $${dto.currentPrice} (Δ${delta})`,
      );

      if (alertTriggered && !existing.alertTriggered) {
        this.logger.warn(
          `🚨 ALERT TRIGGERED: "${existing.productTitle}" hit target price $${existing.targetAlertPrice}!`,
        );
      }
    }

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ৬. ট্র্যাকার মুছে ফেলা
  // ─────────────────────────────────────────────────────────────────────────────
  async deleteTracker(id: string) {
    const existing = await this.prisma.competitorTracker.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Tracker ID "${id}" পাওয়া যায়নি`);
    }

    await this.prisma.competitorTracker.delete({ where: { id } });

    this.logger.log(`🗑️ Tracker Deleted: "${existing.productTitle}" [${id}]`);

    return { success: true, message: `ট্র্যাকার মুছে ফেলা হয়েছে` };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ৭. ড্যাশবোর্ড সামারি — সোর্স অনুযায়ী গ্রুপড স্ট্যাটিস্টিক্স
  // ─────────────────────────────────────────────────────────────────────────────
  async getDashboardSummary() {
    const [total, alerts, bySource] = await Promise.all([
      this.prisma.competitorTracker.count(),
      this.prisma.competitorTracker.count({ where: { alertTriggered: true } }),
      this.prisma.competitorTracker.groupBy({
        by: ['source'],
        _count: { _all: true },
        _avg: { currentPrice: true },
        _min: { currentPrice: true },
        _max: { currentPrice: true },
      }),
    ]);

    const recentAlerts = await this.prisma.competitorTracker.findMany({
      where: { alertTriggered: true },
      orderBy: { lastCheckedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        productTitle: true,
        source: true,
        currentPrice: true,
        targetAlertPrice: true,
        lastCheckedAt: true,
      },
    });

    return {
      totalTrackers: total,
      activeAlerts: alerts,
      bySource: bySource.map((s) => ({
        source: s.source,
        count: s._count._all,
        avgPrice: parseFloat((s._avg.currentPrice ?? 0).toFixed(2)),
        minPrice: s._min.currentPrice,
        maxPrice: s._max.currentPrice,
      })),
      recentAlerts,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ৮. Alert Reset — একটি ট্র্যাকারের এলার্ট ম্যানুয়ালি ক্লিয়ার করা
  // ─────────────────────────────────────────────────────────────────────────────
  async resetAlert(id: string) {
    const existing = await this.prisma.competitorTracker.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Tracker ID "${id}" পাওয়া যায়নি`);
    }

    await this.prisma.competitorTracker.update({
      where: { id },
      data: { alertTriggered: false },
    });

    this.logger.log(
      `✅ Alert Reset: "${existing.productTitle}" [${id}] — এলার্ট ক্লিয়ার করা হয়েছে`,
    );

    return { success: true, message: 'এলার্ট রিসেট করা হয়েছে' };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ৯. URL থেকে মার্কেটপ্লেস আইডি পার্স করা (Public Utility Endpoint)
  // ─────────────────────────────────────────────────────────────────────────────
  parseMarketplaceId(productUrl: string, source: string) {
    const id = this.extractMarketplaceId(productUrl, source);
    return {
      source,
      productUrl,
      marketplaceId: id,
      type:
        source === 'amazon' ? 'ASIN' : source === 'walmart' ? 'Walmart Item ID' : source === 'ebay' ? 'eBay Item ID' : 'N/A',
      found: id !== null,
    };
  }
}

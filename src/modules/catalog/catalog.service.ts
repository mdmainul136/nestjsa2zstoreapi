import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { AiService } from '../ai/ai.service';
import { MediaService } from '../media/media.service';
import { ExtensionSyncDto } from './dto/extension-sync.dto';
import { GetProductsQueryDto } from './dto/get-products-query.dto';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingService: PricingService,
    private readonly aiService: AiService,
    private readonly mediaService: MediaService,
  ) {}

  // --- Live Scrape Queue ---
  private pendingLiveTasks = new Map<string, { url: string, resolve: (data: any) => void, reject: (err: any) => void }>();

  async requestLiveScrape(url: string, timeoutMs = 25000): Promise<any> {
    const { randomUUID } = require('crypto');
    const taskId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingLiveTasks.delete(taskId);
        reject(new Error("Live scraper timeout (is the extension running?)"));
      }, timeoutMs);

      this.pendingLiveTasks.set(taskId, {
        url,
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });
    });
  }

  getPendingLiveTasks() {
    return Array.from(this.pendingLiveTasks.entries()).map(([id, task]) => ({ id, url: task.url }));
  }

  submitLiveTaskResult(id: string, payload: { success: boolean, data?: any, error?: string }) {
    const task = this.pendingLiveTasks.get(id);
    if (!task) return false;
    this.pendingLiveTasks.delete(id);
    if (payload.success) task.resolve(payload.data);
    else task.reject(new Error(payload.error || 'Scrape failed'));
    return true;
  }
  // -------------------------

  /**
   * parseWeightToKg — shared weight unit converter used across all ingest paths.
   * Handles oz, fl oz, g, ml, lb, kg. Returns null if unparseable.
   */
  private parseWeightToKg(text: any): number | null {
    if (text === null || text === undefined || text === '') return null;
    const str = String(text).trim();

    // Pure numeric — treat as kg if between 0.01 and 50
    if (/^\d+(?:\.\d+)?$/.test(str)) {
      const num = parseFloat(str);
      if (num >= 0.01 && num <= 50) return num;
    }

    // Pack multiplier
    let pack = 1;
    const pm = str.match(/(?:pack\s*of\s*(\d+)|(\d+)\s*[-–]?\s*pack|\((\d+)\s*pack\))/i);
    if (pm) {
      pack = Math.min(parseInt(pm[1] || pm[2] || pm[3] || '1', 10), 24);
      if (pack < 1) pack = 1;
    }

    // lb / lbs / pounds
    const lb = str.match(/(\d*\.?\d+)\s*(?:lbs?|pounds?)\b/i);
    if (lb) return parseFloat((parseFloat(lb[1]) * 0.453592 * pack).toFixed(3));

    // oz / fl oz — take the LARGEST match to avoid sub-oz conversions from parentheticals
    const ozAll = [...str.matchAll(/(\d*\.?\d+)\s*(?:fl\.?\s*oz|fluid\s*ounces?|ounces?|oz)\b/gi)];
    if (ozAll.length > 0) {
      const best = ozAll.reduce((a, b) => parseFloat(a[1]) >= parseFloat(b[1]) ? a : b);
      const oz = parseFloat(best[1]);
      const net = oz * 0.0283495 * pack;
      const tare = oz > 8 ? 0.1 : oz > 4 ? 0.07 : 0.04;
      return parseFloat((net + tare).toFixed(3));
    }

    // kg / kilograms
    const kg = str.match(/(\d*\.?\d+)\s*(?:kg|kilos?|kilograms?)\b/i);
    if (kg) return parseFloat((parseFloat(kg[1]) * pack).toFixed(3));

    // ml / milliliters
    const ml = str.match(/(\d*\.?\d+)\s*(?:ml|milliliters?)\b/i);
    if (ml) {
      const net = (parseFloat(ml[1]) / 1000) * pack;
      const tare = net > 0.25 ? 0.08 : 0.04;
      return parseFloat((net + tare).toFixed(3));
    }

    // g / grams — but NOT mg (supplement active ingredient dosage is not shipping weight)
    const gm = str.match(/(\d*\.?\d+)\s*(?:grams?|gm)\b|(?<!\d)(\d*\.?\d+)\s*g(?!m\b)/i);
    if (gm) {
      const raw = parseFloat(gm[1] || gm[2] || '0');
      if (raw > 0 && raw < 5000) {
        const net = (raw / 1000) * pack;
        const tare = net > 0.2 ? 0.05 : 0.02;
        return parseFloat((net + tare).toFixed(3));
      }
    }

    return null;
  }

  /**
   * parsePricePerUnitToKg — Computes exact product weight mathematically from Walmart/Target price_per_unit:
   * e.g. Price "$32.78" and price_per_unit "$40.98/lb" => 32.78 / 40.98 = 0.8 lbs = 0.363 kg.
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
   * detectWeightKg — resolves the shipping weight from all available data sources.
   * Priority: direct numeric fields → product_specs array → specs object → price_per_unit → variation sizes/titles → product title.
   * Returns parsed weight in kg, or fallback (default 0.1) if nothing genuine is present.
   */
  private detectWeightKg(payload: any, title: string, fallback = 0.1): number {
    const innerData = payload?.data || {};
    const innerRaw = payload?.raw || {};
    const pim = payload?.pim_data || {};

    // 1. Direct numeric weight fields
    const directCandidates = [
      pim.weight, pim.weight_kg,
      payload.weight_kg, innerData.weight_kg, innerRaw.weight_kg,
      payload.weight, innerData.weight, innerRaw.weight,
      payload.shipping_weight, innerData.shipping_weight, innerRaw.shipping_weight,
    ];
    for (const c of directCandidates) {
      if (c === null || c === undefined || c === '') continue;
      const kg = this.parseWeightToKg(c);
      if (kg && kg >= 0.01 && kg <= 50) return kg;
    }

    // 2. Product Specs array (Amazon / Walmart / Target specs array)
    const specsList: any[] = [];
    if (Array.isArray(innerData.product_specs)) specsList.push(...innerData.product_specs);
    if (Array.isArray(payload.product_specs)) specsList.push(...payload.product_specs);
    if (Array.isArray((payload as any).specs)) specsList.push(...(payload as any).specs);
    if (Array.isArray(innerRaw.product_specs)) specsList.push(...innerRaw.product_specs);
    if (Array.isArray(innerData.specifications)) specsList.push(...innerData.specifications);
    if (Array.isArray(payload.specifications)) specsList.push(...payload.specifications);

    for (const s of specsList) {
      const name = String(s?.name || s?.key || s?.displayName || '').toLowerCase().trim();
      const val = String(s?.value || (Array.isArray(s?.values) ? s.values.join(', ') : '') || '').trim();

      // Skip product identifiers / codes (e.g. ASIN "B0F3L5R5LB", Model numbers, UPC, SKU)
      if (/asin|model\s*number|item\s*model|part\s*number|manufacturer\s*part|upc|gtin|barcode|sku|isbn/i.test(name)) continue;
      if (/^[A-Z0-9_-]{8,20}$/i.test(val) && !/\b(?:oz|ounces?|lbs?|pounds?|kg|kilograms?|g|grams?)\b/i.test(val)) continue;

      // Skip weight limits / capacity / max load recommendations
      if (
        /limit|capacity|recommendation|bearing|support|holding/i.test(name) ||
        /max(?:imum)?\s*(?:load|weight)/i.test(name) ||
        (/max/i.test(name) && /weight|load/i.test(name))
      ) {
        continue;
      }

      if (/weight|dimension|size|volume|quantity|content|serving/i.test(name)) {
        const kg = this.parseWeightToKg(val);
        if (kg && kg >= 0.01 && kg <= 50) return kg;
      }
      // Also check if val itself contains weight units
      if (/(\d*\.?\d+)\s*(?:ounces?|oz|floz|fl\.?\s*oz|lbs?|pounds?|kilograms?|kg|grams?|gm)\b/i.test(val)) {
        const kg = this.parseWeightToKg(val);
        if (kg && kg >= 0.01 && kg <= 50) return kg;
      }
    }

    // 3. Specs object keys containing 'weight', 'size', 'volume', or values with weight units
    const specs = payload.specifications || pim.specifications || innerData.specifications || innerRaw.specifications || (payload as any).specs;
    if (specs && typeof specs === 'object' && !Array.isArray(specs)) {
      for (const [k, v] of Object.entries(specs)) {
        const vStr = String(v || '').trim();
        if (/weight|dimension|size|volume|quantity|capacity|content/i.test(k) || /(\d*\.?\d+)\s*(?:oz|floz|lbs?|kg|grams?|gm)\b/i.test(vStr)) {
          const kg = this.parseWeightToKg(vStr);
          if (kg && kg >= 0.01 && kg <= 50) return kg;
        }
      }
    }

    // 4. Price-per-unit mathematical calculation (e.g. Walmart "$40.98/lb" + "$32.78")
    const ppu = payload?.price_per_unit || innerRaw?.price_per_unit || innerData?.price_per_unit;
    const pVal = payload?.price || innerRaw?.price || innerData?.price || payload?.raw_price || innerRaw?.raw_price || payload?.priceParsed;
    if (ppu && pVal) {
      const kg = this.parsePricePerUnitToKg(pVal, ppu);
      if (kg && kg >= 0.01 && kg <= 50) return kg;
    }

    // 5. Variation sizes / titles / price_per_unit — use the MINIMUM (lightest) variant weight for the product base
    const varSource = payload.variations || innerData.variations || innerRaw.variations || payload.variants || pim?.variants || [];
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
      const varWeightsKg: number[] = [];
      for (const v of varList) {
        const explicit = v.weightKg ?? v.weight_kg ?? v.weight;
        if (explicit) {
          const kg = this.parseWeightToKg(explicit);
          if (kg && kg > 0) varWeightsKg.push(kg);
        } else if (v.price_per_unit && (v.price || v.raw_price)) {
          const kg = this.parsePricePerUnitToKg(v.price || v.raw_price, v.price_per_unit);
          if (kg && kg > 0) varWeightsKg.push(kg);
        } else {
          const text = `${v?.title || ''} ${v?.size || ''}`.trim();
          const kg = text ? this.parseWeightToKg(text) : null;
          if (kg && kg > 0) varWeightsKg.push(kg);
        }
      }
      if (varWeightsKg.length > 0) return Math.min(...varWeightsKg);
    }

    // 6. Product title
    if (title) {
      const kg = this.parseWeightToKg(title);
      if (kg && kg >= 0.01) return kg;
    }

    // 7. Smart Category & Dimension Estimation (for items without weight on Amazon)
    const categoryEst = this.estimateCategoryWeightFallback(
      title,
      payload?.category || innerData?.category || innerRaw?.category || '',
      payload?.description || innerData?.description || '',
      specsList,
      payload?.length || innerData?.length,
      payload?.width || innerData?.width,
      payload?.height || innerData?.height,
      payload?.dimensions_unit || 'in'
    );
    if (categoryEst && categoryEst > 0) return categoryEst;

    return fallback;
  }

  private estimateCategoryWeightFallback(
    title: string,
    category: string,
    description: string,
    specs: any[] = [],
    length?: any,
    width?: any,
    height?: any,
    dimUnit = 'in'
  ): number | null {
    const text = `${title} ${category} ${description}`.toLowerCase();

    // Pack count multiplier
    let pack = 1;
    const pm = text.match(/\b(\d+)\s*[-–]?\s*(?:pack|pk|count|pcs|pieces)\b/i) ||
               text.match(/(?:pack\s*of\s*(\d+)|set\s*of\s*(\d+)|\((\d+)\s*pack\))/i);
    if (pm) {
      pack = Math.min(Math.max(parseInt(pm[1] || pm[2] || pm[3] || '1', 10), 1), 24);
    }
    for (const s of specs) {
      const sName = String(s?.name || s?.key || '').toLowerCase();
      const sVal = String(s?.value || '');
      if (/pack|unit\s*count|number\s*of\s*items/i.test(sName)) {
        const m = sVal.match(/(\d+)/);
        if (m && parseInt(m[1], 10) > 1) pack = Math.max(pack, parseInt(m[1], 10));
      }
    }

    if (/walkie\s*talkie|two[- ]way\s*radio|frs\s*radio|transceiver|cb\s*radio/i.test(text)) {
      return parseFloat((Math.max(0.25, 0.14 * pack + 0.08)).toFixed(3));
    }
    if (/earbuds?|airpods?|in-ear\s*headphones?|tws\b/i.test(text)) return 0.15;
    if (/headphones?|headset\b/i.test(text)) return 0.35;
    if (/phone\s*case|cover\s*case|screen\s*protector/i.test(text)) return parseFloat((0.08 * pack).toFixed(3));
    if (/charger|power\s*adapter|charging\s*cable|usb[- ]c\s*cable/i.test(text)) return parseFloat((Math.max(0.12, 0.10 * pack)).toFixed(3));
    if (/power\s*bank|portable\s*charger/i.test(text)) return 0.35;
    if (/smartwatch|fitness\s*tracker|smart\s*band/i.test(text)) return 0.18;
    if (/bluetooth\s*speaker|portable\s*speaker/i.test(text)) return 0.50;
    if (/tripod|selfie\s*stick|monopod|phone\s*stand|camera\s*stand/i.test(text)) return 0.45;

    if (/shoes?|sneakers?|boots?|running\s*shoes?/i.test(text)) return 0.95;
    if (/t[- ]shirt|tee\b|polo\s*shirt|tank\s*top/i.test(text)) return parseFloat((0.22 * pack).toFixed(3));
    if (/hoodie|sweatshirt|sweater/i.test(text)) return parseFloat((0.55 * pack).toFixed(3));
    if (/jeans|denim\s*pants|trousers/i.test(text)) return parseFloat((0.55 * pack).toFixed(3));
    if (/jacket|coat|blazer/i.test(text)) return 0.85;
    if (/backpack|rucksack/i.test(text)) return 0.65;
    if (/handbag|purse|tote\s*bag/i.test(text)) return 0.50;

    // Bedding, Comforters, Blankets, Quilts & Pillows
    if (/comforter|duvet(?:\s*insert)?|quilt|bedspread|down\s*alternative/i.test(text)) {
      if (/california\s*king|cal\s*king/i.test(text)) return parseFloat((2.60 * pack).toFixed(3));
      if (/\bking\b/i.test(text)) return parseFloat((2.70 * pack).toFixed(3));
      if (/\bqueen\b/i.test(text)) return parseFloat((2.20 * pack).toFixed(3));
      if (/\bfull\b|\bdouble\b/i.test(text)) return parseFloat((1.80 * pack).toFixed(3));
      if (/twin\s*xl/i.test(text)) return parseFloat((1.86 * pack).toFixed(3));
      if (/\btwin\b/i.test(text)) return parseFloat((1.70 * pack).toFixed(3));
      return parseFloat((2.20 * pack).toFixed(3));
    }
    if (/blanket|throw\s*blanket|fleece\s*blanket/i.test(text)) {
      if (/\bking\b/i.test(text)) return parseFloat((1.80 * pack).toFixed(3));
      if (/\bqueen\b/i.test(text)) return parseFloat((1.50 * pack).toFixed(3));
      if (/\btwin\b/i.test(text)) return parseFloat((1.10 * pack).toFixed(3));
      return parseFloat((1.30 * pack).toFixed(3));
    }
    if (/sheet\s*set|bed\s*sheet|fitted\s*sheet/i.test(text)) {
      if (/\bking\b/i.test(text)) return parseFloat((1.50 * pack).toFixed(3));
      if (/\bqueen\b/i.test(text)) return parseFloat((1.30 * pack).toFixed(3));
      if (/\btwin\b/i.test(text)) return parseFloat((0.95 * pack).toFixed(3));
      return parseFloat((1.20 * pack).toFixed(3));
    }
    if (/pillow|cushion/i.test(text) && !/pillow\s*case|cushion\s*cover/i.test(text)) {
      return parseFloat((0.85 * pack).toFixed(3));
    }

    if (/water\s*bottle|tumbler|thermos|flask|insulated\s*bottle/i.test(text)) {
      if (/40\s*(?:oz|ounces?)/i.test(text)) return parseFloat((0.54 * pack).toFixed(3));
      if (/32\s*(?:oz|ounces?)/i.test(text)) return parseFloat((0.43 * pack).toFixed(3));
      if (/24\s*(?:oz|ounces?)/i.test(text)) return parseFloat((0.38 * pack).toFixed(3));
      if (/16\s*(?:oz|ounces?)/i.test(text)) return parseFloat((0.32 * pack).toFixed(3));
      return parseFloat((0.40 * pack).toFixed(3));
    }

    if (/lipstick|lip\s*gloss|lip\s*balm|mascara|eyeliner/i.test(text)) return parseFloat((0.08 * pack).toFixed(3));
    if (/serum|facial\s*oil|eye\s*cream/i.test(text)) return 0.18;
    if (/face\s*cream|moisturizer|body\s*lotion/i.test(text)) return 0.30;
    if (/perfume|cologne|eau\s*de\s*parfum/i.test(text)) return 0.35;

    // Supplements, Powders & Sports Nutrition
    if (/protein\s*powder|whey\b|mass\s*gainer/i.test(text)) {
      if (/5\s*(?:lbs?|pounds?)/i.test(text)) return 2.45;
      if (/2\s*(?:lbs?|pounds?)/i.test(text)) return 1.05;
      return 1.10;
    }
    if (/bcaa|pre[- ]workout|creatine|amino|electrolyte\s*powder|supplement\s*powder/i.test(text)) {
      const sMatch = text.match(/(\d+)\s*servings?\b/i);
      const servings = sMatch ? parseInt(sMatch[1], 10) : 30;
      if (servings >= 60) return parseFloat((0.48 * pack).toFixed(3));
      if (servings >= 45) return parseFloat((0.38 * pack).toFixed(3));
      return parseFloat((0.32 * pack).toFixed(3));
    }
    if (/vitamin|supplement|capsules|tablets|softgels|gummies/i.test(text)) return parseFloat((0.20 * pack).toFixed(3));

    // Dimensions volumetric fallback
    const l = parseFloat(String(length || ''));
    const w = parseFloat(String(width || ''));
    const h = parseFloat(String(height || ''));
    if (!isNaN(l) && !isNaN(w) && !isNaN(h) && l > 0 && w > 0 && h > 0) {
      const mult = dimUnit === 'in' ? 2.54 : 1.0;
      const volCm3 = (l * mult) * (w * mult) * (h * mult) * pack;
      const volKg = volCm3 / 5000;
      return parseFloat(Math.max(0.20, Math.min(volKg, 50)).toFixed(3));
    }

    return 0.30;
  }

  /**
   * detectCategorySmart — resolves 3-tier category hierarchy when scraped category is generic or empty.
   */
  private detectCategorySmart(
    title: string,
    desc?: string,
    payload?: any
  ): { category: string; subcategory: string; subSubcategory?: string } {
    const specsList: any[] = [];
    if (Array.isArray(payload?.data?.product_specs)) specsList.push(...payload.data.product_specs);
    if (Array.isArray(payload?.product_specs)) specsList.push(...payload.product_specs);
    if (Array.isArray(payload?.raw?.product_specs)) specsList.push(...payload.raw.product_specs);
    const specText = specsList.map((s) => `${s?.name || ''} ${s?.value || ''}`).join(' ');

    const combined = `${title || ''} ${desc || ''} ${specText}`.toLowerCase();

    // 1. Vitamins, Supplements & Health Nutrition
    if (
      /vitamin|supplement|softgel|capsule|tablet|probiotic|enzyme|multivitamin|multi|gummy|gummies|drops|chew|chews|nutrition|omega|collagen|calcium|zinc|biotin|iron|herbal|dietary|organics|coq10|ashwagandha|flaxseed|fish oil|melatonin|echinacea|cinnamon|dhea|elderberry|peptides|creatine|bcaa|protein|electrolyte/i.test(
        combined
      )
    ) {
      let subSub = 'Dietary Supplements';
      if (/multivitamin|multi[- ]vitamin/i.test(combined)) {
        subSub = 'Multivitamins';
      } else if (/protein|whey|creatine|bcaa|amino|mass gainer/i.test(combined)) {
        subSub = 'Protein Powders & Nutrition';
      } else if (/first aid|bandage|antiseptic/i.test(combined)) {
        subSub = 'First Aid Kits';
      }

      return {
        category: 'Health & Household',
        subcategory: 'Vitamins & Wellness',
        subSubcategory: subSub,
      };
    }

    // 2. Beauty, Skincare, Haircare, Fragrance & Makeup
    if (
      /shampoo|conditioner|serum|cream|lotion|sunscreen|moisturizer|lipstick|lip\s*gloss|mascara|eyeliner|eyeshadow|foundation|concealer|perfume|cologne|skincare|cosmetic|face wash|body wash|shower gel|cleanser|facial|toner|exfoliator/i.test(
        combined
      )
    ) {
      if (/lipstick|lip\s*gloss|mascara|eyeliner|eyeshadow|foundation|concealer|powder|blush|makeup|nail polish/i.test(combined)) {
        const subSub = /eye|mascara|eyeliner|eyeshadow/i.test(combined) ? 'Eye Makeup' : 'Face Makeup';
        return {
          category: 'Beauty & Personal Care',
          subcategory: 'Makeup',
          subSubcategory: subSub,
        };
      }
      if (/shampoo|conditioner|hair\s*oil|hair\s*mask|styling|pomade/i.test(combined)) {
        return {
          category: 'Beauty & Personal Care',
          subcategory: 'Hair Care',
          subSubcategory: 'Shampoo & Conditioner',
        };
      }
      if (/perfume|cologne|eau\s*de\s*parfum|fragrance/i.test(combined)) {
        return {
          category: 'Beauty & Personal Care',
          subcategory: 'Fragrance & Grooming',
          subSubcategory: 'Perfumes & Colognes',
        };
      }
      let subSub = 'Moisturizers & Creams';
      if (/face wash|cleanser|cleansing/i.test(combined)) subSub = 'Face Cleansers';
      else if (/sunscreen|spf|sunblock/i.test(combined)) subSub = 'Sunscreen';
      else if (/serum|peel|treatment/i.test(combined)) subSub = 'Serums & Treatments';

      return {
        category: 'Beauty & Personal Care',
        subcategory: 'Skincare',
        subSubcategory: subSub,
      };
    }

    // 3. Baby & Child Care
    if (/baby|infant|toddler|newborn|tear-free|pediatrician|diaper/i.test(combined)) {
      return {
        category: 'Health & Household',
        subcategory: 'Personal Care',
        subSubcategory: 'Oral Care & Toothbrushes',
      };
    }

    // 4. Electronics & Gadgets
    if (/phone|laptop|macbook|ipad|headphone|earbud|airpod|charger|cable|smartwatch|camera|smartphones/i.test(combined)) {
      return {
        category: 'Electronics & Gadgets',
        subcategory: /phone|iphone|galaxy/i.test(combined) ? 'Smartphones & Mobile' : 'Audio & Headphones',
        subSubcategory: /earbud|headphone/i.test(combined) ? 'Wireless Earbuds' : 'Accessories',
      };
    }

    // 5. Fashion & Footwear
    if (/shirt|pant|shoe|sneaker|dress|jacket|hoodie|t-shirt|boot|handbag|tote|sandal/i.test(combined)) {
      return {
        category: 'Apparel & Accessories',
        subcategory: /shoe|sneaker|boot|sandal/i.test(combined) ? 'Shoes' : 'Clothing',
        subSubcategory: /sneaker/i.test(combined) ? 'Sneakers' : /boot/i.test(combined) ? 'Boots' : 'General',
      };
    }

    // 6. Home & Kitchen
    if (/kitchen|dining|cookware|pan|pot|blender|bedding|sheet|pillow|duvet/i.test(combined)) {
      return {
        category: 'Home & Kitchen',
        subcategory: /bedding|sheet|pillow|duvet/i.test(combined) ? 'Bedding' : 'Kitchen & Dining',
        subSubcategory: /bedding|sheet|duvet/i.test(combined) ? 'Duvets & Sets' : 'Kitchen Tools & Utensils',
      };
    }

    return {
      category: 'General Catalogue',
      subcategory: 'Other Products',
      subSubcategory: '_other',
    };
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * ব্র্যান্ড নিরাপদভাবে খোঁজা বা তৈরি করা (কেস-ইনসেনসিটিভ ও স্লাগ ইউনিকনেস কনফ্লিক্ট মুক্ত)
   */
  async findOrCreateBrand(rawBrandName: string) {
    const brandName = (rawBrandName || 'Generic').trim();
    const brandSlug = this.slugify(brandName) || 'generic';

    // ১. প্রথমে slug দিয়ে খুঁজুন (কারণ slug সবসময় ইউনিক ও স্বাভাবিকীকৃত)
    let brand = await this.prisma.brand.findUnique({
      where: { slug: brandSlug },
    });

    // ২. যদি slug দিয়ে না পাওয়া যায়, তবে case-insensitive name বা aliases দিয়ে খুঁজুন
    if (!brand) {
      brand = await this.prisma.brand.findFirst({
        where: {
          OR: [
            { name: { equals: brandName, mode: 'insensitive' } },
            { aliases: { has: brandName } },
          ],
        },
      });
    }

    // ৩. যদি তখনও না থাকে, তবে নিরাপদে তৈরি করুন
    if (!brand) {
      const existingSlug = await this.prisma.brand.findUnique({ where: { slug: brandSlug } });
      const finalSlug = existingSlug ? `${brandSlug}-${Math.floor(1000 + Math.random() * 9000)}` : brandSlug;
      try {
        brand = await this.prisma.brand.create({
          data: {
            name: brandName,
            slug: finalSlug,
            aliases: [brandName],
          },
        });
      } catch (err: any) {
        // কনকারেন্ট রেস-কন্ডিশনে যদি অন্য কোনো ব্যাকগ্রাউন্ড টাস্ক একই মুহূর্তে তৈরি করে ফেলে
        brand = await this.prisma.brand.findFirst({
          where: {
            OR: [
              { slug: brandSlug },
              { name: { equals: brandName, mode: 'insensitive' } },
            ],
          },
        });
        if (!brand) throw err;
      }
    }

    return brand;
  }

  /**
   * ১. ক্রোম এক্সটেনশন সিঙ্ক (Ingest from Chrome Extension)
   */
  async syncFromExtension(payload: ExtensionSyncDto) {
    // ১. এক্সটেনশন পে-লোড থেকে তথ্য স্যানিটাইজ করা
    const asin = (payload.asin || payload.product_id || payload.productId || payload.variant_asin || '').trim();
    if (!asin) {
      throw new BadRequestException('asin or product_id is required for extension sync');
    }
    const title = (payload.title || 'Untitled Product').trim();
    const source = (payload.source || 'amazon').toLowerCase().trim();
    const sourceUrl = payload.url || (source === 'amazon' ? `https://www.amazon.com/dp/${asin}` : `https://www.walmart.com/ip/${asin}`);

    // Helper functions for safe type parsing
    const parseNum = (val: any, fallback: number | null = null): number | null => {
      if (val === null || val === undefined || val === '') return fallback;
      const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? fallback : n;
    };

    // ক. ব্র্যান্ড Upsert (Unique constraint safe & case-insensitive)
    const brandName = payload.brand?.trim() || 'Generic';
    const brand = await this.findOrCreateBrand(brandName);

    // খ. ক্যাটাগরি Upsert (with 3-tier hierarchy automation & Mapping)
    const isGenericCat = (c?: string | null) => {
      if (!c || typeof c !== 'string') return true;
      const l = c.toLowerCase().trim();
      return !l || l === 'ecommerce' || l === 'general' || l === 'default' || l === 'uncategorized' || l === 'unknown';
    };

    const explicitCat = payload.category?.trim();
    const explicitSub = payload.subcategory?.trim();
    const explicitSubSub = payload.subSubcategory?.trim();

    let parts: string[] = [];

    // ১. যদি ইউজার বা কলার নিজে এক্সপ্লিসিট সাবক্যাটাগরি বা চাইল্ড ক্যাটাগরি সিলেক্ট করে (e.g. PIM Editor)
    if (explicitCat && !isGenericCat(explicitCat) && (explicitSub || explicitSubSub)) {
      parts = [explicitCat];
      if (explicitSub) parts.push(explicitSub);
      if (explicitSubSub) parts.push(explicitSubSub);
      payload.subcategory = explicitSub || undefined;
      payload.subSubcategory = explicitSubSub || undefined;
    } else {
      let rawCategoryName = explicitCat || '';
      if (isGenericCat(rawCategoryName)) {
        const altCat = (payload as any).data?.category || (payload as any).raw?.category;
        if (altCat && !isGenericCat(altCat)) {
          rawCategoryName = altCat.trim();
        } else {
          rawCategoryName = 'General';
        }
      }
      let mappedCategoryName = rawCategoryName;

      // শুধুমাত্র অটোমেটিক স্ক্র্যাপড পাথ হলে ScrapedCategoryMapping চেক করা হবে
      if (mappedCategoryName.includes('>') || mappedCategoryName.includes(' > ')) {
        try {
          const mapping = await this.prisma.scrapedCategoryMapping.findUnique({
            where: {
              source_rawCategory: {
                source: source,
                rawCategory: rawCategoryName,
              },
            },
          });

          if (mapping && mapping.isAutoApproved && mapping.mappedCategory) {
            const mappedParts = [mapping.mappedCategory];
            if (mapping.mappedSubcategory) mappedParts.push(mapping.mappedSubcategory);
            if (mapping.mappedSubSubcat) mappedParts.push(mapping.mappedSubSubcat);
            mappedCategoryName = mappedParts.join(' > ');
          }
        } catch (e: any) {
          this.logger.warn(`Failed to process ScrapedCategoryMapping: ${e?.message}`);
        }
      }

      if (mappedCategoryName.includes('>') || mappedCategoryName.includes(' > ')) {
        parts = mappedCategoryName.split(/\s*>\s*/).map((p) => p.trim()).filter(Boolean);
        payload.subcategory = parts[1] || undefined;
        payload.subSubcategory = parts[2] || undefined;
      } else if (!isGenericCat(mappedCategoryName)) {
        parts = [mappedCategoryName];
        if (explicitSub) payload.subcategory = explicitSub;
        if (explicitSubSub) payload.subSubcategory = explicitSubSub;
      } else {
        const smart = this.detectCategorySmart(title, payload.description, payload);
        parts = [smart.category];
        if (smart.subcategory) parts.push(smart.subcategory);
        if (smart.subSubcategory) parts.push(smart.subSubcategory);
        payload.subcategory = smart.subcategory;
        payload.subSubcategory = smart.subSubcategory;
      }
    }

    let category: any = null;
    let currentParentId: string | null = null;
    let lastCat: any = null;

    for (let i = 0; i < Math.min(parts.length, 3); i++) {
      const partName = parts[i];
      let slug = this.slugify(partName) || `cat-${i}`;

      let cat: any = await this.prisma.category.findFirst({
        where: {
          name: { equals: partName, mode: 'insensitive' },
          parentId: currentParentId,
        },
      });

      if (!cat) {
        const existingSlug = await this.prisma.category.findUnique({ where: { slug } });
        if (existingSlug) {
          slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
        }
        cat = await this.prisma.category.create({
          data: {
            name: partName,
            slug,
            parentId: currentParentId,
            displayOrder: i,
            isPublished: true,
            isFeatured: false,
          },
        });
      }
      currentParentId = cat.id;
      lastCat = cat;
    }

    category = lastCat || { id: '', name: parts[0] || 'General' };

    // গ. সোর্স প্রাইস পার্সিং ও চূড়ান্ত বিক্রয়মূল্য হিসাব
    const sourcePriceUsd =
      typeof payload.source_price === 'number'
        ? payload.source_price
        : typeof payload.price === 'number'
        ? payload.price
        : parseFloat(String(payload.price || payload.source_price || '0.0').replace(/[^0-9.]/g, '')) || 10.0;

    // চ. স্ট্যাটাস এবং স্টক নির্ধারণ
    let productStatus: ProductStatus | undefined = undefined;
    if (payload.status) {
      const s = payload.status.toUpperCase();
      if (s === 'DRAFT' || s === 'PUBLISHED' || s === 'ARCHIVED' || s === 'OUT_OF_STOCK') {
        productStatus = s as ProductStatus;
      }
    }

    const explicitWeight = payload.weight_kg ?? (payload as any).weightKg ?? payload.weight;
    let resolvedWeightKg =
      explicitWeight !== undefined && explicitWeight !== null && Number(explicitWeight) > 0
        ? Number(explicitWeight)
        : this.detectWeightKg(payload, title);

    // Strict Live-Publish Weight Validation with AI Estimation fallback
    if (productStatus === ProductStatus.PUBLISHED && (!resolvedWeightKg || resolvedWeightKg <= 0)) {
      try {
        const aiEst = await this.aiService.estimateWeightOnly({
          title: title,
          category: category.name || '',
          description: payload.description || '',
          variations: payload.variations || [],
        });
        if (aiEst?.success && aiEst.weightKg > 0) {
          resolvedWeightKg = aiEst.weightKg;
          this.logger.log(`✨ AI estimated shipping weight for LIVE product "${title}": ${resolvedWeightKg} kg (${aiEst.reasoning})`);
        }
      } catch (e: any) {
        this.logger.warn(`AI weight estimation failed in syncFromExtension: ${e?.message}`);
      }

      if (!resolvedWeightKg || resolvedWeightKg <= 0) {
        throw new BadRequestException(
          '❌ Cannot publish product live to storefront without a valid shipping weight. AI weight estimation could not determine a safe shipping weight. Please enter weight manually or save as Draft.'
        );
      }
    }

    const priceCalculation = await this.pricingService.calculateLandedPrice({
      sourcePriceUsd,
      weightKg: resolvedWeightKg,
      categoryId: category.id,
    });

    const allImages = Array.isArray(payload.images) && payload.images.length > 0
      ? payload.images
      : payload.image
        ? [payload.image]
        : [];

    // ঘ. ব্যাজ ও সোশ্যাল প্রুফ মার্জ করা (Best Seller, Bought past month, Discount %)
    const badgeSet = new Set<string>();
    const addBadgeItem = (b: any) => {
      if (!b) return;
      if (Array.isArray(b)) {
        b.forEach(addBadgeItem);
        return;
      }
      if (typeof b === 'string') {
        const s = b.trim();
        if (!s) return;
        if (/amazon'?s\s*choice/i.test(s)) badgeSet.add("Amazon's Choice");
        if (/best\s*seller/i.test(s)) badgeSet.add("Best Seller");
        if (/limited\s*time\s*deal/i.test(s)) badgeSet.add("Limited Time Deal");
        if (/hot\s*deal/i.test(s)) badgeSet.add("Hot Deal");
        if (/authentic/i.test(s)) badgeSet.add("Authentic USA");

        if (s.includes('|') || s.includes(';')) {
          s.split(/[|;]/).map(p => p.trim()).filter(Boolean).forEach(p => {
            if (/amazon'?s\s*choice/i.test(p)) badgeSet.add("Amazon's Choice");
            else if (/best\s*seller/i.test(p)) badgeSet.add("Best Seller");
            else if (/limited\s*time\s*deal/i.test(p)) badgeSet.add("Limited Time Deal");
            else if (/hot\s*deal/i.test(p)) badgeSet.add("Hot Deal");
            else if (/authentic/i.test(p)) badgeSet.add("Authentic USA");
            else if (p.length > 2) badgeSet.add(p);
          });
        } else if (
          !/amazon'?s\s*choice/i.test(s) &&
          !/best\s*seller/i.test(s) &&
          !/limited\s*time\s*deal/i.test(s) &&
          !/hot\s*deal/i.test(s) &&
          !/authentic/i.test(s)
        ) {
          badgeSet.add(s);
        }
      }
    };

    addBadgeItem(payload.badge);
    addBadgeItem((payload as any).badges);

    if (payload.bought_past_month && String(payload.bought_past_month).trim()) {
      badgeSet.add(`${String(payload.bought_past_month).trim()} bought in past month`);
    } else if (payload.sales_volume && String(payload.sales_volume).trim()) {
      badgeSet.add(`${String(payload.sales_volume).trim()} bought recently`);
    }

    if (payload.discount && String(payload.discount).trim()) {
      const discStr = String(payload.discount).trim();
      const formattedDiscount = discStr.toUpperCase().includes('OFF')
        ? discStr
        : `${discStr} OFF`;
      badgeSet.add(formattedDiscount);
    }
    const badges: string[] = Array.from(badgeSet);

    // ঙ. অরিজিনাল প্রাইস ও কাটা দাম (Strikethrough Price) হিসাব
    let discountPriceBdt: number | null = null;
    const rawOrigPrice = parseFloat(
      String(payload.original_price || '').replace(/[^0-9.]/g, '') || '0.0',
    );
    if (!isNaN(rawOrigPrice) && rawOrigPrice > sourcePriceUsd) {
      const origCalc = await this.pricingService.calculateLandedPrice({
        sourcePriceUsd: rawOrigPrice,
        weightKg: resolvedWeightKg,
        categoryId: category.id,
      });
      discountPriceBdt = origCalc.finalSellingPriceBdt;
    }

    let calculatedStock = 10;
    const availLower = payload.availability?.toLowerCase() || '';
    if (
      availLower.includes('out of stock') ||
      availLower.includes('currently unavailable') ||
      availLower.includes('temporarily out of stock')
    ) {
      calculatedStock = 0;
      if (!productStatus) {
        productStatus = ProductStatus.OUT_OF_STOCK;
      }
    } else if (availLower.includes('in stock')) {
      calculatedStock = 10;
    } else if (payload.availability) {
      calculatedStock = 5;
    }

    const productSlug = `${this.slugify(title).slice(0, 80)}-${asin.toLowerCase()}`;

    // ছ. ওয়্যারহাউস ফ্লাইট শিডিউল নোটিশ ও অরিজিন হাব নির্ধারণ (NYC-HUB-01)
    let resolvedDeliveryMessage =
      payload.delivery_message || payload.deliveryMessage || null;
    let resolvedShipsFrom =
      payload.ships_from || payload.shipsFrom || null;

    const isGenericOrDomestic = (msg?: string | null) => {
      if (!msg) return true;
      const l = msg.toLowerCase().trim();
      return (
        l === 'arrives soon' ||
        l.startsWith('arrives soon') ||
        l.includes('free delivery') ||
        l.includes('delivery by') ||
        l === 'arrives in 7-10 days via air express'
      );
    };

    if (isGenericOrDomestic(resolvedDeliveryMessage) || !resolvedShipsFrom || resolvedShipsFrom === 'USA') {
      try {
        const usWarehouses = await this.prisma.consolidatorWarehouse.findMany({
          where: { isActive: true, countryCode: 'US' },
        });

        const sortedWh = [...usWarehouses].sort((a, b) => {
          const dateA = a.nextShipmentDate ? new Date(a.nextShipmentDate).getTime() : Infinity;
          const dateB = b.nextShipmentDate ? new Date(b.nextShipmentDate).getTime() : Infinity;
          return dateA - dateB;
        });

        const activeWh = sortedWh[0];
        if (activeWh) {
          if (isGenericOrDomestic(resolvedDeliveryMessage)) {
            resolvedDeliveryMessage =
              activeWh.shipmentNotice ||
              'Next flight departs on Friday at 5:00 PM EST. Cut-off: Thursday 11:59 PM EST. Estimated arrival in Dhaka: 7 days.';
          }
          if (!resolvedShipsFrom || resolvedShipsFrom === 'USA') {
            resolvedShipsFrom = `${activeWh.city}, ${activeWh.countryCode}`;
          }
        }
      } catch (err) {
        if (isGenericOrDomestic(resolvedDeliveryMessage)) {
          resolvedDeliveryMessage =
            'Next flight departs on Friday at 5:00 PM EST. Cut-off: Thursday 11:59 PM EST. Estimated arrival in Dhaka: 7 days.';
        }
        if (!resolvedShipsFrom || resolvedShipsFrom === 'USA') {
          resolvedShipsFrom = 'New York, US';
        }
      }
    }

    const finalSellingPrice =
      typeof payload.selling_price === 'number' && payload.selling_price > 0
        ? payload.selling_price
        : typeof (payload as any).sellingPrice === 'number' && (payload as any).sellingPrice > 0
        ? (payload as any).sellingPrice
        : priceCalculation.finalSellingPriceBdt;

    // Parse dimensions in CM
    const lengthCmVal = parseNum(payload.lengthCm) ?? (parseNum(payload.length) ? parseNum(payload.length)! * 2.54 : null);
    const widthCmVal = parseNum(payload.widthCm) ?? (parseNum(payload.width) ? parseNum(payload.width)! * 2.54 : null);
    const heightCmVal = parseNum(payload.heightCm) ?? (parseNum(payload.height) ? parseNum(payload.height)! * 2.54 : null);
    const ratingVal = parseNum(payload.rating, 0.0) || 0.0;
    const reviewCountVal = Math.round(parseNum(payload.review_count, 0) || 0);
    const extraPackagingWeightVal = parseNum(payload.extraPackagingWeight) ?? parseNum(payload.extra_packaging_weight) ?? 0.1;

    // জ. প্রিজমা দিয়ে প্রোডাক্ট সেভ/আপডেট
    const product = await this.prisma.product.upsert({
      where: { asin: asin },
      update: {
        sourcePrice: sourcePriceUsd,
        sellingPrice: finalSellingPrice,
        discountPrice: discountPriceBdt,
        title: title,
        description: payload.description,
        images: allImages,
        badge: badges,
        weightKg: resolvedWeightKg,
        stock: calculatedStock,
        specs: (payload.product_specs as any) || [],
        brandId: brand.id,
        categoryId: category.id,
        ...(payload.subcategory !== undefined ? { subcategory: payload.subcategory } : {}),
        ...(payload.subSubcategory !== undefined ? { subSubcategory: payload.subSubcategory } : {}),
        ...(payload.features ? { features: payload.features } : {}),
        ...(productStatus ? { status: productStatus } : {}),
        ...(payload.rating !== undefined ? { rating: ratingVal } : {}),
        ...(payload.review_count !== undefined ? { reviewCount: reviewCountVal } : {}),
        ...(payload.seller_name || payload.sellerName ? { sellerName: payload.seller_name || payload.sellerName } : {}),
        ...(resolvedShipsFrom ? { shipsFrom: resolvedShipsFrom } : {}),
        ...(resolvedDeliveryMessage ? { deliveryMessage: resolvedDeliveryMessage } : {}),
        ...(payload.barcode ? { barcode: payload.barcode } : {}),
        ...(payload.ingredients ? { ingredients: payload.ingredients } : {}),
        ...(payload.extraPackagingWeight !== undefined || payload.extra_packaging_weight !== undefined
          ? { extraPackagingWeight: extraPackagingWeightVal }
          : {}),
        ...(lengthCmVal !== null ? { lengthCm: lengthCmVal } : {}),
        ...(widthCmVal !== null ? { widthCm: widthCmVal } : {}),
        ...(heightCmVal !== null ? { heightCm: heightCmVal } : {}),
        ...(payload.hsCode ? { hsCode: payload.hsCode } : {}),
        ...(payload.originCountry ? { originCountry: payload.originCountry } : {}),
        ...(payload.warranty ? { warranty: payload.warranty } : {}),
        ...(payload.returnPolicy ? { returnPolicy: payload.returnPolicy } : {}),
        ...(payload.tags ? { tags: payload.tags } : {}),
        ...(payload.isFeatured !== undefined ? { isFeatured: payload.isFeatured } : {}),
        ...(payload.slug ? { slug: payload.slug } : {}),
        ...(payload.imageUrl ? { imageUrl: payload.imageUrl } : {}),
        ...(payload.seo?.robots || payload.seo?.robotsMeta ? { robotsMeta: payload.seo?.robots || payload.seo?.robotsMeta } : {}),
        ...(payload.seo?.schemaType ? { schemaType: payload.seo?.schemaType } : {}),
        ...(payload.seo?.canonicalUrl ? { canonicalUrl: payload.seo?.canonicalUrl } : {}),
        ...(payload.seo?.metaKeywords ? { metaKeywords: payload.seo?.metaKeywords } : {}),
        ...(payload.seo?.ogTitle ? { ogTitle: payload.seo?.ogTitle } : {}),
        ...(payload.seo?.ogDescription ? { ogDescription: payload.seo?.ogDescription } : {}),
        ...(payload.seo?.ogImage ? { ogImage: payload.seo?.ogImage } : {}),
      },
      create: {
        asin: asin,
        source: source,
        sourceUrl: sourceUrl,
        title: title,
        slug: payload.slug || productSlug,
        description: payload.description || '',
        features: payload.features || [],
        subcategory: payload.subcategory || null,
        subSubcategory: payload.subSubcategory || null,
        images: allImages,
        imageUrl: payload.imageUrl || (allImages.length > 0 ? allImages[0] : null),
        badge: badges,
        weightKg: resolvedWeightKg,
        lengthCm: lengthCmVal,
        widthCm: widthCmVal,
        heightCm: heightCmVal,
        hsCode: payload.hsCode || '2106.90',
        originCountry: payload.originCountry || 'US',
        warranty: payload.warranty || null,
        returnPolicy: payload.returnPolicy || null,
        tags: payload.tags || [],
        isFeatured: payload.isFeatured ?? false,
        sourcePrice: sourcePriceUsd,
        sellingPrice: priceCalculation.finalSellingPriceBdt,
        discountPrice: discountPriceBdt,
        stock: calculatedStock,
        specs: (payload.product_specs as any) || [],
        brandId: brand.id,
        categoryId: category.id,
        status: productStatus || ProductStatus.DRAFT,
        rating: ratingVal,
        reviewCount: reviewCountVal,
        sellerName: payload.seller_name || payload.sellerName || null,
        shipsFrom: resolvedShipsFrom,
        deliveryMessage: resolvedDeliveryMessage,
        barcode: payload.barcode || null,
        ingredients: payload.ingredients || null,
        extraPackagingWeight: extraPackagingWeightVal,
        robotsMeta: payload.seo?.robots || payload.seo?.robotsMeta || 'index, follow',
        schemaType: payload.seo?.schemaType || 'Product',
        canonicalUrl: payload.seo?.canonicalUrl || `https://a2zoutletstore.com/products/${productSlug}`,
        metaKeywords: payload.seo?.metaKeywords || null,
        ogTitle: payload.seo?.ogTitle || title,
        ogDescription: payload.seo?.ogDescription || (payload.description ? payload.description.slice(0, 155) : title),
        ogImage: payload.seo?.ogImage || (allImages.length > 0 ? allImages[0] : null),
      },
    });

    // ঙ. ভ্যারিয়েন্টস সিঙ্ক
    if (Array.isArray(payload.variations) && payload.variations.length > 0) {
      for (let idx = 0; idx < payload.variations.length; idx++) {
        const v = payload.variations[idx];
        const vPrice =
          typeof v.price === 'number'
            ? v.price
            : typeof (v as any).sourcePrice === 'number'
            ? (v as any).sourcePrice
            : parseFloat(String(v.price || (v as any).sourcePrice || '').replace(/[^0-9.]/g, '')) || sourcePriceUsd;

        // Per-variant weight: prioritize explicit weight_kg / weightKg passed, then detect from title/size, then fall back to product weight
        const rawExplicit = (v as any).weight_kg ?? (v as any).weightKg ?? (v as any).weight;
        let explicitWeight =
          rawExplicit !== undefined && rawExplicit !== null && rawExplicit !== ''
            ? typeof rawExplicit === 'number'
              ? rawExplicit
              : this.parseWeightToKg(rawExplicit) || Number(rawExplicit) || null
            : null;

        // Sanity Check: If explicitWeight is a dummy fallback (<= 0.35 kg) while the product's base weight is much heavier (>= 0.8 kg) or item is bedding/bulky
        if (explicitWeight !== null && explicitWeight <= 0.35 && resolvedWeightKg && resolvedWeightKg >= 0.8) {
          explicitWeight = null; // discard fake 0.3kg fallback
        }

        const varPricePerUnit = (v as any).price_per_unit || (v as any).pricePerUnit;
        const rawVariantAsin = v.asin || v.variant_asin || '';
        const variantSku =
          v.sku ||
          (rawVariantAsin.startsWith(`${asin}-`)
            ? rawVariantAsin
            : `${asin}-${rawVariantAsin || v.size || v.color || `var-${idx + 1}`}`);

        // ১. স্মার্ট ভ্যারিয়েন্ট ম্যাচিং (SKU, ASIN, অথবা ProductId + Size + Color দিয়ে খোঁজা যাতে ডুপ্লিকেট না হয়)
        let matchedVariant = await this.prisma.variant.findFirst({
          where: {
            productId: product.id,
            OR: [
              { sku: variantSku },
              ...(rawVariantAsin ? [{ asin: rawVariantAsin }, { sku: rawVariantAsin }] : []),
              ...((v.size || v.color) ? [{
                ...(v.size ? { size: { equals: v.size, mode: 'insensitive' as const } } : {}),
                ...(v.color ? { color: { equals: v.color, mode: 'insensitive' as const } } : {}),
              }] : []),
            ],
          },
        });

        // Detect size-specific weight if variant has size or title
        const varText = `${title} ${v.size || ''} ${v.color || ''}`.trim();
        const sizeEstimatedWeight = this.estimateCategoryWeightFallback(varText, payload.category || '', payload.description || '');

        const varWeightKg =
          explicitWeight ||
          (matchedVariant?.weightKg && matchedVariant.weightKg > 0.35 ? matchedVariant.weightKg : null) ||
          (varPricePerUnit ? this.parsePricePerUnitToKg(vPrice, varPricePerUnit) : null) ||
          (sizeEstimatedWeight && sizeEstimatedWeight > 0.35 ? sizeEstimatedWeight : null) ||
          resolvedWeightKg ||
          0.3;

        const vLanded = await this.pricingService.calculateLandedPrice({
          sourcePriceUsd: vPrice,
          weightKg: varWeightKg,
          categoryId: category.id,
        });

        const vAvailLower = String(v.availability || '').toLowerCase().trim();
        const vSize = String(v.size || '').trim();
        const isEuropeanMetricDuplicate = /135|155|200 x 200|220 x 240|king uk|double/i.test(vSize) && vPrice > 85;
        const isVAvailable = !isEuropeanMetricDuplicate && !(
          vAvailLower.includes('out of stock') ||
          vAvailLower.includes('currently unavailable') ||
          vAvailLower.includes('temporarily out of stock') ||
          vAvailLower.includes('sold out')
        );
        const vStock = isVAvailable ? 5 : 0;

        const resolvedVariantImage =
          v.image ||
          (v.swatch ? String(v.swatch).replace(/\._.*_\./, '.') : null) ||
          allImages[0];

        const variantTitle = v.title || `${v.color || ''} ${v.size || ''}`.trim() || `Variant #${idx + 1}`;

        if (matchedVariant) {
          await this.prisma.variant.update({
            where: { id: matchedVariant.id },
            data: {
              sku: variantSku,
              asin: rawVariantAsin || matchedVariant.asin,
              ...(v.title ? { title: v.title } : (matchedVariant.title ? {} : { title: variantTitle })),
              ...(v.size ? { size: v.size } : {}),
              ...(v.color ? { color: v.color } : {}),
              sourcePrice: vPrice,
              sellingPrice: vLanded.finalSellingPriceBdt,
              imageUrl: resolvedVariantImage,
              weightKg: varWeightKg,
              stock: vStock,
              isAvailable: isVAvailable,
            },
          });
        } else {
          // ইউনিক SKU ভ্যালিডেশন যাতে কনস্ট্রেইন্ট ফেইল না হয়
          const existingSku = await this.prisma.variant.findUnique({ where: { sku: variantSku } });
          const finalSku = existingSku ? `${variantSku}-${Math.floor(100 + Math.random() * 900)}` : variantSku;
          await this.prisma.variant.create({
            data: {
              productId: product.id,
              asin: rawVariantAsin || null,
              sku: finalSku,
              title: variantTitle,
              size: v.size || null,
              color: v.color || null,
              imageUrl: resolvedVariantImage,
              sourcePrice: vPrice,
              sellingPrice: vLanded.finalSellingPriceBdt,
              weightKg: varWeightKg,
              stock: vStock,
              isAvailable: isVAvailable,
            },
          });
        }
      }
    }

    // চ. স্বয়ংক্রিয় বা কাস্টম এসইও তৈরি
    const metaTitle = payload.seo?.metaTitle || `${title} | Buy Online in Bangladesh - A2Z Outlet`;
    const metaDescription = payload.seo?.metaDescription || (payload.description ? payload.description.slice(0, 155) : title);
    const metaKeywords = payload.seo?.metaKeywords || null;
    const canonicalUrl = payload.seo?.canonicalUrl || `https://a2zoutletstore.com/products/${product.slug}`;
    const robots = payload.seo?.robots || payload.seo?.robotsMeta || 'index, follow';
    const isNoIndex = Boolean(payload.seo?.isNoIndex || robots.includes('noindex'));
    const isNoFollow = Boolean(payload.seo?.isNoFollow || robots.includes('nofollow'));
    const secKeywords = Array.isArray(payload.seo?.secondaryKeywords)
      ? payload.seo.secondaryKeywords
      : (typeof payload.seo?.secondaryKeywords === 'string'
        ? payload.seo.secondaryKeywords.split(',').map((s: string) => s.trim()).filter(Boolean)
        : []);

    const seoData = {
      metaTitle,
      metaDescription,
      metaKeywords,
      canonicalUrl,
      robots,
      isNoIndex,
      isNoFollow,
      schemaType: payload.seo?.schemaType || 'Product',
      focusKeyword: payload.seo?.focusKeyword || null,
      secondaryKeywords: secKeywords,
      ogTitle: payload.seo?.ogTitle || payload.title,
      ogDescription: payload.seo?.ogDescription || metaDescription,
      ogImage: payload.seo?.ogImage || (allImages.length > 0 ? allImages[0] : null),
      ogType: payload.seo?.ogType || 'product',
      twitterCard: payload.seo?.twitterCard || 'summary_large_image',
      aiSummary: payload.seo?.aiSummary || null,
      faqSchema: payload.seo?.faqSchema || null,
    };

    await this.prisma.seoMetadata.upsert({
      where: { productId: product.id },
      update: seoData,
      create: {
        productId: product.id,
        ...seoData,
      },
    });

    // ছ. প্রাইস হিস্ট্রি লগ
    await this.prisma.priceHistory.create({
      data: {
        productId: product.id,
        price: sourcePriceUsd,
        currency: 'USD',
      },
    });

    return {
      success: true,
      message: 'Product synced successfully!',
      productId: product.id,
      slug: product.slug,
      sellingPriceBdt: priceCalculation.finalSellingPriceBdt,
    };
  }

  /**
   * ২. স্টোরফ্রন্টের জন্য ফিল্টার্ড প্রোডাক্ট পাঠানো
   */
  async getStorefrontProducts(query: GetProductsQueryDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = { status: 'PUBLISHED' };

    if (query.category) {
      where.category = {
        OR: [
          { slug: query.category },
          { name: query.category },
        ],
      };
    }
    if (query.brand) {
      where.brand = {
        OR: [
          { slug: query.brand },
          { name: query.brand },
        ],
      };
    }
    if (query.search) {
      const searchTerm = query.search.trim();

      // ১. সার্চ টার্মটি কি কোনো পরিচিত ব্র্যান্ডের সাথে হুবহু মিলে যায়? (যেমন 'mac' -> Brand 'MAC')
      const matchedBrand = await this.prisma.brand.findFirst({
        where: {
          OR: [
            { name: { equals: searchTerm, mode: 'insensitive' } },
            { slug: { equals: searchTerm.toLowerCase() } },
          ],
        },
        select: { id: true, name: true },
      });

      if (matchedBrand && !query.brand) {
        // যদি ইউজার সরাসরি কোনো ব্র্যান্ডের নাম লিখে সার্চ করে (যেমন 'mac', 'dove', 'cerave')
        // তবে সেই নির্দিষ্ট ব্র্যান্ডের সব প্রোডাক্ট দেখাবে
        where.brandId = matchedBrand.id;
      } else {
        const searchConditions: any[] = [
          { title: { contains: searchTerm, mode: 'insensitive' } },
          { brand: { name: { contains: searchTerm, mode: 'insensitive' } } },
          { category: { name: { contains: searchTerm, mode: 'insensitive' } } },
        ];

        // ৩ অক্ষরের কম বা সমান শব্দ হলে ডেসক্রিপশনে সাবস্ট্রিং সার্চ বন্ধ রাখুন (যাতে stomach বা pharmaceutical এ 'mac' ম্যাচ না করে)
        if (searchTerm.length > 3) {
          searchConditions.push({ description: { contains: searchTerm, mode: 'insensitive' } });
        }

        where.OR = searchConditions;
      }
    }
    if (query.minPrice || query.maxPrice) {
      where.sellingPrice = {};
      if (query.minPrice) where.sellingPrice.gte = Number(query.minPrice);
      if (query.maxPrice) where.sellingPrice.lte = Number(query.maxPrice);
    }
    if ((query as any).has_discount === 'true' || (query as any).has_discount === true || (query as any).deal === 'true') {
      where.comparePrice = { not: null, gt: 0 };
    }

    let orderBy: any = { createdAt: 'desc' };
    if (query.sort === 'price_low' || query.sort === 'price_asc') orderBy = { sellingPrice: 'asc' };
    if (query.sort === 'price_high' || query.sort === 'price_desc') orderBy = { sellingPrice: 'desc' };
    if (query.sort === 'popular' || query.sort === 'rating') orderBy = { rating: 'desc' };
    if (query.sort === 'discount_desc') orderBy = { comparePrice: 'desc' };

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          category: { select: { name: true, slug: true } },
          brand: { select: { name: true, slug: true } },
          variants: {
            select: {
              id: true,
              title: true,
              size: true,
              color: true,
              sellingPrice: true,
              imageUrl: true,
            },
          },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * ৩. সিঙ্গেল প্রোডাক্ট বিস্তারিত ভিউ
   */
  async getProductBySlug(slug: string) {
    const cleanKey = (slug || '').trim();
    if (!cleanKey) {
      throw new NotFoundException('Product identifier is required');
    }

    const product = await this.prisma.product.findFirst({
      where: {
        OR: [
          { id: cleanKey },
          { slug: cleanKey },
          { asin: cleanKey },
          { sku: cleanKey },
          { externalId: cleanKey },
          { walmartId: cleanKey },
        ],
      },
      include: {
        category: {
          include: {
            parent: {
              include: {
                parent: true,
              },
            },
          },
        },
        brand: true,
        variants: true,
        seo: true,
        attributes: { include: { attribute: true, value: true } },
        reviews: {
          where: { isApproved: true },
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        questions: { where: { isApproved: true }, include: { answers: true } },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product not found for: ${cleanKey}`);
    }

    // Resolve normalized 3-tier category hierarchy
    let tier1 = product.category?.name || 'General';
    let tier2 = product.subcategory || '';
    let tier3 = product.subSubcategory || '';

    if (product.category?.parent?.parent) {
      tier1 = product.category.parent.parent.name;
      tier2 = product.category.parent.name;
      tier3 = product.category.name;
    } else if (product.category?.parent) {
      tier1 = product.category.parent.name;
      tier2 = product.category.name;
      tier3 = product.subSubcategory || '';
    }

    return {
      ...product,
      tier1,
      tier2,
      tier3,
    };
  }

  /**
   * ৪. সব ক্যাটাগরি ও ব্র্যান্ড তালিকা এবং স্ট্যাটস
   */
  async getCatalogStats() {
    const [
      totalProducts,
      publishedProducts,
      draftProducts,
      outOfStockProducts,
      totalCategories,
      totalBrands,
      totalRawScraped,
      totalArchivedRaw,
      totalArchivedProd,
    ] = await Promise.all([
      this.prisma.product.count({ where: { status: { not: 'ARCHIVED' } } }),
      this.prisma.product.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.product.count({ where: { status: 'DRAFT' } }),
      this.prisma.product.count({ where: { OR: [{ status: 'OUT_OF_STOCK' }, { stock: { lte: 0 } }] } }),
      this.prisma.category.count(),
      this.prisma.brand.count(),
      (this.prisma as any).rawScrapedItem.count({
        where: {
          status: { not: 'archived' },
          source: { not: 'archived_variant' },
        },
      }),
      (this.prisma as any).rawScrapedItem.count({
        where: {
          OR: [{ status: 'archived' }, { source: 'archived_variant' }],
        },
      }),
      this.prisma.product.count({ where: { status: 'ARCHIVED' } }),
    ]);

    return {
      totalProducts,
      publishedProducts,
      draftProducts,
      outOfStockProducts,
      totalCategories,
      totalBrands,
      totalRawScraped,
      totalArchived: totalArchivedRaw + totalArchivedProd,
    };
  }

  async getCategories() {
    return this.prisma.category.findMany({
      orderBy: { displayOrder: 'asc' },
      include: {
        parent: { select: { id: true, name: true } },
        _count: {
          select: { products: true, children: true },
        },
      },
    });
  }

  async getBrands(query?: {
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: 'products' | 'name';
    filter?: 'has_products' | 'all';
  }) {
    const page = Number(query?.page) || 1;
    const limit = Number(query?.limit) || 50;
    const skip = (page - 1) * limit;
    const where: any = {};
    if (query?.search) {
      where.name = { contains: query.search.trim(), mode: 'insensitive' };
    }
    if (query?.filter === 'has_products') {
      where.products = { some: {} };
    }

    const orderBy: any =
      query?.sortBy === 'name'
        ? { name: 'asc' }
        : [{ products: { _count: 'desc' } }, { name: 'asc' }];

    const [items, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          _count: {
            select: { products: true },
          },
        },
      }),
      this.prisma.brand.count({ where }),
    ]);
    return { items, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getRawScrapedItems(query: {
    page?: number;
    limit?: number;
    source?: string;
    status?: string;
    search?: string;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    // 👈 স্ক্র্যাপড পাইপলাইনে শুধুমাত্র সক্রিয় স্ক্র্যাপড প্রোডাক্ট থাকবে (আর্কাইভ কখনোই এখানে আসবে না)
    const where: any = {
      status: { not: 'archived' },
      source: { not: 'archived_variant' },
    };

    if (query.source && query.source.toLowerCase() !== 'all') {
      where.source = { equals: query.source.toLowerCase(), mode: 'insensitive' };
    }
    if (query.status && query.status.toLowerCase() !== 'all') {
      where.status = { equals: query.status.toLowerCase() };
    }
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { externalId: { contains: s, mode: 'insensitive' } },
        { brand: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      (this.prisma as any).rawScrapedItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scrapedAt: 'desc' },
      }),
      (this.prisma as any).rawScrapedItem.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getSingleRawScrapedItem(id: string) {
    const raw = await (this.prisma as any).rawScrapedItem.findFirst({
      where: {
        OR: [
          { id },
          { externalId: id },
        ],
      },
    });
    if (!raw) throw new NotFoundException(`Scraped item with ID ${id} not found`);

    // Auto-heal category if generic placeholder like 'ecommerce'
    const payload: any = raw.rawData || {};
    const innerData: any = payload.data || {};
    const innerRaw: any = payload.raw || {};
    const isGenericCat = (c?: string | null) => {
      if (!c || typeof c !== 'string') return true;
      const l = c.toLowerCase().trim();
      return !l || l === 'ecommerce' || l === 'general' || l === 'default' || l === 'uncategorized' || l === 'unknown';
    };

    if (isGenericCat(raw.category)) {
      const realCat =
        (innerData.category && !isGenericCat(innerData.category) ? innerData.category : null) ||
        (innerRaw.category && !isGenericCat(innerRaw.category) ? innerRaw.category : null);
      if (realCat) {
        raw.category = realCat;
        (this.prisma as any).rawScrapedItem.update({
          where: { id: raw.id },
          data: { category: realCat },
        }).catch(() => {});
      } else {
        const smart = this.detectCategorySmart(raw.title || innerData.title, innerData.description, payload);
        if (smart && smart.category) {
          const fullPath = [smart.category, smart.subcategory, smart.subSubcategory].filter(Boolean).join(' > ');
          raw.category = fullPath;
          (this.prisma as any).rawScrapedItem.update({
            where: { id: raw.id },
            data: { category: fullPath },
          }).catch(() => {});
        }
      }
    }

    return raw;
  }

  async ingestRawScrapedItem(
    id: string,
    overrides?: {
      title?: string;
      slug?: string;
      sourcePrice?: number;
      sellingPrice?: number;
      discountPrice?: number;
      stock?: number;
      category?: string;
      subcategory?: string;
      subSubcategory?: string;
      brand?: string;
      brandName?: string;
      status?: string;
      weightKg?: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      hsCode?: string;
      originCountry?: string;
      images?: string[];
      imageUrl?: string;
      badge?: any;
      tags?: string[];
      isFeatured?: boolean;
      warranty?: string;
      returnPolicy?: string;
      description?: string;
      features?: string[];
      variations?: any[];
      barcode?: string;
      sellerName?: string;
      seller_name?: string;
      shipsFrom?: string;
      ships_from?: string;
      deliveryMessage?: string;
      delivery_message?: string;
      ingredients?: string;
      extraPackagingWeight?: number;
      extra_packaging_weight?: number;
      seo?: any;
      aiOptimize?: boolean;
    },
  ) {
    let raw = await (this.prisma as any).rawScrapedItem.findUnique({ where: { id } });
    if (!raw) {
      raw = await (this.prisma as any).rawScrapedItem.findFirst({ where: { externalId: id } });
    }
    if (!raw) {
      throw new NotFoundException(`Raw scraped item with ID ${id} not found`);
    }

    const payload: any = raw.rawData || {};
    const innerRaw: any = payload.raw || {};
    const innerData: any = payload.data || {};
    const asin = raw.externalId || payload.parent_asin || innerData.parent_asin || payload.variant_asin || innerData.variant_asin || payload.asin || `RAW-${raw.id.slice(0, 8)}`;
    const title = overrides?.title || raw.title || payload.title || innerData.title || innerRaw.title || 'Untitled Scraped Product';
    const source = raw.source || payload.source || 'amazon';

    // Parse source price cleanly
    const rawPriceVal = overrides?.sourcePrice ?? raw.priceParsed ?? payload.price ?? innerData.price ?? innerRaw.price ?? 10;
    const sourcePrice = typeof rawPriceVal === 'number'
      ? rawPriceVal
      : parseFloat(String(rawPriceVal).replace(/[^0-9.]/g, '')) || 10;

    const isGenericCat = (c?: string | null) => {
      if (!c || typeof c !== 'string') return true;
      const l = c.toLowerCase().trim();
      return !l || l === 'ecommerce' || l === 'general' || l === 'default' || l === 'uncategorized' || l === 'unknown';
    };

    let resolvedCategory = overrides?.category;
    let resolvedSubcategory = overrides?.subcategory;
    let resolvedSubSubcategory = overrides?.subSubcategory;

    if (!resolvedCategory || isGenericCat(resolvedCategory)) {
      if (innerData.category && !isGenericCat(innerData.category)) {
        resolvedCategory = innerData.category;
      } else if (innerRaw.category && !isGenericCat(innerRaw.category)) {
        resolvedCategory = innerRaw.category;
      } else if (payload.category && !isGenericCat(payload.category)) {
        resolvedCategory = payload.category;
      } else if (raw.category && !isGenericCat(raw.category)) {
        resolvedCategory = raw.category;
      } else {
        resolvedCategory = innerData.category || innerRaw.category || payload.category || raw.category || 'General';
      }
    }

    // Description & Key Features extraction
    const description = overrides?.description || payload.description || innerData.description || innerRaw.description || title;

    if (resolvedCategory && resolvedCategory.includes('>')) {
      const catParts = resolvedCategory.split(/\s*>\s*/).map((p: string) => p.trim()).filter(Boolean);
      if (catParts.length > 0) {
        resolvedCategory = catParts[0];
        if (!resolvedSubcategory && catParts.length > 1) {
          resolvedSubcategory = catParts[1];
        }
        if (!resolvedSubSubcategory && catParts.length > 2) {
          resolvedSubSubcategory = catParts[2];
        }
      }
    }

    // If still generic or empty, run smart category detection
    if (!resolvedCategory || isGenericCat(resolvedCategory)) {
      const smart = this.detectCategorySmart(title, description, payload);
      resolvedCategory = smart.category;
      if (!resolvedSubcategory) resolvedSubcategory = smart.subcategory;
      if (!resolvedSubSubcategory) resolvedSubSubcategory = smart.subSubcategory;
    }

    const category = resolvedCategory || 'General';
    const subcategory = resolvedSubcategory || payload.subcategory || innerData.subcategory || payload.pim_data?.subcategory || null;
    const subSubcategory = resolvedSubSubcategory || payload.sub_subcategory || payload.subSubcategory || innerData.sub_subcategory || payload.pim_data?.sub_subcategory || null;
    const status = overrides?.status || 'DRAFT';
    let features = overrides?.features || payload.features || innerData.features || payload.pim_data?.features || innerRaw.features || [];
    if ((!features || features.length === 0) && description && /<li[^>]*>/i.test(description)) {
      const liMatches = description.match(/<li[^>]*>([\s\S]*?)<\/li>/gi);
      if (liMatches) {
        features = liMatches.map((m: string) => m.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()).filter(Boolean);
      }
    }

    // Variations: Array or Object mapping
    let variations = overrides?.variations || payload.variations || innerData.variations || payload.pim_data?.variants || innerRaw.variations || [];
    if (variations && !Array.isArray(variations) && typeof variations === 'object') {
      const varList: any[] = [];
      Object.entries(variations).forEach(([gKey, gVal]: [string, any]) => {
        if (Array.isArray(gVal)) {
          varList.push(...gVal);
        } else if (gVal && typeof gVal === 'object') {
          if (Array.isArray(gVal.variations)) {
            gVal.variations.forEach((sub: any) =>
              varList.push({
                ...sub,
                image: sub.image || sub['color image '] || (gVal.images && gVal.images[0]),
              })
            );
          } else {
            varList.push(gVal);
          }
        }
      });
      variations = varList;
    }

    // Weight Detection with Strict Live-Publish AI Fallback
    let weightKg = overrides?.weightKg ?? this.detectWeightKg(payload, title);

    if (status === 'PUBLISHED') {
      if (!weightKg || weightKg <= 0) {
        try {
          const aiEst = await this.aiService.estimateWeightOnly({
            title,
            category,
            description,
            variations,
          });
          if (aiEst?.success && aiEst.weightKg > 0) {
            weightKg = aiEst.weightKg;
            this.logger.log(`✨ AI estimated shipping weight for LIVE product "${title}": ${weightKg} kg (${aiEst.reasoning})`);
          }
        } catch (e: any) {
          this.logger.warn(`AI weight estimation failed: ${e?.message}`);
        }
      }

      if (!weightKg || weightKg <= 0) {
        throw new BadRequestException(
          '❌ Cannot publish product live to storefront without a valid shipping weight. AI weight estimation could not determine a safe shipping weight. Please enter weight manually or save as Draft.'
        );
      }
    }

    // Clean brand name (strip 'by', 'store', etc.)
    const rawBrandName = overrides?.brandName || overrides?.brand || raw.brand || payload.brand || innerRaw.brand || 'Generic';
    const brandName = rawBrandName
      .replace(/^by\s+/i, '')
      .replace(/^visit the\s+/i, '')
      .replace(/\s+store$/i, '')
      .replace(/^brand:\s*/i, '')
      .trim() || 'Generic';

    // Extract all images & galleries
    const imgSet = new Set<string>();
    if (overrides?.images && Array.isArray(overrides.images)) overrides.images.forEach((u: string) => u && imgSet.add(u));
    if (Array.isArray(payload.images)) payload.images.forEach((u: string) => u && imgSet.add(u));
    if (Array.isArray(innerData.images)) innerData.images.forEach((u: string) => u && imgSet.add(u));
    if (Array.isArray(payload.galleries)) payload.galleries.forEach((u: string) => u && imgSet.add(u));
    if (Array.isArray(innerData.galleries)) innerData.galleries.forEach((u: string) => u && imgSet.add(u));
    if (Array.isArray(innerRaw.images)) innerRaw.images.forEach((u: string) => u && imgSet.add(u));
    if (Array.isArray(innerRaw.galleries)) innerRaw.galleries.forEach((u: string) => u && imgSet.add(u));
    if (payload.image_url) imgSet.add(payload.image_url);
    if (innerData.image_url) imgSet.add(innerData.image_url);
    if (innerRaw.image_url) imgSet.add(innerRaw.image_url);
    const images = Array.from(imgSet);
    const imageUrl = overrides?.imageUrl || (images.length > 0 ? images[0] : null);

    const isGenericOrDomestic = (msg?: string | null) => {
      if (!msg) return true;
      const l = msg.toLowerCase().trim();
      return (
        l === 'arrives soon' ||
        l.startsWith('arrives soon') ||
        l.includes('free delivery') ||
        l.includes('delivery by') ||
        l === 'arrives in 7-10 days via air express'
      );
    };

    const cleanSeller = (s?: string | null) => {
      if (!s) return null;
      const t = s.trim();
      const l = t.toLowerCase();
      if (
        l === 'unknown seller' ||
        l === 'unknown' ||
        l === 'n/a' ||
        l === 'none' ||
        l === 'null' ||
        l === 'undefined'
      ) {
        return null;
      }
      return t;
    };

    const formatIngredients = (rawIng: any): string | null => {
      if (!rawIng) return null;
      if (typeof rawIng === 'string') {
        const s = rawIng.trim();
        if (s === '[object Object]' || s.startsWith('[object')) return null;
        return s || null;
      }
      if (Array.isArray(rawIng)) {
        const parts: string[] = [];
        for (const item of rawIng) {
          if (typeof item === 'string') {
            const s = item.trim();
            if (s && s !== '[object Object]') parts.push(s);
          } else if (item && typeof item === 'object') {
            const active = item.active || item.active_ingredients || item.activeIngredient;
            const inactive = item.inactive || item.inactive_ingredients || item.inactiveIngredients;
            const general = item.ingredients || item.ingredient || item.description || item.name;
            if (active && typeof active === 'string' && active.trim()) parts.push(`Active: ${active.trim()}`);
            if (inactive && typeof inactive === 'string' && inactive.trim()) parts.push(`Inactive: ${inactive.trim()}`);
            if (general && typeof general === 'string' && general.trim()) parts.push(general.trim());
          }
        }
        return parts.filter(Boolean).join(', ') || null;
      }
      if (typeof rawIng === 'object') {
        const active = rawIng.active || rawIng.active_ingredients || rawIng.activeIngredient;
        const inactive = rawIng.inactive || rawIng.inactive_ingredients || rawIng.inactiveIngredients;
        const general = rawIng.ingredients || rawIng.ingredient || rawIng.description;
        const parts: string[] = [];
        if (active && typeof active === 'string' && active.trim()) parts.push(`Active: ${active.trim()}`);
        if (inactive && typeof inactive === 'string' && inactive.trim()) parts.push(`Inactive: ${inactive.trim()}`);
        if (general && typeof general === 'string' && general.trim()) parts.push(general.trim());
        return parts.join(', ') || null;
      }
      return null;
    };

    const barcode = overrides?.barcode || payload.barcode || innerRaw.barcode || innerData.barcode || null;
    const rawSellerCandidate = overrides?.sellerName || overrides?.seller_name || payload.seller_name || innerRaw.sellerName || innerRaw.offers?.[0]?.sellerName || null;
    const sellerName = cleanSeller(rawSellerCandidate) || (brandName !== 'Generic' ? brandName : null);
    const shipsFrom = overrides?.shipsFrom || overrides?.ships_from || payload.ships_from || innerRaw.shipsFrom || null;
    const deliveryMessage =
      overrides?.deliveryMessage ||
      overrides?.delivery_message ||
      payload.delivery_message ||
      (innerRaw.deliveryMessage && !isGenericOrDomestic(innerRaw.deliveryMessage) ? innerRaw.deliveryMessage : null);
    const rawIngCandidate = overrides?.ingredients || payload.ingredients || innerRaw.ingredients || innerData.ingredients || null;
    const ingredients = formatIngredients(rawIngCandidate);
    const extraPackagingWeight = overrides?.extraPackagingWeight ?? overrides?.extra_packaging_weight ?? payload.extraPackagingWeight ?? payload.extra_packaging_weight ?? 0.1;

    const synced = await this.syncFromExtension({
      asin,
      title,
      slug: overrides?.slug,
      source,
      source_price: sourcePrice,
      selling_price: overrides?.sellingPrice,
      discount_price: overrides?.discountPrice,
      stock: overrides?.stock,
      brand: brandName,
      category,
      subcategory,
      subSubcategory,
      images,
      imageUrl,
      description,
      features,
      variations,
      seo: overrides?.seo,
      availability: 'In Stock',
      url: raw.url || payload.url || innerRaw.url,
      status,
      weight_kg: weightKg,
      lengthCm: overrides?.lengthCm,
      widthCm: overrides?.widthCm,
      heightCm: overrides?.heightCm,
      hsCode: overrides?.hsCode,
      originCountry: overrides?.originCountry,
      badge: overrides?.badge ?? payload.badge ?? innerData.badge ?? innerRaw.badge ?? payload.pim_data?.badges,
      tags: overrides?.tags ?? payload.tags ?? innerData.tags ?? innerRaw.tags ?? innerData.smart_attributes?.tags ?? raw.smart_attributes?.tags,
      isFeatured: overrides?.isFeatured,
      warranty: overrides?.warranty,
      returnPolicy: overrides?.returnPolicy,
      barcode,
      sellerName,
      shipsFrom,
      deliveryMessage,
      ingredients,
      extraPackagingWeight,
    } as any);

    await (this.prisma as any).rawScrapedItem.update({
      where: { id: raw.id },
      data: { status: status === 'PUBLISHED' ? 'published' : 'draft' },
    });

    // AI Enrichment (কপিরাইটিং, এসইও মেটা, ফোকাস কিওয়ার্ড ও প্রাইজ অপটিমাইজেশন)
    // Runs when explicitly requested via aiOptimize: true (e.g. bulk ingest) or auto-ingest without manual overrides
    const hasManualOverrides = Boolean(overrides?.title || overrides?.sellingPrice || overrides?.category || overrides?.description);
    const shouldAiEnrich = synced?.productId && (
      overrides?.aiOptimize === true ||
      (!hasManualOverrides && status === 'PUBLISHED' && overrides?.aiOptimize !== false)
    );

    if (shouldAiEnrich) {
      try {
        await this.aiService.enrichProduct(synced.productId);
      } catch (aiErr: any) {
        this.logger.warn(`AI auto-enrichment on ingest failed for product ${synced.productId}: ${aiErr?.message}`);
      }
    }

    // Auto-Ingest Images to Media Library if published
    if (synced?.productId && status === 'PUBLISHED') {
      this.ingestProductImages(synced.productId).catch((imgErr: any) => {
        this.logger.warn(`Auto image ingestion failed for product ${synced.productId}: ${imgErr?.message}`);
      });
    }

    return { success: true, message: 'Successfully ingested to catalog', product: synced };
  }

  // ─── Bulk Scraped & Catalog Operations ───────────────────────────────────

  async bulkIngestScraped(
    ids: string[],
    targetStatus: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED',
    aiOptimize: boolean = true,
  ) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: false, message: 'No item IDs provided', processed: 0, aiEnriched: 0, failed: 0 };
    }

    const results = {
      success: true,
      total: ids.length,
      processed: 0,
      aiEnriched: 0,
      failed: 0,
      errors: [] as Array<{ id: string; error: string }>,
    };

    for (const id of ids) {
      try {
        await this.ingestRawScrapedItem(id, {
          status: targetStatus,
          aiOptimize: aiOptimize && targetStatus === 'PUBLISHED',
        });
        results.processed++;
        if (aiOptimize && targetStatus === 'PUBLISHED') {
          results.aiEnriched++;
        }
      } catch (err: any) {
        results.failed++;
        results.errors.push({ id, error: err?.message || 'Ingestion failed' });
      }
    }

    return results;
  }

  async bulkArchiveScraped(ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: false, message: 'No item IDs provided', processed: 0 };
    }

    await (this.prisma as any).rawScrapedItem.updateMany({
      where: { id: { in: ids } },
      data: { status: 'archived' },
    });

    return { success: true, message: `Successfully archived ${ids.length} items`, processed: ids.length };
  }

  async bulkUpdateProductStatus(ids: string[], status: ProductStatus) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: false, message: 'No product IDs provided', processed: 0 };
    }

    await this.prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { status },
    });

    if (status === ProductStatus.PUBLISHED || (status as string) === 'PUBLISHED') {
      ids.forEach((id) => {
        this.ingestProductImages(id).catch((err: any) => {
          this.logger.warn(`Bulk auto image ingest failed for product ${id}: ${err?.message}`);
        });
      });
    }

    return { success: true, message: `Successfully updated status for ${ids.length} products`, processed: ids.length };
  }

  async bulkDeleteProducts(ids: string[], permanent = false) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: false, message: 'No product IDs provided', processed: 0 };
    }

    if (permanent) {
      // 1. Delete dependent children
      await this.prisma.variant.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
      await this.prisma.productReview.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
      await this.prisma.priceHistory.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
      await this.prisma.productAttributeValue.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
      await this.prisma.wishlistItem.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
      await this.prisma.productQuestion.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});
      await this.prisma.customerPriceAlert.deleteMany({ where: { productId: { in: ids } } }).catch(() => {});

      // For products with existing orders, protect order history by archiving instead of breaking FKs
      const productsWithOrders = await this.prisma.orderItem.findMany({
        where: { productId: { in: ids } },
        select: { productId: true },
      });
      const orderProductIds = new Set(productsWithOrders.map((o) => o.productId));
      const safeToDeleteIds = ids.filter((id) => !orderProductIds.has(id));
      const mustArchiveIds = ids.filter((id) => orderProductIds.has(id));

      if (mustArchiveIds.length > 0) {
        await this.prisma.product.updateMany({
          where: { id: { in: mustArchiveIds } },
          data: { status: 'ARCHIVED' as any },
        });
      }

      let deletedCount = 0;
      if (safeToDeleteIds.length > 0) {
        const res = await this.prisma.product.deleteMany({
          where: { id: { in: safeToDeleteIds } },
        });
        deletedCount = res.count;
      }

      return {
        success: true,
        message: `Permanently deleted ${deletedCount} product(s)${mustArchiveIds.length ? ` (${mustArchiveIds.length} archived due to order history)` : ''}`,
        processed: ids.length,
        deletedCount,
        archivedCount: mustArchiveIds.length,
        permanent: true,
      };
    } else {
      // Soft-delete: move to ARCHIVED status
      const res = await this.prisma.product.updateMany({
        where: { id: { in: ids } },
        data: { status: 'ARCHIVED' as any },
      });
      return {
        success: true,
        message: `Successfully moved ${res.count} product(s) to archive`,
        processed: res.count,
        permanent: false,
      };
    }
  }

  // ─── Archive Management (রিস্টোর ও পার্মানেন্ট ডিলিট) ──────────────────────

  async getArchiveItems(query: {
    page?: number;
    limit?: number;
    search?: string;
    itemType?: string;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 25;
    const skip = (page - 1) * limit;

    const whereRaw: any = {
      OR: [{ status: 'archived' }, { source: 'archived_variant' }],
    };

    if (query.search) {
      const s = query.search.trim();
      whereRaw.AND = [
        {
          OR: [
            { title: { contains: s, mode: 'insensitive' } },
            { externalId: { contains: s, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [rawItems, rawTotal, prodItems, prodTotal] = await Promise.all([
      (this.prisma as any).rawScrapedItem.findMany({
        where: whereRaw,
        skip,
        take: limit,
        orderBy: { scrapedAt: 'desc' },
      }),
      (this.prisma as any).rawScrapedItem.count({ where: whereRaw }),
      this.prisma.product.findMany({
        where: {
          status: 'ARCHIVED',
          ...(query.search ? { title: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
        },
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.product.count({
        where: {
          status: 'ARCHIVED',
          ...(query.search ? { title: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
        },
      }),
    ]);

    const combined = [
      ...prodItems.map((p) => ({
        id: p.id,
        itemType: 'product',
        title: p.title,
        externalId: p.asin || p.sku || p.id,
        source: p.source,
        price: p.sellingPrice || p.sourcePrice,
        status: 'ARCHIVED',
        archivedAt: p.updatedAt,
      })),
      ...rawItems.map((r: any) => ({
        id: r.id,
        itemType: 'scraped',
        title: r.title || 'Archived Scraped Item',
        externalId: r.externalId || r.id,
        source: r.source,
        price: r.priceParsed || 0,
        status: r.status,
        archivedAt: r.scrapedAt,
      })),
    ];

    return {
      items: combined,
      total: rawTotal + prodTotal,
      rawCount: rawTotal,
      productCount: prodTotal,
      page,
      totalPages: Math.ceil((rawTotal + prodTotal) / limit),
    };
  }

  async restoreArchiveItem(id: string, itemType?: string) {
    if (itemType === 'product') {
      const prod = await this.prisma.product.findUnique({ where: { id } });
      if (prod) {
        await this.prisma.product.update({
          where: { id },
          data: { status: ProductStatus.DRAFT },
        });
        return { success: true, message: 'Product restored to Draft' };
      }
    }

    const raw = await (this.prisma as any).rawScrapedItem.findUnique({ where: { id } });
    if (raw) {
      await (this.prisma as any).rawScrapedItem.update({
        where: { id },
        data: { status: 'draft' },
      });
      return { success: true, message: 'Scraped item restored to Draft' };
    }

    const prod = await this.prisma.product.findUnique({ where: { id } });
    if (prod) {
      await this.prisma.product.update({
        where: { id },
        data: { status: ProductStatus.DRAFT },
      });
      return { success: true, message: 'Product restored to Draft' };
    }

    throw new NotFoundException(`Item with ID ${id} not found in archive`);
  }

  async permanentDeleteArchiveItem(id: string, itemType?: string) {
    return this.permanentlyDeleteArchiveItem(id, itemType);
  }

  async permanentlyDeleteArchiveItem(id: string, itemType?: string) {
    if (itemType === 'product') {
      const prod = await this.prisma.product.findUnique({ where: { id } });
      if (prod) {
        await this.prisma.variant.deleteMany({ where: { productId: id } });
        await this.prisma.product.delete({ where: { id } });
        return { success: true, message: 'Product permanently deleted' };
      }
    }

    const raw = await (this.prisma as any).rawScrapedItem.findUnique({ where: { id } });
    if (raw) {
      await (this.prisma as any).rawScrapedItem.delete({ where: { id } });
      return { success: true, message: 'Scraped item permanently deleted' };
    }

    const prod = await this.prisma.product.findUnique({ where: { id } });
    if (prod) {
      await this.prisma.variant.deleteMany({ where: { productId: id } });
      await this.prisma.product.delete({ where: { id } });
      return { success: true, message: 'Product permanently deleted' };
    }

    throw new NotFoundException(`Item with ID ${id} not found`);
  }

  /**
   * ৫. এডমিন ক্যাটালগ প্রোডাক্ট লিস্ট (ড্রাফট, পাবলিশড, স্টক ও ফিল্টারিং সহ)
   */
  async getAdminProducts(query: {
    status?: string;
    inStock?: string;
    source?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.status && query.status.toLowerCase() !== 'all') {
      where.status = query.status.toUpperCase() as ProductStatus;
    }

    if (query.inStock !== undefined && query.inStock !== 'all') {
      const isInStock = query.inStock === 'true';
      where.stock = isInStock ? { gt: 0 } : { lte: 0 };
    }

    if (query.source && query.source.toLowerCase() !== 'all') {
      where.source = { equals: query.source.toLowerCase(), mode: 'insensitive' };
    }

    if ((query as any).categoryId && (query as any).categoryId !== 'all') {
      where.categoryId = (query as any).categoryId;
    } else if ((query as any).category && (query as any).category !== 'all') {
      where.category = { 
        OR: [
          { slug: (query as any).category },
          { name: (query as any).category }
        ]
      };
    }

    if ((query as any).brandId && (query as any).brandId !== 'all') {
      where.brandId = (query as any).brandId;
    }

    if (query.search) {
      const s = query.search.trim();
      const st = (query as any).searchType;
      if (st === 'sku') {
        where.sku = { contains: s, mode: 'insensitive' };
      } else if (st === 'asin') {
        where.asin = { contains: s, mode: 'insensitive' };
      } else if (st === 'brand') {
        where.brand = { name: { contains: s, mode: 'insensitive' } };
      } else {
        where.OR = [
          { title: { contains: s, mode: 'insensitive' } },
          { asin: { contains: s, mode: 'insensitive' } },
          { sku: { contains: s, mode: 'insensitive' } },
          { slug: { contains: s, mode: 'insensitive' } },
          { brand: { name: { contains: s, mode: 'insensitive' } } },
        ];
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          brand: { select: { name: true, slug: true } },
          category: { select: { name: true, slug: true } },
          variants: {
            select: {
              id: true,
              asin: true,
              sku: true,
              size: true,
              color: true,
              sourcePrice: true,
              sellingPrice: true,
              availability: true,
              stock: true,
              imageUrl: true,
              weightKg: true,
            },
          },
          _count: { select: { variants: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      success: true,
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Admin Product CRUD Operations ────────────────────────────────────────

  async createProduct(data: any) {
    return this.syncFromExtension(data);
  }

  /**
   * প্রোডাক্ট আপডেট: PATCH /catalog/products/:id
   */
  async updateProduct(
    id: string,
    data: {
      title?: string;
      slug?: string;
      sourceUrl?: string;
      sourcePrice?: number;
      sellingPrice?: number;
      discountPrice?: number;
      stock?: number;
      status?: string;
      categoryId?: string;
      subcategory?: string;
      subSubcategory?: string;
      brandId?: string;
      brandName?: string;
      weightKg?: number;
      lengthCm?: number;
      widthCm?: number;
      heightCm?: number;
      hsCode?: string;
      originCountry?: string;
      imageUrl?: string;
      images?: string[];
      badge?: any;
      tags?: string[];
      isFeatured?: boolean;
      warranty?: string;
      returnPolicy?: string;
      description?: string;
      features?: string[];
      barcode?: string;
      sellerName?: string;
      shipsFrom?: string;
      deliveryMessage?: string;
      ingredients?: string;
      extraPackagingWeight?: number;
      seo?: any;
      variants?: any[];
    },
  ) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Product ID "${id}" not found`);

    let finalBrandId = data.brandId;
    if (data.brandName && !finalBrandId) {
      const b = await this.findOrCreateBrand(data.brandName);
      finalBrandId = b.id;
    }

    let finalCategoryId = data.categoryId;
    const catName = ((data as any).categoryName || (data as any).category || (data as any).tier1)?.trim();
    const subName = (data.subcategory || (data as any).tier2)?.trim();
    const childName = (data.subSubcategory || (data as any).tier3)?.trim();

    if (catName) {
      let currentParentId: string | null = null;
      let lastCat: any = null;
      const parts = [catName];
      if (subName) parts.push(subName);
      if (childName) parts.push(childName);

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        let slug = this.slugify(part) || 'cat';
        let cat: any = await this.prisma.category.findFirst({
          where: { name: { equals: part, mode: 'insensitive' }, parentId: currentParentId },
        });

        if (!cat) {
          const existingSlug = await this.prisma.category.findUnique({ where: { slug } });
          if (existingSlug) {
            slug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
          }
          cat = await this.prisma.category.create({
            data: {
              name: part,
              slug,
              parentId: currentParentId,
              displayOrder: i,
              isPublished: true,
              isFeatured: false,
            },
          });
        }
        currentParentId = cat.id;
        lastCat = cat;
      }
      if (lastCat) {
        finalCategoryId = lastCat.id;
      }
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...(data.title && { title: data.title }),
        ...(data.slug && { slug: data.slug }),
        ...(data.sourceUrl !== undefined && { sourceUrl: data.sourceUrl }),
        ...(data.sourcePrice !== undefined && { sourcePrice: data.sourcePrice }),
        ...(data.sellingPrice !== undefined && { sellingPrice: data.sellingPrice }),
        ...(data.discountPrice !== undefined && { discountPrice: data.discountPrice }),
        ...(data.stock !== undefined && { stock: data.stock }),
        ...(data.status && { status: data.status as any }),
        ...(finalCategoryId !== undefined && { categoryId: finalCategoryId }),
        ...(data.subcategory !== undefined && { subcategory: data.subcategory }),
        ...(data.subSubcategory !== undefined && { subSubcategory: data.subSubcategory }),
        ...(data.features !== undefined && { features: data.features }),
        ...(finalBrandId !== undefined && { brandId: finalBrandId }),
        ...(data.weightKg !== undefined && { weightKg: data.weightKg }),
        ...(data.lengthCm !== undefined && { lengthCm: data.lengthCm }),
        ...(data.widthCm !== undefined && { widthCm: data.widthCm }),
        ...(data.heightCm !== undefined && { heightCm: data.heightCm }),
        ...(data.hsCode !== undefined && { hsCode: data.hsCode }),
        ...(data.originCountry !== undefined && { originCountry: data.originCountry }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl }),
        ...(data.images && { images: data.images }),
        ...(data.badge !== undefined && { badge: data.badge }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.isFeatured !== undefined && { isFeatured: data.isFeatured }),
        ...(data.warranty !== undefined && { warranty: data.warranty }),
        ...(data.returnPolicy !== undefined && { returnPolicy: data.returnPolicy }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.barcode !== undefined && { barcode: data.barcode }),
        ...(data.sellerName !== undefined && { sellerName: data.sellerName }),
        ...(data.shipsFrom !== undefined && { shipsFrom: data.shipsFrom }),
        ...(data.deliveryMessage !== undefined && { deliveryMessage: data.deliveryMessage }),
        ...(data.ingredients !== undefined && { ingredients: data.ingredients }),
        ...(data.extraPackagingWeight !== undefined && { extraPackagingWeight: data.extraPackagingWeight }),
        ...(data.seo?.robots || data.seo?.robotsMeta ? { robotsMeta: data.seo?.robots || data.seo?.robotsMeta } : {}),
        ...(data.seo?.canonicalUrl ? { canonicalUrl: data.seo?.canonicalUrl } : {}),
        ...(data.seo?.metaKeywords ? { metaKeywords: data.seo?.metaKeywords } : {}),
        ...(data.seo?.schemaType ? { schemaType: data.seo?.schemaType } : {}),
        ...(data.seo?.ogTitle ? { ogTitle: data.seo?.ogTitle } : {}),
        ...(data.seo?.ogDescription ? { ogDescription: data.seo?.ogDescription } : {}),
        ...(data.seo?.ogImage ? { ogImage: data.seo?.ogImage } : {}),
      },
    });

    // Record product stock movement if stock changed
    if (data.stock !== undefined && data.stock !== existing.stock) {
      const diff = data.stock - existing.stock;
      try {
        await this.prisma.inventoryMovement.create({
          data: {
            productId: id,
            action: diff > 0 ? 'PURCHASE_RESTOCK' : 'DAMAGE_LOSS',
            quantityChanged: diff,
            previousStock: existing.stock,
            newStock: data.stock,
            performedBy: 'ADMIN_PIM',
            notes: `Stock updated via PIM Editor (${existing.stock} -> ${data.stock})`,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to record inventory movement for product ${id}: ${err?.message}`);
      }
    }

    // আপডেট এসইও
    if (data.seo) {
      const robots = data.seo.robots || data.seo.robotsMeta || 'index, follow';
      const isNoIndex = Boolean(data.seo.isNoIndex || robots.includes('noindex'));
      const isNoFollow = Boolean(data.seo.isNoFollow || robots.includes('nofollow'));
      const secKeywords = Array.isArray(data.seo.secondaryKeywords)
        ? data.seo.secondaryKeywords
        : (typeof data.seo.secondaryKeywords === 'string'
          ? data.seo.secondaryKeywords.split(',').map((s: string) => s.trim()).filter(Boolean)
          : []);

      const seoData = {
        metaTitle: data.seo.metaTitle || null,
        metaDescription: data.seo.metaDescription || null,
        metaKeywords: data.seo.metaKeywords || null,
        canonicalUrl: data.seo.canonicalUrl || null,
        robots,
        isNoIndex,
        isNoFollow,
        schemaType: data.seo.schemaType || 'Product',
        focusKeyword: data.seo.focusKeyword || null,
        secondaryKeywords: secKeywords,
        ogTitle: data.seo.ogTitle || null,
        ogDescription: data.seo.ogDescription || null,
        ogImage: data.seo.ogImage || null,
        ogType: data.seo.ogType || 'product',
        twitterCard: data.seo.twitterCard || 'summary_large_image',
        aiSummary: data.seo.aiSummary || null,
        faqSchema: data.seo.faqSchema || null,
      };

      await this.prisma.seoMetadata.upsert({
        where: { productId: id },
        update: seoData,
        create: {
          productId: id,
          ...seoData,
        },
      });
    }

    // আপডেট ও ডিলেট ভ্যারিয়েন্টস
    if (Array.isArray(data.variants)) {
      // ১. যে ভ্যারিয়েন্টগুলো ইউজার এডিটর থেকে রিমুভ করেছে, সেগুলো ডাটাবেজ থেকেও পুরোপুরি মুছে ফেলা
      const existingDbVariants = await this.prisma.variant.findMany({
        where: { productId: id },
        select: { id: true },
      });

      const incomingIds = new Set(
        data.variants.map((v) => v.id).filter((vId) => vId && !vId.startsWith('var-'))
      );

      const variantsToDelete = existingDbVariants.filter((v) => !incomingIds.has(v.id));
      if (variantsToDelete.length > 0) {
        const deleteIds = variantsToDelete.map((v) => v.id);
        await this.prisma.priceHistory.deleteMany({ where: { variantId: { in: deleteIds } } }).catch(() => {});
        await this.prisma.inventoryMovement.deleteMany({ where: { variantId: { in: deleteIds } } }).catch(() => {});
        await this.prisma.customerPriceAlert.deleteMany({ where: { variantId: { in: deleteIds } } }).catch(() => {});
        await this.prisma.wishlistItem.deleteMany({ where: { variantId: { in: deleteIds } } }).catch(() => {});
        await this.prisma.productReview.deleteMany({ where: { variantId: { in: deleteIds } } }).catch(() => {});
        await this.prisma.variant.deleteMany({
          where: { id: { in: deleteIds } },
        });
        this.logger.log(`Deleted ${deleteIds.length} removed variants for product ${id}`);
      }

      for (const v of data.variants) {
        const vWeight =
          v.weightKg !== undefined && v.weightKg !== null && v.weightKg !== ''
            ? parseFloat(String(v.weightKg))
            : null;

        if (v.id && !v.id.startsWith('var-')) {
          if (v.stock !== undefined) {
            const prevVar = await this.prisma.variant.findUnique({
              where: { id: v.id },
              select: { stock: true },
            });
            if (prevVar && v.stock !== prevVar.stock) {
              const vDiff = v.stock - prevVar.stock;
              try {
                await this.prisma.inventoryMovement.create({
                  data: {
                    productId: id,
                    variantId: v.id,
                    action: vDiff > 0 ? 'PURCHASE_RESTOCK' : 'DAMAGE_LOSS',
                    quantityChanged: vDiff,
                    previousStock: prevVar.stock,
                    newStock: v.stock,
                    performedBy: 'ADMIN_PIM',
                    notes: `Variant stock updated (${prevVar.stock} -> ${v.stock})`,
                  },
                });
              } catch (err: any) {
                this.logger.warn(`Failed to record variant inventory movement for ${v.id}: ${err?.message}`);
              }
            }
          }

          await this.prisma.variant.update({
            where: { id: v.id },
            data: {
              ...(v.title !== undefined && { title: v.title }),
              ...(v.color !== undefined && { color: v.color }),
              ...(v.size !== undefined && { size: v.size }),
              ...(v.weightKg !== undefined && { weightKg: vWeight }),
              ...(v.sourcePrice !== undefined && { sourcePrice: v.sourcePrice }),
              ...(v.sellingPrice !== undefined && { sellingPrice: v.sellingPrice }),
              ...(v.stock !== undefined && { stock: v.stock }),
              ...(v.isAvailable !== undefined && { isAvailable: v.isAvailable }),
            },
          });
        } else if (v.title || v.sku || v.color || v.size) {
          await this.prisma.variant.create({
            data: {
              productId: id,
              sku: v.sku || `${existing.asin || id.slice(0, 8)}-${Date.now()}-${Math.floor(Math.random()*1000)}`,
              title: v.title || `${v.color || ''} ${v.size || ''}`.trim() || 'Variant',
              color: v.color || null,
              size: v.size || null,
              weightKg: vWeight,
              sourcePrice: v.sourcePrice || existing.sourcePrice,
              sellingPrice: v.sellingPrice || existing.sellingPrice,
              stock: v.stock ?? 5,
              isAvailable: v.isAvailable ?? true,
            },
          });
        }
      }
    }

    // Auto-ingest images if published
    if (
      updated.status === 'PUBLISHED' ||
      (data.status && (data.status === 'PUBLISHED' || (data.status as string) === 'published'))
    ) {
      this.ingestProductImages(id).catch((err: any) => {
        this.logger.warn(`Auto image ingestion on updateProduct failed for ${id}: ${err?.message}`);
      });
    }

    return updated;
  }

  /**
   * ৩-লেভেল ক্যাটাগরি ট্যাক্সোনমি হায়ারার্কি: GET /catalog/taxonomy
   */
  async getTaxonomy() {
    const mappings = await this.prisma.scrapedCategoryMapping.findMany({
      select: {
        mappedCategory: true,
        mappedSubcategory: true,
        mappedSubSubcat: true,
        mappedSubSubcategory: true,
      },
    });

    const taxonomy: Record<string, Record<string, string[]>> = {};

    for (const m of mappings) {
      const cat = m.mappedCategory?.trim();
      if (!cat) continue;
      if (!taxonomy[cat]) taxonomy[cat] = {};

      const sub = m.mappedSubcategory?.trim() || 'General';
      if (!taxonomy[cat][sub]) taxonomy[cat][sub] = [];

      const child = m.mappedSubSubcat?.trim() || m.mappedSubSubcategory?.trim();
      if (child && !taxonomy[cat][sub].includes(child)) {
        taxonomy[cat][sub].push(child);
      }
    }

    const allCategories = await this.prisma.category.findMany({
      include: {
        parent: {
          include: {
            parent: true,
          },
        },
      },
    });

    for (const c of allCategories) {
      if (c.parent && c.parent.parent) {
        // 3-level hierarchy: Grandparent -> Parent -> Child
        const t1 = c.parent.parent.name.trim();
        const t2 = c.parent.name.trim();
        const t3 = c.name.trim();
        if (!taxonomy[t1]) taxonomy[t1] = {};
        if (!taxonomy[t1][t2]) taxonomy[t1][t2] = [];
        if (!taxonomy[t1][t2].includes(t3)) taxonomy[t1][t2].push(t3);
      } else if (c.parent) {
        // 2-level hierarchy: Parent -> Child
        const t1 = c.parent.name.trim();
        const t2 = c.name.trim();
        if (!taxonomy[t1]) taxonomy[t1] = {};
        if (!taxonomy[t1][t2]) taxonomy[t1][t2] = [];
      } else {
        // Root category
        const t1 = c.name.trim();
        if (!taxonomy[t1]) taxonomy[t1] = {};
      }

      if (c.name.includes('>')) {
        const parts = c.name.split('>').map((p) => p.trim());
        if (parts.length >= 1) {
          const t1 = parts[0];
          if (!taxonomy[t1]) taxonomy[t1] = {};
          if (parts.length >= 2) {
            const t2 = parts[1];
            if (!taxonomy[t1][t2]) taxonomy[t1][t2] = [];
            if (parts.length >= 3) {
              const t3 = parts.slice(2).join(' > ');
              if (!taxonomy[t1][t2].includes(t3)) {
                taxonomy[t1][t2].push(t3);
              }
            }
          }
        }
      }
    }

    return taxonomy;
  }

  /**
   * প্রোডাক্ট সফট-ডিলিট: DELETE /catalog/products/:id
   */
  async deleteProduct(id: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Product ID "${id}" not found`);
    // Soft-delete by setting status to ARCHIVED
    await this.prisma.product.update({
      where: { id },
      data: { status: 'ARCHIVED' as any },
    });
    return { success: true, message: 'প্রোডাক্টটি আর্কাইভ করা হয়েছে' };
  }

  // ─── Category CRUD ─────────────────────────────────────────────────────────

  async createCategory(data: { name: string; icon?: string; imageUrl?: string; displayOrder?: number; parentId?: string }) {
    const slug = this.slugify(data.name);
    return this.prisma.category.upsert({
      where: { slug },
      update: { name: data.name },
      create: { 
        name: data.name, 
        slug, 
        icon: data.icon ?? null, 
        imageUrl: data.imageUrl ?? null,
        displayOrder: data.displayOrder ?? 0,
        parentId: data.parentId ?? null 
      },
    });
  }

  async updateCategory(id: string, data: { name?: string; icon?: string; imageUrl?: string; displayOrder?: number; parentId?: string }) {
    const updateData: any = { ...data };
    if (data.name) {
      updateData.slug = this.slugify(data.name);
    }
    // If empty string is passed, unset the parentId (Root Category)
    if (data.parentId === '') {
      updateData.parentId = null;
    }
    
    return this.prisma.category.update({
      where: { id },
      data: updateData,
    });
  }

  async reorderCategories(items: { id: string; displayOrder: number }[]) {
    // Run all updates in a single transaction
    const updatePromises = items.map((item) =>
      this.prisma.category.update({
        where: { id: item.id },
        data: { displayOrder: item.displayOrder },
      }),
    );
    await this.prisma.$transaction(updatePromises);
    return { success: true, message: 'Categories reordered successfully' };
  }

  async deleteCategory(id: string) {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Category ID "${id}" not found`);
    await this.prisma.category.delete({ where: { id } });
    return { success: true, message: 'ক্যাটাগরি মুছে ফেলা হয়েছে' };
  }

  // ─── Brand CRUD ────────────────────────────────────────────────────────────

  async createBrand(data: { name: string; logoUrl?: string; website?: string }) {
    const brand = await this.findOrCreateBrand(data.name);
    if (data.logoUrl !== undefined || data.website !== undefined) {
      return this.prisma.brand.update({
        where: { id: brand.id },
        data: {
          ...(data.logoUrl !== undefined && { logoUrl: data.logoUrl }),
          ...(data.website !== undefined && { website: data.website }),
        },
      });
    }
    return brand;
  }

  async deleteBrand(id: string) {
    const existing = await this.prisma.brand.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Brand ID "${id}" not found`);
    await this.prisma.brand.delete({ where: { id } });
    return { success: true, message: 'ব্র্যান্ড মুছে ফেলা হয়েছে' };
  }

  // ─── Product Image Ingestion to Media Library ───────────────────────────────

  /**
   * বাহ্যিক ইমেজ URLs লোকাল মিডিয়া লাইব্রেরিতে ডাউনলোড করে প্রডাক্ট আপডেট করা
   */
  async ingestProductImages(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { variants: true },
    });
    if (!product) throw new NotFoundException(`Product ID "${productId}" not found`);

    const appUrl = process.env.APP_URL || '';
    const cdnUrl = process.env.CDN_URL || process.env.MEDIA_CDN_URL || '';
    const isExternal = (url?: string | null) => {
      if (!url || typeof url !== 'string') return false;
      const u = url.trim();
      if (!u.startsWith('http://') && !u.startsWith('https://') && !u.startsWith('//')) return false;
      if (u.includes('/uploads/') || (appUrl && u.startsWith(appUrl)) || (cdnUrl && u.startsWith(cdnUrl))) return false;
      return true;
    };

    // ফোল্ডার তৈরি বা রিটার্ন
    const productFolder = await this.mediaService.getOrCreateFolder('Product Images');
    const folderId = productFolder.id;

    let updatedCount = 0;
    const urlMap = new Map<string, string>();

    const downloadAndMap = async (url: string, altSuffix: string) => {
      if (!isExternal(url)) return url;
      if (urlMap.has(url)) return urlMap.get(url)!;

      try {
        const mediaFile = await this.mediaService.importFromUrl({
          imageUrl: url,
          folderId,
          altText: `${product.title || 'Product'} - ${altSuffix}`,
          uploadedBy: 'Product Media Sync',
        });
        urlMap.set(url, mediaFile.fileUrl);
        updatedCount++;
        return mediaFile.fileUrl;
      } catch (err: any) {
        this.logger.warn(`Failed to ingest product image "${url}" for product ${productId}: ${err?.message}`);
        return url;
      }
    };

    // ১. গ্যালারি ইমেজেস
    const rawImages = Array.isArray(product.images) ? (product.images as string[]) : [];
    const newImages: string[] = [];
    for (let i = 0; i < rawImages.length; i++) {
      const mapped = await downloadAndMap(rawImages[i], `Gallery ${i + 1}`);
      newImages.push(mapped);
    }

    // ২. প্রাইমারি কভার ইমেজ
    let newImageUrl = product.imageUrl;
    if (product.imageUrl && isExternal(product.imageUrl)) {
      newImageUrl = await downloadAndMap(product.imageUrl, 'Main Cover');
    } else if (!newImageUrl && newImages.length > 0) {
      newImageUrl = newImages[0];
    }

    // ৩. ভ্যারিয়েন্ট ইমেজেস
    const updatedVariants: Array<{ id: string; imageUrl: string }> = [];
    if (Array.isArray(product.variants)) {
      for (const v of product.variants) {
        if (v.imageUrl && isExternal(v.imageUrl)) {
          const vImg = await downloadAndMap(v.imageUrl, `Variant ${v.title || v.sku || ''}`);
          if (vImg !== v.imageUrl) {
            updatedVariants.push({ id: v.id, imageUrl: vImg });
          }
        }
      }
    }

    // ৪. ডাটাবেসে সেভ করা
    await this.prisma.product.update({
      where: { id: productId },
      data: {
        imageUrl: newImageUrl,
        images: newImages,
      },
    });

    for (const vUpdate of updatedVariants) {
      await this.prisma.variant.update({
        where: { id: vUpdate.id },
        data: { imageUrl: vUpdate.imageUrl },
      });
    }

    this.logger.log(`Ingested ${updatedCount} images to media library for product ${productId}`);
    return {
      success: true,
      productId,
      ingestedCount: updatedCount,
      imageUrl: newImageUrl,
      images: newImages,
    };
  }

  /**
   * Save RFQ Product to Inventory (Quick Create)
   */
  async saveRfqProduct(data: any) {
    const url = data.sourceUrl || '';
    const asinMatch = url.match(/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    const asin = asinMatch ? asinMatch[1] : null;

    if (asin) {
      const existing = await this.prisma.product.findUnique({ where: { asin } });
      if (existing) {
        return { id: existing.id, isNew: false };
      }
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const slug = `${(data.title || 'custom-rfq').substring(0, 50).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomSuffix}`;

    const product = await this.prisma.product.create({
      data: {
        title: data.title || 'Custom RFQ Product',
        slug,
        source: 'rfq',
        sourceUrl: data.sourceUrl,
        asin: asin,
        sourcePrice: data.sourcePrice ? Number(data.sourcePrice) : 0,
        sellingPrice: data.sellingPrice ? Number(data.sellingPrice) : 0,
        weightKg: data.weightKg ? Number(data.weightKg) : 0.1,
        imageUrl: data.imageUrl || '',
        images: data.imageUrl ? [data.imageUrl] : [],
        status: 'DRAFT',
      },
    });

    return { id: product.id, isNew: true };
  }

  /**
   * বাল্ক প্রডাক্ট ইমেজ ইনজেস্ট
   */
  async bulkIngestProductImages(productIds: string[]) {
    if (!Array.isArray(productIds) || productIds.length === 0) {
      return { success: false, message: 'No product IDs provided', processed: 0, totalImages: 0 };
    }

    let processed = 0;
    let totalImages = 0;

    for (const id of productIds) {
      try {
        const res = await this.ingestProductImages(id);
        if (res.success) {
          processed++;
          totalImages += res.ingestedCount;
        }
      } catch (err: any) {
        this.logger.warn(`Bulk image ingestion failed for product ${id}: ${err?.message}`);
      }
    }

    return {
      success: true,
      totalProducts: productIds.length,
      processedProducts: processed,
      totalImagesIngested: totalImages,
    };
  }

  /**
   * প্রোডাক্টের ইনভেন্টরি স্টক মুভমেন্ট অডিট লেজার হিস্টোরি
   */
  async getInventoryMovements(productId: string) {
    return this.prisma.inventoryMovement.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /**
   * নির্দিষ্ট ভ্যারিয়েন্ট সরাসরি মুছে ফেলা
   */
  async deleteProductVariant(productId: string, variantId: string) {
    const existing = await this.prisma.variant.findFirst({
      where: { id: variantId, productId },
    });
    if (!existing) {
      throw new NotFoundException(`Variant with ID ${variantId} not found for product ${productId}`);
    }

    await this.prisma.priceHistory.deleteMany({ where: { variantId } }).catch(() => {});
    await this.prisma.inventoryMovement.deleteMany({ where: { variantId } }).catch(() => {});
    await this.prisma.customerPriceAlert.deleteMany({ where: { variantId } }).catch(() => {});
    await this.prisma.wishlistItem.deleteMany({ where: { variantId } }).catch(() => {});
    await this.prisma.productReview.deleteMany({ where: { variantId } }).catch(() => {});

    await this.prisma.variant.delete({
      where: { id: variantId },
    });

    return { success: true, message: 'ভ্যারিয়েন্ট মুছে ফেলা হয়েছে' };
  }
}



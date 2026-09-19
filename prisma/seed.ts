import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // ══════════════════════════════════════════════════════════════
  // ১. Super Admin User
  // ══════════════════════════════════════════════════════════════
  const email = (process.env.ADMIN_EMAIL || 'admin@a2z.com').toLowerCase().trim();
  const rawPassword = process.env.ADMIN_PASSWORD || 'admin123456';
  const hashedPassword = await bcrypt.hash(rawPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { role: Role.SUPERADMIN, isAdmin: true, isActive: true, isVerified: true, password: hashedPassword },
    create: {
      email,
      name: 'Super Admin',
      password: hashedPassword,
      role: Role.SUPERADMIN,
      isAdmin: true,
      isActive: true,
      isVerified: true,
      phone: '+8801700000000',
      referralCode: 'ADMIN-A2Z',
    },
  });

  console.log(`✅ Admin: ${admin.email}`);

  // ══════════════════════════════════════════════════════════════
  // ২. Default Categories
  // ══════════════════════════════════════════════════════════════
  const categories = [
    { name: 'Smartphones & Laptops', slug: 'smartphones-laptops', icon: '📱' },
    { name: 'Cosmetics & Skincare', slug: 'cosmetics-skincare', icon: '💄' },
    { name: 'Fashion & Footwear', slug: 'fashion-footwear', icon: '👟' },
    { name: 'Vitamins & Supplements', slug: 'vitamins-supplements', icon: '💊' },
    { name: 'Luxury Watches', slug: 'luxury-watches', icon: '⌚' },
    { name: 'Toys & Games', slug: 'toys-games', icon: '🎮' },
    { name: 'Home & Kitchen', slug: 'home-kitchen', icon: '🏠' },
    { name: 'Sports & Outdoors', slug: 'sports-outdoors', icon: '⚽' },
  ];

  for (const cat of categories) {
    const savedCat = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name },
      create: cat,
    });

    await prisma.pricingRule.upsert({
      where: { categoryId: savedCat.id },
      update: {},
      create: {
        categoryId: savedCat.id,
        profitMarginPct: 0.15,
        importDutyPct: 0.10,
        vatPct: 0.15,
        supplementaryDutyPct: 0.00,
        airFreightPerKgUsd: 12.0,
        packagingFeeUsd: 2.00,
        isActive: true,
      },
    });
  }
  console.log(`✅ Categories & Pricing Rules: ${categories.length} seeded`);

  // ══════════════════════════════════════════════════════════════
  // ৩. Default Brands
  // ══════════════════════════════════════════════════════════════
  const brands = [
    { name: 'Apple', slug: 'apple' },
    { name: 'Samsung', slug: 'samsung' },
    { name: 'Nike', slug: 'nike' },
    { name: "L'Oréal", slug: 'loreal' },
    { name: 'Generic', slug: 'generic' },
  ];

  for (const brand of brands) {
    await prisma.brand.upsert({
      where: { name: brand.name },
      update: {},
      create: brand,
    });
  }
  console.log(`✅ Brands: ${brands.length} seeded`);

  // ══════════════════════════════════════════════════════════════
  // ৪. Currency Exchange Rates (USD/EUR/GBP → BDT)
  // ══════════════════════════════════════════════════════════════
  const fxRates = [
    { sourceCurrency: 'USD', targetCurrency: 'BDT', rate: 136.50 },
    { sourceCurrency: 'EUR', targetCurrency: 'BDT', rate: 147.20 },
    { sourceCurrency: 'GBP', targetCurrency: 'BDT', rate: 175.80 },
  ];

  for (const fx of fxRates) {
    await prisma.currencyExchangeRate.upsert({
      where: { sourceCurrency_targetCurrency: { sourceCurrency: fx.sourceCurrency, targetCurrency: fx.targetCurrency } },
      update: { rate: fx.rate },
      create: { ...fx, isAutoSync: true },
    });
  }
  console.log(`✅ Exchange Rates: ${fxRates.length} seeded (USD→BDT 136.50)`);

  // ══════════════════════════════════════════════════════════════
  // ৫. Leg 1: Marketplace US Shipping Rules
  // ══════════════════════════════════════════════════════════════
  const marketplaceRules = [
    { source: 'amazon',  standardFee: 5.99,  freeShippingThreshold: 35.0, isFreeWithMembership: true,  estimatedDaysMin: 2, estimatedDaysMax: 5 },
    { source: 'walmart', standardFee: 5.99,  freeShippingThreshold: 35.0, isFreeWithMembership: true,  estimatedDaysMin: 3, estimatedDaysMax: 5 },
    { source: 'ebay',    standardFee: 0.0,   freeShippingThreshold: 0.0,  isFreeWithMembership: false, estimatedDaysMin: 3, estimatedDaysMax: 7 },
    { source: 'sephora', standardFee: 5.95,  freeShippingThreshold: 50.0, isFreeWithMembership: false, estimatedDaysMin: 3, estimatedDaysMax: 5 },
    { source: 'target',  standardFee: 5.99,  freeShippingThreshold: 35.0, isFreeWithMembership: false, estimatedDaysMin: 2, estimatedDaysMax: 5 },
    { source: 'bestbuy', standardFee: 5.99,  freeShippingThreshold: 35.0, isFreeWithMembership: false, estimatedDaysMin: 3, estimatedDaysMax: 5 },
    { source: 'nike',    standardFee: 8.0,   freeShippingThreshold: 50.0, isFreeWithMembership: false, estimatedDaysMin: 3, estimatedDaysMax: 5 },
    { source: 'all',     standardFee: 5.99,  freeShippingThreshold: 35.0, isFreeWithMembership: false, estimatedDaysMin: 3, estimatedDaysMax: 7 },
  ];

  for (const rule of marketplaceRules) {
    await prisma.marketplaceShippingRule.upsert({
      where: { source_countryCode: { source: rule.source, countryCode: 'US' } },
      update: rule,
      create: { ...rule, countryCode: 'US', isActive: true },
    });
  }
  console.log(`✅ Marketplace Shipping Rules: ${marketplaceRules.length} seeded`);

  // ══════════════════════════════════════════════════════════════
  // ৬. Leg 2: International Air & Sea Freight (US → BD)
  // ══════════════════════════════════════════════════════════════
  const shippingRates = [
    { category: 'all', shippingMethod: 'air',     ratePerKg: 12.0, volumetricDivisor: 5000, estimatedDaysMin: 5,  estimatedDaysMax: 10 },
    { category: 'all', shippingMethod: 'sea',     ratePerKg: 4.0,  volumetricDivisor: 5000, estimatedDaysMin: 21, estimatedDaysMax: 35 },
    { category: 'all', shippingMethod: 'express', ratePerKg: 16.5, volumetricDivisor: 5000, estimatedDaysMin: 3,  estimatedDaysMax: 5  },
  ];

  for (const rate of shippingRates) {
    const existing = await prisma.shippingRate.findFirst({
      where: { category: rate.category, shippingMethod: rate.shippingMethod, originCountry: 'US', destCountry: 'BD' },
    });
    if (!existing) {
      await prisma.shippingRate.create({
        data: { ...rate, originCountry: 'US', destCountry: 'BD', isActive: true },
      });
    } else {
      await prisma.shippingRate.update({ where: { id: existing.id }, data: rate });
    }
  }
  console.log(`✅ Shipping Rates: ${shippingRates.length} seeded (Air $12/kg)`);

  // ══════════════════════════════════════════════════════════════
  // ৭. Leg 3: Bangladesh Local Courier Delivery Rates
  // ══════════════════════════════════════════════════════════════
  const deliveryRates = [
    { cityOrZone: 'Inside Dhaka',   chargeAmount: 70.0,  courierProvider: 'Pathao / Steadfast', estimatedDaysMin: 1, estimatedDaysMax: 2 },
    { cityOrZone: 'Dhaka Suburbs',  chargeAmount: 100.0, courierProvider: 'Steadfast / RedX',   estimatedDaysMin: 2, estimatedDaysMax: 3 },
    { cityOrZone: 'Outside Dhaka',  chargeAmount: 120.0, courierProvider: 'Steadfast / RedX',   estimatedDaysMin: 3, estimatedDaysMax: 5 },
  ];

  for (const rate of deliveryRates) {
    const existing = await prisma.regionalDeliveryRate.findFirst({
      where: { cityOrZone: rate.cityOrZone, countryCode: 'BD' },
    });
    if (!existing) {
      await prisma.regionalDeliveryRate.create({ data: { ...rate, countryCode: 'BD', isActive: true } });
    } else {
      await prisma.regionalDeliveryRate.update({ where: { id: existing.id }, data: rate });
    }
  }
  console.log(`✅ Delivery Rates: ${deliveryRates.length} seeded (Inside Dhaka ৳70)`);

  // ══════════════════════════════════════════════════════════════
  // ৮. NBR Customs Tariff HS Codes
  // ══════════════════════════════════════════════════════════════
  const hsCodes = [
    { hsCode: '8517.13.00', categoryName: 'Smartphones & Mobile Phones',   customsDutyPct: 25, supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 45 },
    { hsCode: '8471.30.00', categoryName: 'Laptops & Portable Computers',  customsDutyPct: 10, supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 30 },
    { hsCode: '3304.99.00', categoryName: 'Cosmetics & Beauty Products',   customsDutyPct: 25, supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 45 },
    { hsCode: '6403.99.00', categoryName: 'Footwear & Shoes (Leather)',    customsDutyPct: 25, supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 45 },
    { hsCode: '2106.90.00', categoryName: 'Food Supplements & Vitamins',   customsDutyPct: 5,  supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 25 },
    { hsCode: '9102.11.00', categoryName: 'Quartz Wristwatches',           customsDutyPct: 25, supplementaryPct: 20, vatPct: 15, advanceTaxPct: 10, totalTaxPct: 70 },
    { hsCode: '9503.00.90', categoryName: 'Toys & Games',                  customsDutyPct: 25, supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 45 },
    { hsCode: '8443.31.00', categoryName: 'Printers & Office Equipment',   customsDutyPct: 15, supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 35 },
    { hsCode: '6204.61.00', categoryName: "Women's Clothing & Apparel",    customsDutyPct: 25, supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 45 },
    { hsCode: '8518.30.00', categoryName: 'Headphones & Audio Devices',    customsDutyPct: 25, supplementaryPct: 0,  vatPct: 15, advanceTaxPct: 5,  totalTaxPct: 45 },
  ];

  for (const hs of hsCodes) {
    await prisma.hsCodeTaxRule.upsert({
      where: { hsCode: hs.hsCode },
      update: hs,
      create: hs,
    });
  }
  console.log(`✅ HS Code Tax Rules: ${hsCodes.length} seeded`);

  // ══════════════════════════════════════════════════════════════
  // ৯. Consolidator Warehouses with Flight Schedules
  // ══════════════════════════════════════════════════════════════
  const warehouses = [
    {
      code: 'NYC-HUB-01',
      name: 'New York Air Cargo Hub',
      countryCode: 'US',
      city: 'New York',
      address: '30-30 Northern Blvd, Long Island City, NY 11101, USA',
      postalCode: '11101',
      phone: '+1-718-000-0000',
      email: 'nyc@a2z-hub.com',
      repackingAvailable: true,
      consolidationAvailable: true,
      photoCheckAvailable: true,
      qcAvailable: true,
      shipmentFrequency: 'Weekly (Tue, Fri)',
      shipmentDays: ['Tuesday', 'Friday'],
      cutoffTime: '17:00 EST',
      nextShipmentDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      shipmentNotice: 'Next flight departs on Friday at 5:00 PM EST. Cut-off: Thursday 11:59 PM EST. Estimated arrival in Dhaka: 7 days.',
      transitDaysMin: 5,
      transitDaysMax: 8,
      isActive: true,
    },
    {
      code: 'DE-HUB-02',
      name: 'Delaware Tax-Free Consolidation Depot',
      countryCode: 'US',
      city: 'New Castle',
      address: '1201 N DuPont Hwy, New Castle, DE 19720, USA',
      postalCode: '19720',
      phone: '+1-302-000-0000',
      email: 'delaware@a2z-hub.com',
      repackingAvailable: true,
      consolidationAvailable: true,
      photoCheckAvailable: true,
      qcAvailable: true,
      shipmentFrequency: 'Weekly (Wednesday)',
      shipmentDays: ['Wednesday'],
      cutoffTime: '18:00 EST',
      nextShipmentDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      shipmentNotice: '0% US Sales Tax Hub. Consolidated weekly to NYC Cargo Terminal every Wednesday.',
      transitDaysMin: 7,
      transitDaysMax: 10,
      isActive: true,
    },
  ];

  for (const w of warehouses) {
    await prisma.consolidatorWarehouse.upsert({
      where: { code: w.code },
      update: w,
      create: w,
    });
  }
  console.log(`✅ Warehouses & Flight Schedules: ${warehouses.length} seeded`);

  // ══════════════════════════════════════════════════════════════
  // ৯.১ Multi-Carrier Shipping Integrations (Leg 1, 2, 3)
  // ══════════════════════════════════════════════════════════════
  const carriers = [
    // Leg 1: US Domestic Carriers
    { code: 'usps', name: 'US Postal Service (USPS)', leg: 'DOMESTIC_US', serviceType: 'EXPRESS', trackingUrlTemplate: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={trackingNumber}', isActive: true },
    { code: 'ups', name: 'UPS Express', leg: 'DOMESTIC_US', serviceType: 'EXPRESS', trackingUrlTemplate: 'https://www.ups.com/track?tracknum={trackingNumber}', isActive: true },
    { code: 'fedex', name: 'FedEx Ground & Express', leg: 'DOMESTIC_US', serviceType: 'EXPRESS', trackingUrlTemplate: 'https://www.fedex.com/fedextrack/?trknbr={trackingNumber}', isActive: true },
    { code: 'amazon_logistics', name: 'Amazon Logistics', leg: 'DOMESTIC_US', serviceType: 'LAST_MILE', trackingUrlTemplate: 'https://www.amazon.com/progress-tracker/package/ref=ppx_yo_dt_b_track_package?itemId=&orderId={trackingNumber}', isActive: true },

    // Leg 2: Crossborder Air Freight Lines
    { code: 'emirates', name: 'Emirates SkyCargo', leg: 'INTERNATIONAL_AIR', serviceType: 'AIR_CARGO', trackingUrlTemplate: 'https://www.skycargo.com/services-solutions/track-shipment/?awb={trackingNumber}', contactEmail: 'cargo@emirates.com', isActive: true },
    { code: 'qatar_cargo', name: 'Qatar Airways Cargo', leg: 'INTERNATIONAL_AIR', serviceType: 'AIR_CARGO', trackingUrlTemplate: 'https://www.qrcargo.com/trackshipment?awbNumber={trackingNumber}', contactEmail: 'cargo@qatarairways.com.qa', isActive: true },
    { code: 'biman', name: 'Biman Bangladesh Cargo', leg: 'INTERNATIONAL_AIR', serviceType: 'AIR_CARGO', trackingUrlTemplate: 'https://www.biman-airlines.com/cargo-tracking?awb={trackingNumber}', isActive: true },
    { code: 'saudia_cargo', name: 'Saudia Cargo', leg: 'INTERNATIONAL_AIR', serviceType: 'AIR_CARGO', trackingUrlTemplate: 'https://www.saudiacargo.com/track?awb={trackingNumber}', isActive: true },

    // Leg 3: Bangladesh Domestic Last-Mile Couriers
    { code: 'pathao', name: 'Pathao Courier (Dhaka Fast)', leg: 'LOCAL_BD', serviceType: 'LAST_MILE', trackingUrlTemplate: 'https://merchant.pathao.com/tracking?consignment_id={trackingNumber}', contactPhone: '09610003030', isActive: true },
    { code: 'steadfast', name: 'Steadfast Courier (Nationwide)', leg: 'LOCAL_BD', serviceType: 'LAST_MILE', trackingUrlTemplate: 'https://steadfast.com.bd/t/{trackingNumber}', contactPhone: '09678-045045', isActive: true },
    { code: 'redx', name: 'RedX Delivery Network', leg: 'LOCAL_BD', serviceType: 'LAST_MILE', trackingUrlTemplate: 'https://redx.com.bd/track/{trackingNumber}', isActive: true },
  ];

  for (const c of carriers) {
    await prisma.shippingCarrier.upsert({
      where: { code: c.code },
      update: c,
      create: c,
    });
  }
  console.log(`✅ Multi-Carrier Shipping Partners: ${carriers.length} seeded (Leg 1, 2, 3)`);

  // ══════════════════════════════════════════════════════════════
  // ১০. Platform Settings
  // ══════════════════════════════════════════════════════════════
  const settings = [
    { key: 'DEFAULT_CURRENCY', value: 'BDT' },
    { key: 'DEFAULT_FX_BUFFER_PCT', value: '2.5' },
    { key: 'MIN_SCRAPE_INTERVAL', value: '3600' },
    { key: 'AIR_FREIGHT_RATE_PER_KG_USD', value: '12.00' },
    { key: 'VOLUMETRIC_DIVISOR', value: '5000' },
    { key: 'COD_CHARGE_PCT', value: '1.0' },
    { key: 'ADVANCE_PAYMENT_THRESHOLD_BDT', value: '5000' },
  ];

  for (const s of settings) {
    await prisma.platformSetting.upsert({
      where: { key: s.key },
      update: { value: s.value },
      create: s,
    });
  }
  console.log(`✅ Platform Settings: ${settings.length} seeded`);

  // ══════════════════════════════════════════════════════════════
  // ১১. Default Promotional Coupons
  // ══════════════════════════════════════════════════════════════
  const coupons = [
    {
      code: 'WELCOME10',
      description: '10% discount on first crossborder purchase',
      discountType: 'PERCENTAGE' as any,
      discountValue: 10.0,
      minOrderAmount: 1000.0,
      maxDiscountAmount: 2000.0,
      limitPerUser: 1,
      isActive: true,
    },
    {
      code: 'A2ZFIRST',
      description: 'Flat ৳500 off on orders above ৳5000',
      discountType: 'FIXED' as any,
      discountValue: 500.0,
      minOrderAmount: 5000.0,
      limitPerUser: 1,
      isActive: true,
    },
  ];

  for (const c of coupons) {
    await prisma.coupon.upsert({
      where: { code: c.code },
      update: c,
      create: c,
    });
  }
  console.log(`✅ Coupons: ${coupons.length} seeded`);

  console.log('\n═══════════════════════════════════════════');
  console.log('🚀 Database seeded successfully!');
  console.log(`📧 Admin: ${admin.email}`);
  console.log(`🔑 Password: ${rawPassword}`);
  console.log('═══════════════════════════════════════════\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

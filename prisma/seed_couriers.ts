import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 1. Clean up legacy airline entries
  await prisma.shippingCarrier.deleteMany({
    where: {
      code: { in: ['emirates', 'qatar_cargo', 'biman', 'aramex_cargo', 'skynet_bd', 'transworld_cargo', 'dhl_express'] },
    },
  });

  // 2. Upsert standard BD local couriers and origin carriers
  const carriers = [
    {
      code: 'steadfast',
      name: 'Steadfast Courier (স্টেডফাস্ট)',
      leg: 'LOCAL_BD_COURIER',
      serviceType: 'CASH_ON_DELIVERY',
      baseDeliveryFeeBdt: 60,
      outsideDhakaFeeBdt: 120,
      codFeePercent: 1.0,
      trackingUrlTemplate: 'https://steadfast.com.bd/t/{tracking}',
      contactPhone: '+8809678-045045',
      contactEmail: 'support@steadfast.com.bd',
      notes: 'Default API integration for Bangladesh Nationwide Cash on Delivery (COD).',
      isActive: true,
    },
    {
      code: 'pathao',
      name: 'Pathao Courier (পাঠাও)',
      leg: 'LOCAL_BD_COURIER',
      serviceType: 'EXPRESS_SAME_DAY',
      baseDeliveryFeeBdt: 70,
      outsideDhakaFeeBdt: 130,
      codFeePercent: 1.0,
      trackingUrlTemplate: 'https://merchant.pathao.com/tracking?consignment_id={tracking}',
      contactPhone: '+8809610-003030',
      contactEmail: 'merchant.support@pathao.com',
      notes: 'Fast intra-city Dhaka same-day and nationwide door-to-door delivery.',
      isActive: true,
    },
    {
      code: 'redx',
      name: 'RedX Logistics (রেডএক্স)',
      leg: 'LOCAL_BD_COURIER',
      serviceType: 'CASH_ON_DELIVERY',
      baseDeliveryFeeBdt: 60,
      outsideDhakaFeeBdt: 110,
      codFeePercent: 1.0,
      trackingUrlTemplate: 'https://redx.com.bd/track-order?trackingId={tracking}',
      contactPhone: '+8809610-007339',
      contactEmail: 'support@redx.com.bd',
      notes: 'Nationwide door-to-door delivery with live OTP verification.',
      isActive: true,
    },
    {
      code: 'paperfly',
      name: 'Paperfly Logistics (পেপারফ্লাই)',
      leg: 'LOCAL_BD_COURIER',
      serviceType: 'DOORSTEP_DELIVERY',
      baseDeliveryFeeBdt: 65,
      outsideDhakaFeeBdt: 115,
      codFeePercent: 1.0,
      trackingUrlTemplate: 'https://paperfly.com.bd/track?tracking_number={tracking}',
      contactPhone: '+8809678-300400',
      contactEmail: 'support@paperfly.com.bd',
      notes: 'Deep nationwide doorstep delivery across all union parishads.',
      isActive: true,
    },
    {
      code: 'sundarban',
      name: 'Sundarban Courier Service (সুন্দরবন)',
      leg: 'LOCAL_BD_COURIER',
      serviceType: 'STANDARD_DELIVERY',
      baseDeliveryFeeBdt: 50,
      outsideDhakaFeeBdt: 100,
      codFeePercent: 0.0,
      trackingUrlTemplate: 'https://sundarbancourier.com/track/{tracking}',
      contactPhone: '+8802-9568770',
      notes: 'Branch to branch & parcel booking across 64 districts.',
      isActive: true,
    },
    {
      code: 'office_pickup',
      name: 'A2Z Office Self-Pickup (সেলফ পিকআপ)',
      leg: 'LOCAL_BD_COURIER',
      serviceType: 'OFFICE_PICKUP',
      baseDeliveryFeeBdt: 0,
      outsideDhakaFeeBdt: 0,
      codFeePercent: 0.0,
      notes: 'Customer directly collects order from A2Z Dhaka Central Hub (Banani / Uttara).',
      isActive: true,
    },
    {
      code: 'usps',
      name: 'US Postal Service (USPS)',
      leg: 'DOMESTIC_ORIGIN',
      serviceType: 'PRIORITY_MAIL',
      trackingUrlTemplate: 'https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}',
      notes: 'US merchant delivery to A2Z JFK Consolidation Hub.',
      isActive: true,
    },
    {
      code: 'ups',
      name: 'United Parcel Service (UPS)',
      leg: 'DOMESTIC_ORIGIN',
      serviceType: 'GROUND_SHIPPING',
      trackingUrlTemplate: 'https://www.ups.com/track?tracknum={tracking}',
      notes: 'US domestic ground and 2nd-day air shipping.',
      isActive: true,
    },
    {
      code: 'fedex',
      name: 'FedEx Express & Ground',
      leg: 'DOMESTIC_ORIGIN',
      serviceType: 'GROUND_SHIPPING',
      trackingUrlTemplate: 'https://www.fedex.com/fedextrack/?trknbr={tracking}',
      notes: 'US domestic standard and overnight courier.',
      isActive: true,
    },
  ];

  for (const c of carriers) {
    await prisma.shippingCarrier.upsert({
      where: { code: c.code },
      update: c,
      create: c,
    });
  }

  const all = await prisma.shippingCarrier.findMany();
  console.log('Successfully seeded! Total carriers:', all.length);
  console.log(all.map(c => `${c.code} (${c.leg})`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

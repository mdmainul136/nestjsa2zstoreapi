const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function debug() {
  console.log('=== DEBUGGING LIVE VPS DATABASE ===');
  
  // 1. Total products with media.a2zoutletstore.com
  const totalBroken = await prisma.product.count({
    where: { imageUrl: { contains: 'media.a2zoutletstore.com' } }
  });
  console.log('Total broken products in live DB:', totalBroken);

  // 2. Total RawScrapedItem in live DB
  const totalRaw = await prisma.rawScrapedItem.count();
  console.log('Total RawScrapedItem count in live DB:', totalRaw);

  // 3. Inspect 3 broken products and check their raw item match
  const samples = await prisma.product.findMany({
    where: { imageUrl: { contains: 'media.a2zoutletstore.com' } },
    select: { id: true, title: true, sourceUrl: true, asin: true, externalId: true, imageUrl: true },
    take: 3
  });

  for (const s of samples) {
    console.log('\n--- Sample Product ---');
    console.log('ID:', s.id);
    console.log('Title:', s.title);
    console.log('sourceUrl:', s.sourceUrl);
    console.log('asin:', s.asin);
    console.log('externalId:', s.externalId);
    console.log('imageUrl:', s.imageUrl);

    // Try finding in RawScrapedItem by sourceUrl
    if (s.sourceUrl) {
      const rByUrl = await prisma.rawScrapedItem.findFirst({
        where: { url: s.sourceUrl }
      });
      if (rByUrl) {
        console.log('Matched Raw by URL! Raw keys:', Object.keys(rByUrl.rawData || {}));
        const raw = rByUrl.rawData;
        console.log('image:', raw?.image, 'image_url:', raw?.image_url, 'data.images:', raw?.data?.images?.slice?.(0, 2), 'images:', raw?.images?.slice?.(0, 2));
      } else {
        console.log('NO RawScrapedItem match by sourceUrl');
      }
    }

    // Try finding by externalId
    if (s.externalId) {
      const rByExt = await prisma.rawScrapedItem.findFirst({
        where: { externalId: s.externalId }
      });
      console.log('Matched Raw by externalId?', !!rByExt);
    }
  }
}

debug().finally(() => prisma.$disconnect());

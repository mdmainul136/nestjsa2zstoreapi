const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function extractOriginalImages(raw) {
  if (!raw) return { primary: null, images: [], variations: [] };
  const rawObj = typeof raw === 'string' ? JSON.parse(raw) : raw;

  const isGoodUrl = (u) => typeof u === 'string' && u.startsWith('http') && !u.includes('media.a2zoutletstore.com');

  let images = [];

  if (Array.isArray(rawObj.data?.images)) {
    images.push(...rawObj.data.images.filter(isGoodUrl));
  }
  if (Array.isArray(rawObj.images)) {
    images.push(...rawObj.images.filter(isGoodUrl));
  }
  if (Array.isArray(rawObj.data?.galleries)) {
    for (const g of rawObj.data.galleries) {
      if (typeof g === 'string' && isGoodUrl(g)) images.push(g);
      else if (g && isGoodUrl(g.url)) images.push(g.url);
      else if (g && isGoodUrl(g.image)) images.push(g.image);
    }
  }

  const singleCandidates = [
    rawObj.image,
    rawObj.image_url,
    rawObj.data?.image,
    rawObj.data?.image_url,
    rawObj.data?.main_image
  ];

  for (const c of singleCandidates) {
    if (isGoodUrl(c)) {
      images.unshift(c);
    }
  }

  const unique = Array.from(new Set(images));
  const primary = unique.length > 0 ? unique[0] : null;

  const rawVars = rawObj.variations || rawObj.data?.variations || [];
  const variations = Array.isArray(rawVars) ? rawVars : Object.values(rawVars);

  return { primary, images: unique, variations };
}

async function run() {
  console.log('=== STARTING FAST BULK IMAGE RESTORATION ===');
  const startTime = Date.now();

  const BATCH_SIZE = 500;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let variantsUpdated = 0;
  let lastId = '';

  // PASS 1: Join on sourceUrl = r.url
  while (true) {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT p.id, p."imageUrl", p.images, r."rawData"
      FROM "Product" p
      JOIN "RawScrapedItem" r ON p."sourceUrl" = r."url"
      WHERE p.id > '${lastId}'
        AND p."imageUrl" LIKE '%media.a2zoutletstore.com%'
      ORDER BY p.id ASC
      LIMIT ${BATCH_SIZE}
    `);

    if (!rows || rows.length === 0) {
      break;
    }

    lastId = rows[rows.length - 1].id;
    totalProcessed += rows.length;

    const CONCURRENCY = 30;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (p) => {
        const { primary, images, variations } = extractOriginalImages(p.rawData);
        if (!primary && images.length === 0) return;

        const cleanImages = images.length > 0 ? images : (primary ? [primary] : []);

        await prisma.product.update({
          where: { id: p.id },
          data: {
            imageUrl: primary || undefined,
            images: cleanImages
          }
        });
        totalUpdated++;

        // Update variants
        try {
          const variants = await prisma.variant.findMany({
            where: {
              productId: p.id,
              imageUrl: { contains: 'media.a2zoutletstore.com' }
            },
            select: { id: true, sku: true, title: true }
          });

          for (const v of variants) {
            const match = variations.find(rawV => 
              (v.sku && (rawV.variant_asin === v.sku || rawV.sku === v.sku || rawV.asin === v.sku)) ||
              (v.title && rawV.name === v.title)
            );
            const varImg = match?.swatch || match?.image || match?.image_url || primary;
            if (varImg && typeof varImg === 'string' && varImg.startsWith('http') && !varImg.includes('media.a2zoutletstore.com')) {
              await prisma.variant.update({
                where: { id: v.id },
                data: { imageUrl: varImg }
              });
              variantsUpdated++;
            }
          }
        } catch (err) {}
      }));
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${elapsed}s] Progress: ${totalProcessed} / ~25,350 | Products Updated: ${totalUpdated} | Variants Updated: ${variantsUpdated}`);
  }

  // PASS 2: Check remaining products by externalId = r.externalId
  console.log('Checking remaining by externalId...');
  const remainingRows = await prisma.$queryRawUnsafe(`
    SELECT p.id, p."imageUrl", p.images, r."rawData"
    FROM "Product" p
    JOIN "RawScrapedItem" r ON p."externalId" = r."externalId"
    WHERE p."imageUrl" LIKE '%media.a2zoutletstore.com%'
    LIMIT 1000
  `);

  if (remainingRows && remainingRows.length > 0) {
    console.log(`Found ${remainingRows.length} remaining products matching by externalId`);
    for (const p of remainingRows) {
      const { primary, images } = extractOriginalImages(p.rawData);
      if (primary || images.length > 0) {
        await prisma.product.update({
          where: { id: p.id },
          data: {
            imageUrl: primary || undefined,
            images: images.length > 0 ? images : [primary]
          }
        });
        totalUpdated++;
      }
    }
  }

  // Sync remaining variants to parent product's imageUrl
  console.log('Syncing any remaining broken variants with parent product image...');
  await prisma.$queryRawUnsafe(`
    UPDATE "Variant" v
    SET "imageUrl" = p."imageUrl"
    FROM "Product" p
    WHERE v."productId" = p.id
      AND v."imageUrl" LIKE '%media.a2zoutletstore.com%'
      AND p."imageUrl" NOT LIKE '%media.a2zoutletstore.com%'
  `);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== COMPLETED SUCCESSFULLY IN ${totalTime}s ===`);
  console.log(`Total Products Restored: ${totalUpdated}`);
  console.log(`Total Variants Restored: ${variantsUpdated}`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

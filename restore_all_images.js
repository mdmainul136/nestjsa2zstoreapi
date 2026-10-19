const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function isBrokenUrl(u) {
  if (!u || typeof u !== 'string') return true;
  const s = u.trim();
  return (
    s.includes('media.a2zoutletstore.com') ||
    s.includes('r2.cloudflarestorage.com') ||
    s.includes('cdn.a2zoutletstore.com/uploads') ||
    s.startsWith('/uploads') ||
    s.includes('/uploads/') ||
    s.includes('placeholder.png')
  );
}

function normalizeUrl(u) {
  if (!u || typeof u !== 'string') return null;
  let clean = u.trim();
  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (clean.startsWith('/productimages/')) clean = 'https://www.sephora.com' + clean;
  return clean;
}

function isGoodUrl(u) {
  const norm = normalizeUrl(u);
  return typeof norm === 'string' && norm.startsWith('http') && !isBrokenUrl(norm);
}

function extractOriginalImages(raw) {
  if (!raw) return { primary: null, images: [], variations: [] };
  const rawObj = typeof raw === 'string' ? JSON.parse(raw) : raw;

  let images = [];
  const add = (u) => {
    const norm = normalizeUrl(u);
    if (norm && isGoodUrl(norm)) images.push(norm);
  };

  // 1. Check product subobject (Amazon / Walmart / Sephora / Target scraper format)
  if (Array.isArray(rawObj.product?.images)) rawObj.product.images.forEach(add);
  add(rawObj.product?.image);
  add(rawObj.product?.image_url);

  // 2. Check data subobject
  if (Array.isArray(rawObj.data?.images)) rawObj.data.images.forEach(add);
  add(rawObj.data?.image);
  add(rawObj.data?.image_url);
  add(rawObj.data?.main_image);

  // 3. Check root arrays & fields
  if (Array.isArray(rawObj.images)) rawObj.images.forEach(add);
  add(rawObj.image);
  add(rawObj.image_url);

  // 4. Check galleries
  if (Array.isArray(rawObj.data?.galleries)) {
    for (const g of rawObj.data.galleries) {
      if (typeof g === 'string') add(g);
      else if (g && g.url) add(g.url);
      else if (g && g.image) add(g.image);
    }
  }

  // 5. Variations
  const rawVars = rawObj.product?.variations || rawObj.variations || rawObj.data?.variations || [];
  const variations = Array.isArray(rawVars) ? rawVars : Object.values(rawVars);

  for (const v of variations) {
    add(v?.swatch);
    add(v?.image);
    add(v?.image_url);
  }

  const unique = Array.from(new Set(images));
  const primary = unique.length > 0 ? unique[0] : null;

  return { primary, images: unique, variations };
}

async function run() {
  console.log('=== STARTING COMPLETE BULK IMAGE & VARIANT RESTORATION ===');
  const startTime = Date.now();

  const brokenCondition = `
    (
      "imageUrl" LIKE '%media.a2zoutletstore.com%'
      OR "imageUrl" LIKE '%r2.cloudflarestorage.com%'
      OR "imageUrl" LIKE '%cdn.a2zoutletstore.com/uploads%'
      OR "imageUrl" LIKE '%/uploads/%'
      OR "imageUrl" LIKE '/uploads%'
    )
  `;

  const totalBrokenProducts = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int as count FROM "Product" WHERE ${brokenCondition}
  `);
  const totalBrokenVariants = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int as count FROM "Variant" WHERE ${brokenCondition}
  `);

  const initialProdCount = totalBrokenProducts[0]?.count || 0;
  const initialVarCount = totalBrokenVariants[0]?.count || 0;
  console.log(`Initial broken products to restore: ${initialProdCount}`);
  console.log(`Initial broken variants to restore: ${initialVarCount}`);

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
        AND (
          p."imageUrl" LIKE '%media.a2zoutletstore.com%'
          OR p."imageUrl" LIKE '%r2.cloudflarestorage.com%'
          OR p."imageUrl" LIKE '%cdn.a2zoutletstore.com/uploads%'
          OR p."imageUrl" LIKE '%/uploads/%'
          OR p."imageUrl" LIKE '/uploads%'
          OR EXISTS (
            SELECT 1 FROM "Variant" v 
            WHERE v."productId" = p.id 
              AND (
                v."imageUrl" LIKE '%media.a2zoutletstore.com%'
                OR v."imageUrl" LIKE '%r2.cloudflarestorage.com%'
                OR v."imageUrl" LIKE '%cdn.a2zoutletstore.com/uploads%'
                OR v."imageUrl" LIKE '%/uploads/%'
                OR v."imageUrl" LIKE '/uploads%'
              )
          )
        )
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

        if (isBrokenUrl(p.imageUrl) && primary) {
          await prisma.product.update({
            where: { id: p.id },
            data: {
              imageUrl: primary,
              images: cleanImages
            }
          });
          totalUpdated++;
        }

        // Update variants (swatches & images)
        try {
          const variants = await prisma.$queryRawUnsafe(`
            SELECT id, sku, title, "imageUrl"
            FROM "Variant"
            WHERE "productId" = '${p.id}'
              AND (
                "imageUrl" LIKE '%media.a2zoutletstore.com%'
                OR "imageUrl" LIKE '%r2.cloudflarestorage.com%'
                OR "imageUrl" LIKE '%cdn.a2zoutletstore.com/uploads%'
                OR "imageUrl" LIKE '%/uploads/%'
                OR "imageUrl" LIKE '/uploads%'
                OR "imageUrl" IS NULL
              )
          `);

          for (const v of variants) {
            const match = variations.find(rawV => 
              (v.sku && (rawV.variant_asin === v.sku || rawV.sku === v.sku || rawV.asin === v.sku || rawV.id === v.sku)) ||
              (v.title && (rawV.name === v.title || rawV.title === v.title || rawV.color === v.title))
            );
            const rawVarImg = match?.swatch || match?.image || match?.image_url || primary;
            const normVarImg = normalizeUrl(rawVarImg);
            if (isGoodUrl(normVarImg)) {
              await prisma.variant.update({
                where: { id: v.id },
                data: { imageUrl: normVarImg }
              });
              variantsUpdated++;
            }
          }
        } catch (err) {}
      }));
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[${elapsed}s] Progress: ${totalProcessed} products | Products Updated: ${totalUpdated} | Variants Updated: ${variantsUpdated}`);
  }

  // PASS 2: Match remaining by externalId or ASIN
  console.log('Checking remaining by externalId / ASIN...');
  const remainingRows = await prisma.$queryRawUnsafe(`
    SELECT p.id, p."imageUrl", p.images, r."rawData"
    FROM "Product" p
    JOIN "RawScrapedItem" r ON (
      (p."externalId" IS NOT NULL AND p."externalId" = r."externalId")
      OR (p."asin" IS NOT NULL AND p."asin" = r."externalId")
    )
    WHERE (
      p."imageUrl" LIKE '%media.a2zoutletstore.com%'
      OR p."imageUrl" LIKE '%r2.cloudflarestorage.com%'
      OR p."imageUrl" LIKE '%cdn.a2zoutletstore.com/uploads%'
      OR p."imageUrl" LIKE '%/uploads/%'
      OR p."imageUrl" LIKE '/uploads%'
    )
    LIMIT 3000
  `);

  if (remainingRows && remainingRows.length > 0) {
    console.log(`Found ${remainingRows.length} remaining products matching by externalId/ASIN`);
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

  // PASS 3: Fallback sync for remaining broken variants to parent product's good imageUrl
  console.log('Syncing any remaining broken variants with parent product image...');
  const pass3Result = await prisma.$executeRawUnsafe(`
    UPDATE "Variant" v
    SET "imageUrl" = p."imageUrl"
    FROM "Product" p
    WHERE v."productId" = p.id
      AND (
        v."imageUrl" LIKE '%media.a2zoutletstore.com%'
        OR v."imageUrl" LIKE '%r2.cloudflarestorage.com%'
        OR v."imageUrl" LIKE '%cdn.a2zoutletstore.com/uploads%'
        OR v."imageUrl" LIKE '%/uploads/%'
        OR v."imageUrl" LIKE '/uploads%'
      )
      AND p."imageUrl" NOT LIKE '%media.a2zoutletstore.com%'
      AND p."imageUrl" NOT LIKE '%r2.cloudflarestorage.com%'
      AND p."imageUrl" NOT LIKE '%cdn.a2zoutletstore.com/uploads%'
      AND p."imageUrl" NOT LIKE '%/uploads/%'
      AND p."imageUrl" NOT LIKE '/uploads%';
  `);
  console.log(`Pass 3 variants updated: ${pass3Result}`);

  const totalBrokenEndProds = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int as count FROM "Product" WHERE ${brokenCondition}
  `);
  const totalBrokenEndVars = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int as count FROM "Variant" WHERE ${brokenCondition}
  `);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== COMPLETED SUCCESSFULLY IN ${totalTime}s ===`);
  console.log(`Total Products Restored: ${totalUpdated}`);
  console.log(`Total Variants Restored: ${variantsUpdated + pass3Result}`);
  console.log(`Remaining broken products in DB: ${totalBrokenEndProds[0]?.count || 0}`);
  console.log(`Remaining broken variants in DB: ${totalBrokenEndVars[0]?.count || 0}`);
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

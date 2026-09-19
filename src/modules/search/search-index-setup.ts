import { PrismaClient } from '@prisma/client';

export async function setupSearchIndexes(prisma: PrismaClient) {
  try {
    // ১. এক্সটেনশনসমূহ নিশ্চিত করা
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
    await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS unaccent;`);

    // ২. Product Title, ASIN, SKU ট্রাইগ্রাম ইনডেক্স
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_product_title_trgm 
      ON "Product" USING gin (title gin_trgm_ops);
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_product_asin_trgm 
      ON "Product" USING gin (asin gin_trgm_ops);
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_product_sku_trgm 
      ON "Product" USING gin (sku gin_trgm_ops);
    `);

    // ৩. Brand & Category ট্রাইগ্রাম ইনডেক্স
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_brand_name_trgm 
      ON "Brand" USING gin (name gin_trgm_ops);
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_category_name_trgm 
      ON "Category" USING gin (name gin_trgm_ops);
    `);

    // ৪. কম্পোজিট ওয়েটেড ফুল-টেক্সট সার্চ ভেক্টর ইনডেক্স
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_product_weighted_fts ON "Product" USING gin (
        (
          setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(asin, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(sku, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(description, '')), 'B')
        )
      );
    `);
  } catch (error) {
    throw error;
  }
}

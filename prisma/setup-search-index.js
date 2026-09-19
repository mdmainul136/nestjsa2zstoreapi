"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSearchIndexes = setupSearchIndexes;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function setupSearchIndexes() {
    console.log('🚀 Initializing PostgreSQL Full-Text & Trigram Search Indexes...');
    try {
        await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);
        await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS unaccent;`);
        console.log('✅ PostgreSQL extensions (pg_trgm, unaccent) verified.');
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
        await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_brand_name_trgm 
      ON "Brand" USING gin (name gin_trgm_ops);
    `);
        await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_category_name_trgm 
      ON "Category" USING gin (name gin_trgm_ops);
    `);
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
        console.log('✅ PostgreSQL GIN Weighted Trigram & Full-Text Indexes created successfully!');
    }
    catch (error) {
        console.error('❌ Failed to create search indexes:', error);
        throw error;
    }
}
if (require.main === module) {
    setupSearchIndexes()
        .catch((err) => {
        console.error(err);
        process.exit(1);
    })
        .finally(async () => {
        await prisma.$disconnect();
    });
}
//# sourceMappingURL=setup-search-index.js.map
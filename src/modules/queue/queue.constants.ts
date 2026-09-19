export const QUEUE_NAMES = {
  SCRAPER_SYNC: 'scraper-sync',
  PRICE_CHECK: 'price-check',
  SEARCH_INDEX: 'search-index',
} as const;

export const JOB_NAMES = {
  SYNC_EXTENSION_ITEM: 'sync-extension-item',
  BULK_SYNC_ITEMS: 'bulk-sync-items',
  SYNC_PRICE_UPDATE: 'sync-price-update',
} as const;

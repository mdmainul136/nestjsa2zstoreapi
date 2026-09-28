/**
 * Catalog Compliance & Restricted Items Guard
 * Prevents adult novelties, sex toys, sexual wellness devices (penis pumps, vibrators, erectile devices, etc.)
 * from being published live on the storefront / catalog.
 */

export const COMPLIANCE_RESTRICTED_KEYWORDS: string[] = [
  // 1. Male sexual devices & enhancement
  'penis',
  'penis pump',
  'penis sleeve',
  'penis ring',
  'penis extender',
  'penis enlarger',
  'erectile',
  'erectile device',
  'erectile dysfunction device',
  'erection pump',
  'erectile pump',
  'male enhancement pump',
  'delay spray for men',

  // 2. Vibrators & female sexual devices
  'vibrator',
  'rabbit vibrator',
  'bullet vibrator',
  'tongue vibrator',
  'wand vibrator',
  'clitoral',
  'clitoris',
  'clit suction',
  'clitoral stimulator',
  'clitoral massage',
  'clitoral massager',
  'g-spot stimulator',

  // 3. General adult novelties & toys
  'dildo',
  'dildos',
  'strap-on',
  'strapon',
  'masturbate',
  'masturbation',
  'masturbator',
  'fleshlight',
  'pocket pussy',
  'artificial vagina',
  'sex doll',
  'sex toy',
  'sex toys',
  'adult toy',
  'adult toys',
  'adult novelty',
  'adult novelties',
  'erotic toy',
  'erotic novelties',

  // 4. Anal & prostate devices
  'butt plug',
  'anal plug',
  'anal bead',
  'anal beads',
  'anal probe',
  'prostate massager',
  'prostate stimulator',

  // 5. Fetish & BDSM
  'chastity cage',
  'chastity device',
  'bondage kit',
  'sex swing',
  'spanking paddle',
  'bdsm gear',

  // 6. Intimate arousal cosmetics / intimacy
  'buzzing arousal gel',
  'sexual enhancer',
  'orgasm gel',
];

// পারফরম্যান্সের জন্য রেজেক্সগুলো একবারই মডিউল লোডের সময় কম্পাইল করে রাখা হলো
const COMPILED_RESTRICTED_PATTERNS = COMPLIANCE_RESTRICTED_KEYWORDS.map((kw) => {
  const normalized = kw.toLowerCase().trim();
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    keyword: normalized,
    // \b নিশ্চিত করে যে পুরো শব্দটি মিলেছে, আংশিক শব্দের সাথে নয় (যেমন peninsular বা openissue ম্যাচ করবে না)
    regex: new RegExp(`\\b${escaped}\\b`, 'i'),
  };
});

export interface ComplianceCheckResult {
  isViolation: boolean;
  matchedKeywords: string[];
  reason?: string;
}

/**
 * Checks a product or scraped item against restricted compliance rules.
 */
export function checkComplianceViolation(input: {
  title?: string | null;
  description?: string | null;
  category?: string | null;
  subcategory?: string | null;
  tags?: string[] | null;
}): ComplianceCheckResult {
  const textToScan = [
    input.title || '',
    input.category || '',
    input.subcategory || '',
    Array.isArray(input.tags) ? input.tags.join(' ') : '',
    // সম্পূর্ণ ডেসক্রিপশন স্ক্যান করা নিরাপদ, বাইপাস রোধ করতে প্রথম ৩০০০ ক্যারেক্টার স্ক্যান করা হচ্ছে
    (input.description || '').slice(0, 3000),
  ]
    .join(' ')
    .toLowerCase();

  if (!textToScan.trim()) {
    return { isViolation: false, matchedKeywords: [] };
  }

  const matchedKeywords: string[] = [];

  for (const { keyword, regex } of COMPILED_RESTRICTED_PATTERNS) {
    if (regex.test(textToScan)) {
      matchedKeywords.push(keyword);
    }
  }

  const isViolation = matchedKeywords.length > 0;

  return {
    isViolation,
    matchedKeywords,
    reason: isViolation
      ? `Restricted adult/sexual wellness item: matched [${matchedKeywords.join(', ')}]`
      : undefined,
  };
}

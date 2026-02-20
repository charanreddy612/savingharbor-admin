/**
 * STEP 3: Content Generator (Upgraded — Groq/Llama)
 * Run: node scripts/Dynamic_Store_Content/03_generator.js --dry-run --limit=5
 */

import { supabase } from "../../dbhelper/dbclient.js";
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import pLimit from 'p-limit';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

const GROQ_KEY     = process.env.GROQ_API_KEY;
const groq     = new Groq({ apiKey: GROQ_KEY });

const CONCURRENCY    = 2;
const DELAY_MS       = 5000; // ~12 req/min, well within Groq free limits
const BATCH_SIZE     = 50;

const args        = process.argv.slice(2);
function getArg(name) {
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx+1] && !args[idx+1].startsWith('--')) return args[idx+1];
  return null;
}
const TIER_FILTER = getArg('tier') || null;
const LIMIT       = parseInt(getArg('limit') || '50');
const DRY_RUN     = args.includes('--dry-run');

// ─── Rate limiter ─────────────────────────────────────────────────────────────

let lastCall = 0;
async function rateLimit() {
  const wait = DELAY_MS - (Date.now() - lastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
}

// ─── Coupon stats ─────────────────────────────────────────────────────────────

async function getCouponStats(merchantId) {
  const { data: coupons } = await supabase
    .from('coupons')
    .select('title, coupon_type, discount_type, discount_percent_value, discount_flat_value, click_count, coupon_code, ends_at')
    .eq('merchant_id', merchantId)
    .eq('is_publish', true)
    .order('click_count', { ascending: false })
    .limit(25);

  if (!coupons?.length) return null;

  const pct   = coupons.filter(c => c.discount_type === 'percent' && c.discount_percent_value > 0);
  const flat  = coupons.filter(c => c.discount_type === 'flat'    && c.discount_flat_value    > 0);
  const codes = coupons.filter(c => c.coupon_code);

  // Check for expiring soon (within 7 days)
  const soon  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const expiringSoon = coupons.filter(c => c.ends_at && c.ends_at < soon && c.ends_at > new Date().toISOString());

  return {
    total:           coupons.length,
    couponCount:     coupons.filter(c => c.coupon_type === 'coupon').length,
    dealCount:       coupons.filter(c => c.coupon_type === 'deal').length,
    maxDiscountPct:  pct.length  ? Math.max(...pct.map(c => c.discount_percent_value))  : null,
    avgDiscountPct:  pct.length  ? Math.round(pct.reduce((s,c) => s + c.discount_percent_value, 0) / pct.length) : null,
    maxFlatDiscount: flat.length ? Math.max(...flat.map(c => c.discount_flat_value))    : null,
    topTitles:       coupons.slice(0, 6).map(c => c.title),
    hasCodes:        codes.length > 0,
    sampleCodes:     codes.slice(0, 3).map(c => c.coupon_code),
    expiringSoon:    expiringSoon.length,
    codesVsDeals:    codes.length > coupons.length / 2 ? 'mostly coupon codes' : 'mostly deals/sales',
  };
}

// ─── Build context string ─────────────────────────────────────────────────────

function buildContext(merchant, scraped, stats) {
  const L = [
    `STORE: ${merchant.name}`,
    `URL: ${merchant.web_url || 'unknown'}`,
    `CATEGORIES: ${(merchant.category_names || []).join(', ') || 'unknown'}`,
  ];

  if (stats) {
    L.push(`\n== LIVE COUPON DATA (from our database) ==`);
    L.push(`Total active: ${stats.total} (${stats.couponCount} codes, ${stats.dealCount} deals)`);
    if (stats.maxDiscountPct)  L.push(`Max discount: ${stats.maxDiscountPct}% off`);
    if (stats.avgDiscountPct)  L.push(`Average discount: ~${stats.avgDiscountPct}% off`);
    if (stats.maxFlatDiscount) L.push(`Largest flat: $${stats.maxFlatDiscount} off`);
    if (stats.hasCodes)        L.push(`Coupon codes available: YES (${stats.codesVsDeals})`);
    if (stats.sampleCodes?.length) L.push(`Sample active codes: ${stats.sampleCodes.join(', ')}`);
    if (stats.expiringSoon)    L.push(`Expiring within 7 days: ${stats.expiringSoon} offers`);
    if (stats.topTitles?.length) {
      L.push(`Top deals by clicks:`);
      stats.topTitles.forEach(t => L.push(`  • ${t}`));
    }
  }

  if (scraped) {
    L.push(`\n== SCRAPED FROM STORE WEBSITE ==`);
    if (scraped.h1)                     L.push(`H1: "${scraped.h1}"`);
    if (scraped.metaDescription)        L.push(`Meta: "${scraped.metaDescription}"`);
    if (scraped.taglines?.length)       L.push(`Brand taglines: ${scraped.taglines.join(' | ')}`);
    if (scraped.productHeadings?.length) L.push(`Products/categories: ${scraped.productHeadings.slice(0, 10).join(', ')}`);
    if (scraped.keyParagraphs?.length) {
      L.push(`Key content from site:`);
      scraped.keyParagraphs.slice(0, 4).forEach(p => L.push(`  "${p.substring(0, 250)}"`));
    }
    if (scraped.faqs?.length) {
      L.push(`FAQs from their website (rewrite these, don't copy):`);
      scraped.faqs.slice(0, 8).forEach(f => L.push(`  Q: ${f.q}\n  A: ${f.a?.substring(0, 200)}`));
    }
    if (scraped.salePatterns?.length)   L.push(`Sale patterns observed: ${scraped.salePatterns.join(' | ')}`);

    const t = scraped.trustSignals || {};
    if (t.yearsInBusiness)              L.push(`Founded/years: ${t.yearsInBusiness}`);
    if (t.warranty)                     L.push(`Warranty: ${t.warranty}`);
    if (t.returnWindow)                 L.push(`Returns: ${t.returnWindow}`);
    if (t.freeShippingThreshold)        L.push(`Free shipping: ${t.freeShippingThreshold}`);
    if (t.trustpilot)                   L.push(`On Trustpilot: yes`);
    if (t.bbb)                          L.push(`BBB: mentioned`);
    if (t.reviewCount)                  L.push(`Review count: ${t.reviewCount}`);
    if (t.rating)                       L.push(`Rating: ${t.rating}/5`);
    if (scraped.visiblePromoCodes?.length) L.push(`Promo codes visible on site: ${scraped.visiblePromoCodes.join(', ')}`);
    if (scraped.hasFinancing)           L.push(`Financing: available`);
    if (scraped.hasFreeShipping)        L.push(`Free shipping: yes`);
    if (scraped.appDiscount)            L.push(`App discount: yes`);
    if (scraped.studentDiscount)        L.push(`Student discount: yes`);
    if (scraped.loyaltyProgram)         L.push(`Loyalty/rewards: yes`);
  }

  return L.join('\n');
}

// ─── Prompt ───

function buildPrompt(merchant, scraped, stats, tier) {
  const context = buildContext(merchant, scraped, stats);
  const storeName = merchant.name;

  const depthGuide = {
    A: 'You have rich data. Be highly specific — use actual product names, real discount figures, real policies. Reference specific details from the scraped content. Every sentence must be unique to this store.',
    B: 'Good data available. Be specific about what this store sells and how to save. Reference actual products, categories, policies.',
    C: 'Limited data. Be honest and useful. Focus on what they sell and practical saving tips. Compensate by going deeper on what you DO know — expand saving tips, explain how coupon sites work for this category, what to look for when shopping here. Never invent specifics but write thoroughly around what you have.',
  }[tier] || 'Be useful and specific.';

  return `You write editorial content for Saving Harbor, a coupon and deals website.

STORE DATA:
${context}

WRITING RULES (follow strictly):
- Tone: like a savvy friend who shops a lot — casual, direct, occasionally witty, always useful
- description_html MUST be 600-750 words. Count your words. If you are under 600, expand each section. This is a hard requirement.
- Use real data from the store context above. If something isn't in the data, say "check their site" — never invent
- ${depthGuide}
- BANNED PHRASES (never use): "look no further", "in today's world", "in conclusion", "whether you're a", "dive into", "unlock", "elevate your", "game-changer", "seamlessly", "leverage", "it's worth noting", "as an AI", "nestled", "robust", "supercharge", "revolutionize", "curated selection"
- SEO: naturally weave in "${storeName} coupon code", "${storeName} promo code", "${storeName} discount" — don't force it, make it flow
- Write like a human editor, not a content generator

OUTPUT: Return ONLY a valid JSON object. No markdown, no explanation, just raw JSON.

{
  "meta_title": "60 chars max. Pattern: [Store] Coupons & Promo Codes [current year] | Saving Harbor",

  "meta_description": "155-160 chars exactly. What they sell + best discount available + call to action. Include '${storeName} coupon' naturally.",

  "side_description_html": "<p>2-3 sentence hook for the hero section. What makes this store worth shopping at, and what kind of savings are available here right now. Specific, no filler.</p>",

  "table_content_html": "<p>3-4 sentences. Store identity — who they are, what they sell, who their customer is. Think of this as the 'about this store in a nutshell' block. Use facts from the data.</p>",

  "description_html": "Full editorial HTML. Use this exact section structure:\n<h3>What is ${storeName}?</h3><p>Who they are, founding story if known, what makes them different from competitors. 80-100 words.</p>\n<h3>What Does ${storeName} Sell?</h3><p>Specific product lines, categories, price ranges, who it's for. Name actual products/categories from the data. 80-100 words.</p>\n<h3>How to Save Money at ${storeName}</h3><p>This is the most important section. Specific saving strategies for THIS store: when to use codes, stacking tips (code + sale + cashback), free shipping threshold, best time to buy, any app/student/loyalty discounts available. Reference real coupon data. write at least 200-250 words here...</p>\n<h3>Do ${storeName} Coupon Codes Actually Work?</h3><p>Honest assessment based on our data — how many active codes, what % off they typically offer, whether deals or codes are more common here. 80-100 words.</p>\n<h3>Best Time to Buy from ${storeName}</h3><p>Seasonal sale patterns, Black Friday/Cyber Monday history, flash sale frequency. If unknown, give general category advice. 80-100 words.</p>\n<h3>${storeName} Shipping & Returns</h3><p>Free shipping threshold, return window, anything that affects whether a deal is actually worth it. If unknown, say to check their site. 60-80 words.</p>",

  "faqs": [
    { "question": "Does ${storeName} have coupon codes?", "answer": "..." },
    { "question": "Does ${storeName} offer free shipping?", "answer": "..." },
    { "question": "What is ${storeName}'s return policy?", "answer": "..." },
    { "question": "When does ${storeName} have sales?", "answer": "..." },
    { "question": "...(from their site FAQs if available, rewritten)", "answer": "..." },
    { "question": "...(from their site FAQs if available, rewritten)", "answer": "..." }
  ],

  "trust_text": "1-2 sentences max. Specific trust signals: years in business, warranty, rating, reviews, return policy. Real numbers if available."
}

FAQ rules:
- First 4 questions are always coupon-site-relevant (codes, shipping, returns, sales timing)
- Last 2 questions: if store FAQs were scraped, rewrite the most useful ones; otherwise ask what shoppers actually Google
- Every answer references ${storeName} by name with specific details
- Answers should be 2-4 sentences — useful, not padded`;
}

// ─── Generate via Groq ────────────────────────────────────────────────────────

async function generateContent(merchant, scraped, stats, tier) {
  await rateLimit();

  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: buildPrompt(merchant, scraped, stats, tier) }],
    temperature: 0.65,
    max_tokens: 4000,
    response_format: { type: 'json_object' },
  });

  const text = response.choices[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response from Groq');
  return JSON.parse(text);
}

// ─── Save to DB ───────────────────────────────────────────────────────────────

async function saveContent(merchantId, g) {
  const { error } = await supabase.from('merchants').update({
    meta_title:            g.meta_title            || null,
    meta_description:      g.meta_description      || null,
    side_description_html: g.side_description_html || null,
    table_content_html:    g.table_content_html    || null,
    description_html:      g.description_html      || null,
    faqs:                  g.faqs                  || [],
    trust_text:            g.trust_text            || null,
    content_status:        'done',
    content_generated_at:  new Date().toISOString(),
    generation_error:      null,
  }).eq('id', merchantId);

  if (error) throw new Error(`DB: ${error.message}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`🚀 Generator | Tier: ${TIER_FILTER||'all'} | Limit: ${LIMIT} | Dry: ${DRY_RUN}`);

  const limiter = pLimit(CONCURRENCY);
  let offset = 0, total = 0, success = 0, fail = 0;

  while (total < LIMIT) {
    let q = supabase
      .from('merchants')
      .select('id, name, slug, web_url, category_names, scraped_data, content_tier, active_coupons_count')
      .eq('is_publish', true)
      .in('content_status', ['scraped', 'failed'])
      .order('scrape_score', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (TIER_FILTER) q = q.eq('content_tier', TIER_FILTER);

    const { data: merchants, error } = await q;
    if (error)             { console.error('DB error:', error); break; }
    if (!merchants?.length){ console.log('✅ No more stores.'); break; }

    const batch = merchants.slice(0, LIMIT - total);
    console.log(`\n📦 Batch: ${batch.length} stores`);

    await Promise.all(batch.map(m => limiter(async () => {
      const tier = m.content_tier || 'C';
      console.log(`  ↳ [${tier}] ${m.name}`);

      if (!DRY_RUN) {
        await supabase.from('merchants').update({ content_status: 'generating' }).eq('id', m.id);
      }

      try {
        const stats     = await getCouponStats(m.id);
        const generated = await generateContent(m, m.scraped_data, stats, tier);

        if (DRY_RUN) {
          console.log(`    title: ${generated.meta_title}`);
          console.log(`    desc:  ${generated.meta_description}`);
          console.log(`    words: ~${generated.description_html?.split(' ').length || 0}`);
          console.log(`    faqs:  ${generated.faqs?.length}`);
        } else {
          await saveContent(m.id, generated);
          const wordCount = generated.description_html?.split(' ').length || 0;
          console.log(`    ✓ saved (~${wordCount} words)`);
          success++;
        }
      } catch(err) {
        console.error(`    ✗ ${err.message}`);
        fail++;
        if (!DRY_RUN) {
          await supabase.from('merchants').update({
            content_status: 'failed',
            generation_error: err.message.substring(0, 500),
          }).eq('id', m.id);
        }
      }
    })));

    total += batch.length;
    if (merchants.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log(`\n🏁 Done | ✓ ${success} | ✗ ${fail} | Total ${total}`);
}

main().catch(console.error);
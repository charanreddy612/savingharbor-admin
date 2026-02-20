/**
 * Scrape Debugger
 * Runs the scraper on a single store URL and shows exactly what was extracted
 *
 * Run: node scripts/Dynamic_Store_Content/debug_scrape.js https://storeurl.com
 * Or by merchant slug: node scripts/Dynamic_Store_Content/debug_scrape.js --slug=trading-computers
 */

import * as cheerio from 'cheerio';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { supabase } from "../../dbhelper/dbclient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });


const args = process.argv.slice(2);
const slugArg = args.find(a => a.startsWith('--slug='))?.split('=')[1];
const urlArg  = args.find(a => !a.startsWith('--'));

const TIMEOUT_MS = 12000;

const SCRAPE_PATHS = [
  '/',
  '/about', '/about-us', '/our-story', '/who-we-are',
  '/faq', '/faqs', '/help', '/help-center', '/support',
  '/shipping', '/shipping-policy', '/delivery',
  '/returns', '/return-policy', '/refund-policy',
  '/sale', '/offers', '/promotions', '/deals',
  '/financing',
];

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SavingHarborBot/1.0)',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.log(`    ↳ ${url} → ${res.status} ${res.statusText}`);
      return null;
    }
    console.log(`    ↳ ${url} → ✓ ${res.status}`);
    return await res.text();
  } catch (e) {
    clearTimeout(timer);
    console.log(`    ↳ ${url} → ✗ ${e.message}`);
    return null;
  }
}

// ─── Extract ──────────────────────────────────────────────────────────────────

function extractFaqs($) {
  const faqs = [];

  $('[class*="faq"], [class*="accordion"], [class*="question"], [itemtype*="FAQPage"]').each((_, el) => {
    const q = $(el).find('[class*="question"], [itemprop="name"], dt, summary, h3, h4').first().text().trim();
    const a = $(el).find('[class*="answer"], [itemprop="text"], dd, [class*="content"], p').first().text().trim();
    if (q.length > 10 && a.length > 20) faqs.push({ q, a, source: 'class-pattern' });
  });

  $('dl').each((_, dl) => {
    $(dl).find('dt').each((_, dt) => {
      const q = $(dt).text().trim();
      const a = $(dt).next('dd').text().trim();
      if (q.length > 10 && a.length > 20) faqs.push({ q, a, source: 'dl/dt/dd' });
    });
  });

  $('main h3, main h4, article h3, article h4').each((_, el) => {
    const q = $(el).text().trim();
    const a = $(el).next('p').text().trim();
    if (q.endsWith('?') && a.length > 20) faqs.push({ q, a, source: 'h3/h4+p' });
  });

  const seen = new Set();
  return faqs.filter(f => {
    if (seen.has(f.q)) return false;
    seen.add(f.q);
    return true;
  }).slice(0, 10);
}

function extractFromHtml(html, path) {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, noscript, iframe').remove();

  const text = $('body').text();

  const result = {
    path,
    status: 'ok',
    metaDescription:  $('meta[name="description"]').attr('content') || null,
    ogDescription:    $('meta[property="og:description"]').attr('content') || null,
    h1:               $('h1').first().text().trim() || null,
    taglines:         [],
    productHeadings:  [],
    keyParagraphs:    [],
    faqs:             [],
    salePatterns:     [],
    visiblePromoCodes:[],
    trustSignals:     {},
    specialOffers:    {},
  };

  $('h2, .hero p, [class*="tagline"], [class*="subtitle"], [class*="hero"] p, [class*="banner"] p').each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 15 && t.length < 250) result.taglines.push(t);
  });
  result.taglines = result.taglines.slice(0, 5);

  $('main h2, main h3, article h2, article h3, .content h2, .content h3').each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 3 && t.length < 80) result.productHeadings.push(t);
  });
  result.productHeadings = [...new Set(result.productHeadings)].slice(0, 12);

  $('main p, article p, .about p, [class*="description"] p, [class*="content"] p, section p').each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 60 && t.length < 800) result.keyParagraphs.push(t);
  });
  result.keyParagraphs = result.keyParagraphs.slice(0, 8);

  result.faqs = extractFaqs($);

  const seasonal = text.match(/(black friday|cyber monday|summer sale|winter sale|spring sale|holiday sale|flash sale|clearance)[^.]{0,80}/gi) || [];
  result.salePatterns = [...new Set(seasonal.slice(0, 5).map(s => s.trim()))];

  result.trustSignals = {
    yearsInBusiness:       (text.match(/(since|founded|est\.?)\s*(\d{4})/i) || text.match(/(\d+)\s*years?\s*(of\s*)?(experience|in business)/i) || [])[0]?.trim() || null,
    returnWindow:          (text.match(/(\d+)[- ]day\s*(free\s*)?return/i) || [])[0]?.trim() || null,
    freeShippingThreshold: (text.match(/free\s*(standard\s*)?shipping\s*(on\s*orders?\s*)?(over|above)?\s*\$[\d,]+/i) || [])[0]?.trim() || null,
    warranty:              (text.match(/(\d+)[- ](year|month)\s*warranty/i) || text.match(/lifetime\s*warranty/i) || [])[0]?.trim() || null,
    trustpilot:            html.includes('trustpilot.com'),
    bbb:                   /better business bureau|bbb accredited/i.test(html),
    reviewCount:           (text.match(/([\d,]+)\s*(verified\s*)?reviews?/i) || [])[1] || null,
    rating:                (text.match(/(\d+\.?\d*)\s*(?:out of\s*5|\/\s*5|\s*stars?)/i) || [])[1] || null,
  };

  const codeMatches = html.match(/(?:code|coupon|promo)[:\s]+([A-Z0-9]{4,20})/gi) || [];
  result.visiblePromoCodes = [...new Set(codeMatches.map(m => m.split(/[:\s]+/).pop()))].slice(0, 5);

  result.specialOffers = {
    financing:       /financ|pay later|affirm|klarna|afterpay|sezzle/i.test(html),
    freeShipping:    /free shipping/i.test(html),
    appDiscount:     /app[^.]{0,30}(discount|off|exclusive)/i.test(html),
    studentDiscount: /student[^.]{0,30}(discount|off|program)/i.test(html),
    loyaltyProgram:  /loyalty|reward program|points|member(ship)? reward/i.test(html),
  };

  return result;
}

// ─── Print report ─────────────────────────────────────────────────────────────

function printReport(allData, storeName, webUrl) {
  console.log('\n' + '═'.repeat(60));
  console.log(`SCRAPE REPORT: ${storeName}`);
  console.log(`URL: ${webUrl}`);
  console.log('═'.repeat(60));

  for (const data of allData) {
    if (!data) continue;
    console.log(`\n── PAGE: ${data.path} ──`);

    if (data.h1)               console.log(`  H1:              "${data.h1}"`);
    if (data.metaDescription)  console.log(`  Meta desc:       "${data.metaDescription}"`);
    if (data.ogDescription)    console.log(`  OG desc:         "${data.ogDescription}"`);

    if (data.taglines?.length) {
      console.log(`  Taglines (${data.taglines.length}):`);
      data.taglines.forEach(t => console.log(`    • "${t}"`));
    }

    if (data.productHeadings?.length) {
      console.log(`  Product headings (${data.productHeadings.length}):`);
      data.productHeadings.forEach(h => console.log(`    • ${h}`));
    }

    if (data.keyParagraphs?.length) {
      console.log(`  Key paragraphs (${data.keyParagraphs.length}):`);
      data.keyParagraphs.forEach((p, i) => console.log(`    [${i+1}] ${p.substring(0, 150)}...`));
    }

    if (data.faqs?.length) {
      console.log(`  FAQs found (${data.faqs.length}) via ${data.faqs[0]?.source}:`);
      data.faqs.forEach(f => console.log(`    Q: ${f.q}\n       A: ${f.a?.substring(0, 120)}...`));
    }

    if (data.salePatterns?.length) {
      console.log(`  Sale patterns: ${data.salePatterns.join(' | ')}`);
    }

    if (data.visiblePromoCodes?.length) {
      console.log(`  Promo codes: ${data.visiblePromoCodes.join(', ')}`);
    }

    const t = data.trustSignals;
    const trustFound = Object.entries(t).filter(([,v]) => v && v !== false);
    if (trustFound.length) {
      console.log(`  Trust signals:`);
      trustFound.forEach(([k, v]) => console.log(`    ${k}: ${v}`));
    }

    const s = data.specialOffers;
    const specials = Object.entries(s).filter(([,v]) => v);
    if (specials.length) {
      console.log(`  Special offers: ${specials.map(([k]) => k).join(', ')}`);
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(60));
  console.log('SUMMARY:');
  const allFaqs      = allData.flatMap(d => d?.faqs || []);
  const allParagraphs = allData.flatMap(d => d?.keyParagraphs || []);
  const allHeadings  = allData.flatMap(d => d?.productHeadings || []);
  const allTaglines  = allData.flatMap(d => d?.taglines || []);

  console.log(`  Total FAQs scraped:      ${allFaqs.length}`);
  console.log(`  Total paragraphs:        ${allParagraphs.length}`);
  console.log(`  Total product headings:  ${allHeadings.length}`);
  console.log(`  Total taglines:          ${allTaglines.length}`);

  const score = Math.min(
    (allFaqs.length >= 2 ? 20 : 0) +
    (allParagraphs.length >= 3 ? 15 : 0) +
    (allHeadings.length >= 3 ? 15 : 0) +
    (allTaglines.length > 0 ? 10 : 0) +
    (allData[0]?.metaDescription ? 10 : 0) +
    (allData[0]?.h1 ? 5 : 0), 100
  );
  console.log(`  Estimated richness score: ${score}/100`);
  console.log(`  Estimated tier:           ${score >= 55 ? 'A' : score >= 30 ? 'B' : score >= 10 ? 'C' : 'D'}`);
  console.log('─'.repeat(60));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let webUrl = urlArg;
  let storeName = webUrl;

  // If --slug provided, look up from DB
  if (slugArg) {
    const { data: merchant } = await supabase
      .from('merchants')
      .select('name, web_url, scraped_data')
      .eq('slug', slugArg)
      .single();

    if (!merchant) { console.error(`Merchant not found: ${slugArg}`); process.exit(1); }
    webUrl    = merchant.web_url;
    storeName = merchant.name;

    if (merchant.scraped_data) {
      console.log(`\n📦 Existing scraped_data in DB for ${storeName}:`);
      console.log(JSON.stringify(merchant.scraped_data, null, 2));
      console.log('\n--- Now re-scraping live ---\n');
    }
  }

  if (!webUrl) {
    console.error('Usage: node debug_scrape.js https://storeurl.com');
    console.error('    or node debug_scrape.js --slug=store-slug');
    process.exit(1);
  }

  const base = webUrl.replace(/\/$/, '');
  console.log(`\n🔍 Scraping: ${base}`);
  console.log('Checking pages...\n');

  const allData = [];

  for (const path of SCRAPE_PATHS) {
    const url  = path === '/' ? base : `${base}${path}`;
    const html = await fetchPage(url);
    if (html) {
      allData.push(extractFromHtml(html, path));
    }
    await new Promise(r => setTimeout(r, 400));
  }

  printReport(allData, storeName, webUrl);
}

main().catch(console.error);

/**
 * STEP 2: Store Scraper
 *
 * For each merchant with a web_url:
 *   - Scrapes homepage + /about + /shipping + /faq pages
 *   - Extracts meaningful signals (tagline, product names, policies, trust signals)
 *   - Scores scrape richness (0-100)
 *   - Assigns tier (A/B/C/D)
 *   - Saves to merchants.scraped_data
 *
 * Run: node 02_scraper.js [--limit 100] [--tier-only] [--from-id 1000]
 */
// import 'dotenv/config';
import { supabase } from "../../dbhelper/dbclient.js";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });

const CONCURRENCY = 3;
const TIMEOUT_MS = 12000;
const BATCH_SIZE = 100;
const DELAY_MS = 800;

const args = process.argv.slice(2);
function getArg(name) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=")[1];
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--"))
    return args[idx + 1];
  return null;
}
const LIMIT = parseInt(getArg("limit") || "0");
const FROM_ID = parseInt(getArg("from-id") || "0");

// Pages to scrape per store
const SCRAPE_PATHS = [
  "/",
  "/about",
  "/about-us",
  "/our-story",
  "/who-we-are",
  "/faq",
  "/faqs",
  "/help",
  "/help-center",
  "/support",
  "/shipping",
  "/shipping-policy",
  "/delivery",
  "/returns",
  "/return-policy",
  "/refund-policy",
  "/sale",
  "/offers",
  "/promotions",
  "/deals",
  "/financing",
  "/payment-plans",
  "/collections", // product category listing
  "/blogs/news",
  "/pages/about",
  "/pages/about-us",
  "/pages/our-story",
  "/pages/who-we-are",
  "/pages/faq",
  "/pages/faqs",
  "/pages/help",
  "/pages/help-center",
  "/pages/support",
  "/pages/shipping",
  "/pages/shipping-policy",
  "/pages/delivery",
  "/pages/returns",
  "/pages/return-policy",
  "/pages/refund-policy",
  "/pages/sale",
  "/pages/offers",
  "/pages/promotions",
  "/pages/deals",
  "/pages/financing",
  "/pages/payment-plans",

];

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SavingHarborBot/1.0; +https://savingharbor.com)",
        Accept: "text/html",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

function extractFaqs($) {
  const faqs = [];

  // Pattern 1: elements with faq/accordion/question class patterns
  $(
    '[class*="faq"], [class*="accordion"], [class*="question"], [itemtype*="FAQPage"]',
  ).each((_, el) => {
    const q = $(el)
      .find('[class*="question"], [itemprop="name"], dt, summary, h3, h4')
      .first()
      .text()
      .trim();
    const a = $(el)
      .find('[class*="answer"], [itemprop="text"], dd, [class*="content"], p')
      .first()
      .text()
      .trim();
    if (q.length > 10 && a.length > 20) faqs.push({ q, a });
  });

  // Pattern 2: definition lists (dt/dd)
  $("dl").each((_, dl) => {
    $(dl)
      .find("dt")
      .each((_, dt) => {
        const q = $(dt).text().trim();
        const a = $(dt).next("dd").text().trim();
        if (q.length > 10 && a.length > 20) faqs.push({ q, a });
      });
  });

  // Pattern 3: h3/h4 followed by p in help/faq sections
  $("main h3, main h4, article h3, article h4").each((_, el) => {
    const q = $(el).text().trim();
    const a = $(el).next("p").text().trim();
    if (q.endsWith("?") && a.length > 20) faqs.push({ q, a });
  });

  // Deduplicate by question text
  const seen = new Set();
  return faqs
    .filter((f) => {
      if (seen.has(f.q)) return false;
      seen.add(f.q);
      return true;
    })
    .slice(0, 10);
}

function extractSalePatterns($, html) {
  const patterns = [];
  const text = $("body").text();

  // Seasonal sale mentions
  const seasonal =
    text.match(
      /(black friday|cyber monday|summer sale|winter sale|spring sale|holiday sale|anniversary sale|flash sale|clearance)[^.]{0,80}/gi,
    ) || [];
  patterns.push(...seasonal.slice(0, 3).map((s) => s.trim()));

  // Discount patterns
  const discounts = text.match(/\d+%\s*off[^.]{0,60}/gi) || [];
  patterns.push(...discounts.slice(0, 3).map((s) => s.trim()));

  return [...new Set(patterns)].slice(0, 5);
}

function extractFromHtml(html, path) {
  const $ = cheerio.load(html);
  $(
    'script, style, nav, footer, noscript, iframe, [aria-hidden="true"]',
  ).remove();

  const data = {
    path,
    metaDescription: $('meta[name="description"]').attr("content") || null,
    ogDescription: $('meta[property="og:description"]').attr("content") || null,
    h1: $("h1").first().text().trim() || null,
    taglines: [],
    productHeadings: [],
    keyParagraphs: [],
    faqs: [],
    salePatterns: [],
    trustSignals: {},
    visiblePromoCodes: [],
    hasFinancing: false,
    hasFreeShipping: false,
    appDiscount: null,
    studentDiscount: null,
    loyaltyProgram: null,
  };

  // Taglines / hero statements
  $(
    'h2, .hero p, [class*="tagline"], [class*="subtitle"], [class*="hero"] p, [class*="banner"] p',
  ).each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 15 && t.length < 250) data.taglines.push(t);
  });
  data.taglines = data.taglines.slice(0, 3);

  // Product/category headings
  $(
    'main h2, main h3, article h2, article h3, .content h2, .content h3, [class*="category"] h2, [class*="product"] h2',
  ).each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 3 && t.length < 80) data.productHeadings.push(t);
  });
  data.productHeadings = [...new Set(data.productHeadings)].slice(0, 12);

  // Key paragraphs
  $(
    'main p, article p, .about p, [class*="description"] p, [class*="content"] p',
  ).each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 60 && t.length < 800) data.keyParagraphs.push(t);
  });
  data.keyParagraphs = data.keyParagraphs.slice(0, 6);

  // FAQs (best extracted from faq/help pages)
  data.faqs = extractFaqs($);

  // Sale patterns
  data.salePatterns = extractSalePatterns($, html);

  // Trust signals
  const text = $("body").text();
  data.trustSignals = {
    yearsInBusiness:
      (text.match(/(since|founded|est\.?)\s*(\d{4})/i) ||
        text.match(/(\d+)\s*years?\s*(of\s*)?(experience|in business)/i) ||
        [])[0]?.trim() || null,
    returnWindow:
      (text.match(/(\d+)[- ]day\s*(free\s*)?return/i) ||
        text.match(/returns?\s*within\s*(\d+)\s*days?/i) ||
        [])[0]?.trim() || null,
    freeShippingThreshold:
      (text.match(
        /free\s*(standard\s*)?shipping\s*(on\s*orders?\s*)?(over|above)?\s*\$[\d,]+/i,
      ) || [])[0]?.trim() || null,
    warranty:
      (text.match(/(\d+)[- ](year|month)\s*warranty/i) ||
        text.match(/lifetime\s*warranty/i) ||
        [])[0]?.trim() || null,
    trustpilot: html.includes("trustpilot.com"),
    bbb: /better business bureau|bbb accredited/i.test(html),
    reviewCount:
      (text.match(/([\d,]+)\s*(verified\s*)?reviews?/i) || [])[1]?.replace(
        ",",
        "",
      ) || null,
    rating:
      (text.match(/(\d+\.?\d*)\s*(?:out of\s*5|\/\s*5|\s*stars?)/i) || [])[1] ||
      null,
  };

  // Special saving opportunities
  data.hasFinancing =
    /financ|pay later|installment|affirm|klarna|afterpay|sezzle/i.test(html);
  data.hasFreeShipping = /free shipping/i.test(html);
  data.appDiscount = /app[^.]{0,30}(discount|off|exclusive|deal)/i.test(html)
    ? "App discount mentioned"
    : null;
  data.studentDiscount = /student[^.]{0,30}(discount|off|program|deal)/i.test(
    html,
  )
    ? "Student discount mentioned"
    : null;
  data.loyaltyProgram =
    /loyalty|reward program|points|member(ship)? reward/i.test(html)
      ? "Loyalty/rewards program mentioned"
      : null;

  // Visible promo codes
  const codeMatches =
    html.match(/(?:code|coupon|promo)[:\s]+([A-Z0-9]{4,20})/gi) || [];
  data.visiblePromoCodes = [
    ...new Set(codeMatches.map((m) => m.split(/[:\s]+/).pop())),
  ].slice(0, 5);

  return data;
}

function scoreRichness(scraped) {
  let score = 0;
  if (scraped.h1) score += 5;
  if (scraped.metaDescription?.length > 50) score += 8;
  if (scraped.taglines?.length > 0) score += 8;
  if (scraped.productHeadings?.length >= 3) score += 12;
  if (scraped.keyParagraphs?.length >= 2) score += 12;
  if (scraped.faqs?.length >= 2) score += 15; // bonus for real FAQs
  if (scraped.salePatterns?.length > 0) score += 5;
  const t = scraped.trustSignals || {};
  if (t.yearsInBusiness) score += 8;
  if (t.warranty) score += 5;
  if (t.returnWindow) score += 5;
  if (t.freeShippingThreshold) score += 5;
  if (t.trustpilot) score += 4;
  if (t.bbb) score += 3;
  if (t.reviewCount) score += 4;
  if (scraped.visiblePromoCodes?.length > 0) score += 5;
  if (scraped.hasFinancing) score += 3;
  if (scraped.appDiscount) score += 2;
  if (scraped.studentDiscount) score += 2;
  if (scraped.loyaltyProgram) score += 2;
  return Math.min(score, 100);
}

function assignTier(score, hasCoupons, hasWebUrl) {
  if (!hasWebUrl) return "D";
  if (!hasCoupons && score < 20) return "D";
  if (score >= 55 && hasCoupons) return "A";
  if (score >= 30) return "B";
  if (score >= 10) return "C";
  return "D";
}

async function scrapeMerchant(merchant) {
  const base = merchant.web_url?.replace(/\/$/, "");
  if (!base) return { score: 0, tier: "D", data: null };

  const combined = {};
  const allFaqs = [];

  for (const path of SCRAPE_PATHS) {
    const url = path === "/" ? base : `${base}${path}`;
    const html = await fetchPage(url);
    if (!html) continue;

    const extracted = extractFromHtml(html, path);

    if (path === "/") {
      Object.assign(combined, extracted);
    } else {
      // Merge non-homepage data additively
      for (const [k, v] of Object.entries(extracted)) {
        if (k === "faqs" && v?.length) {
          allFaqs.push(...v);
        } else if (k === "trustSignals" && combined.trustSignals) {
          for (const [tk, tv] of Object.entries(v)) {
            if (!combined.trustSignals[tk] && tv)
              combined.trustSignals[tk] = tv;
          }
        } else if (k === "salePatterns" && v?.length) {
          combined.salePatterns = [
            ...new Set([...(combined.salePatterns || []), ...v]),
          ].slice(0, 6);
        } else if (k === "keyParagraphs" && v?.length) {
          combined.keyParagraphs = [
            ...(combined.keyParagraphs || []),
            ...v,
          ].slice(0, 8);
        } else if (!combined[k] && v) {
          combined[k] = v;
        }
      }
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // Merge all FAQs found across pages, deduplicated
  if (allFaqs.length) {
    const seen = new Set((combined.faqs || []).map((f) => f.q));
    for (const f of allFaqs) {
      if (!seen.has(f.q)) {
        combined.faqs = combined.faqs || [];
        combined.faqs.push(f);
        seen.add(f.q);
      }
    }
  }
  if (combined.faqs) combined.faqs = combined.faqs.slice(0, 10);

  const score = scoreRichness(combined);
  const tier = assignTier(
    score,
    (merchant.active_coupons_count || 0) > 0,
    !!base,
  );

  return { score, tier, data: combined };
}

async function main() {
  console.log("🔍 Scraper starting...");
  const limiter = pLimit(CONCURRENCY);
  let offset = 0,
    totalProcessed = 0;

  while (true) {
    let q = supabase
      .from("merchants")
      .select("id, name, slug, web_url, active_coupons_count")
      .eq("is_publish", true)
      .in("content_status", ["template", "failed"])
      .order("views", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (FROM_ID) q = q.gte("id", FROM_ID);

    const { data: merchants, error } = await q;
    if (error) {
      console.error("DB error:", error);
      break;
    }
    if (!merchants?.length) {
      console.log("✅ Done.");
      break;
    }

    const remaining = LIMIT ? LIMIT - totalProcessed : merchants.length;
    const batch = merchants.slice(0, remaining);
    console.log(`\n📦 Batch: ${batch.length} stores`);

    await Promise.all(
      batch.map((m) =>
        limiter(async () => {
          console.log(`  ↳ ${m.name} (${m.web_url || "no url"})`);
          await supabase
            .from("merchants")
            .update({
              content_status: "scraping",
              scrape_attempted_at: new Date().toISOString(),
            })
            .eq("id", m.id);
          try {
            const { score, tier, data } = await scrapeMerchant(m);
            await supabase
              .from("merchants")
              .update({
                content_status: tier === "D" ? "noindex" : "scraped",
                content_tier: tier,
                scrape_score: score,
                scraped_data: data,
              })
              .eq("id", m.id);
            console.log(
              `    ✓ Tier ${tier} | score ${score} | faqs: ${data?.faqs?.length || 0}`,
            );
          } catch (err) {
            console.error(`    ✗ ${err.message}`);
            await supabase
              .from("merchants")
              .update({
                content_status: "failed",
                generation_error: err.message,
              })
              .eq("id", m.id);
          }
        }),
      ),
    );

    totalProcessed += batch.length;
    if (LIMIT && totalProcessed >= LIMIT) break;
    if (merchants.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log(`\n🏁 Done. Processed ${totalProcessed} stores.`);
}

main().catch(console.error);

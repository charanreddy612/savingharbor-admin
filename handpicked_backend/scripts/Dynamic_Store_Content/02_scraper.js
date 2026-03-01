/**
 * STEP 2: Scraper
 *
 * For each store:
 *   1. Scrape homepage (always, cheerio)
 *   2. Discover + try subpages (about, faq, shipping, returns) — cheerio first, Playwright fallback
 *   3. Scrape Trustpilot
 *   4. Query Reddit
 *
 * Hard 15s limit per subpage — never blocks pipeline
 * Reads merchants from local CSV — zero DB reads
 * Saves results to scraped_results.json after EACH store (crash-safe)
 * Resume-safe — skips already scraped merchants automatically
 * Bulk upserts to DB only when you're ready via --flush flag
 *
 * Run:         node scripts/Dynamic_Store_Content/02_scraper.js --limit=5
 * Resume:      node scripts/Dynamic_Store_Content/02_scraper.js (auto-skips done stores)
 * Flush to DB: node scripts/Dynamic_Store_Content/02_scraper.js --flush
 */

import pLimit from "p-limit";
import { supabase } from "../../dbhelper/dbclient.js";
import { discoverUrls } from "./url_discoverer.js";
import {
  extractContent,
  extractHomepage,
  hasUsefulContent,
} from "./content_extractor.js";
import { scrapeTrustpilot } from "./trustpilot_scraper.js";
import { scrapeReddit } from "./reddit_scraper.js";
import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";

// ─── Paths ────────────────────────────────────────────────────────────────────
const CSV_PATH = path.resolve(
  "./scripts/Dynamic_Store_Content/merchants_cache.csv",
);
const SCRAPED_PATH = path.resolve(
  "./scripts/Dynamic_Store_Content/scraped_results.json",
);

// ─── Resume support ───────────────────────────────────────────────────────────
let scrapedResults = [];
if (fs.existsSync(SCRAPED_PATH)) {
  try {
    const content = fs.readFileSync(SCRAPED_PATH, "utf8").trim();
    if (content && content !== "[]") {
      scrapedResults = JSON.parse(content);
      console.log(`📋 Resuming — ${scrapedResults.length} already scraped`);
    } else {
      console.log("📋 scraped_results.json empty, starting fresh");
    }
  } catch (err) {
    console.log(
      `⚠️  Invalid scraped_results.json, starting fresh: ${err.message}`,
    );
    scrapedResults = [];
  }
}
const alreadyScraped = new Set(scrapedResults.map((r) => r.id?.toString()));

function saveProgress() {
  fs.writeFileSync(SCRAPED_PATH, JSON.stringify(scrapedResults, null, 2));
}
// ─── Config ───────────────────────────────────────────────────────────────────
const CONCURRENCY = 1;
const PAGE_DELAY = 500;
const SUBPAGE_TIMEOUT = 15000;
const UPSERT_CHUNK = 50;

const args = process.argv.slice(2);
const LIMIT = parseInt(
  args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0",
);
const FROM_ID = parseInt(
  args.find((a) => a.startsWith("--from-id="))?.split("=")[1] || "0",
);
const DRY_RUN = args.includes("--dry-run");
const FLUSH = args.includes("--flush");

// ─── Helpers for data cleanup ─────────────────────────────────────────────────

// ✅ NEW: filter out boilerplate Trustpilot platform text
function cleanTrustpilotSnippets(snippets = []) {
  if (!Array.isArray(snippets)) return [];
  const banned = [
    "fake reviews",
    "platform",
    "guidelines",
    "read more",
    "learn more",
    "our software",
  ];
  return snippets.filter((s) => {
    if (!s || typeof s !== "string") return false;
    const lower = s.toLowerCase();
    return !banned.some((b) => lower.includes(b));
  });
}

// ✅ NEW: filter obviously off-topic Reddit threads
function cleanRedditData(reddit = {}, storeName = "") {
  if (!reddit || typeof reddit !== "object")
    return {
      found: false,
      threads: [],
      commonQuestions: [],
      commonComplaints: [],
      overallSentiment: "neutral",
    };

  const brand = (storeName || "").toLowerCase();
  const usefulKeywords = [
    "coupon",
    "code",
    "discount",
    "promo",
    "review",
    "experience",
    "shipping",
    "quality",
    "refund",
    "scam",
    "legit",
  ];

  const filteredThreads = (reddit.threads || []).filter((t) => {
    if (!t || typeof t !== "object") return false;
    const title = (t.title || "").toLowerCase();
    const snip = (t.snippet || "").toLowerCase();
    const sub = (t.subreddit || "").toLowerCase();

    // hard skip obvious off-topic subs if brand is generic
    const offTopicSubs = [
      "destinythegame",
      "superstonk",
      "politics",
      "gaming",
      "pcgaming",
      "costaricatravel",
    ];
    if (offTopicSubs.includes(sub)) return false;

    const inText = title.includes(brand) || snip.includes(brand);
    const hasKeyword = usefulKeywords.some(
      (k) => title.includes(k) || snip.includes(k),
    );
    // require brand mention OR at least a coupon/review keyword
    return inText || hasKeyword;
  });

  const questions = Array.isArray(reddit.commonQuestions)
    ? reddit.commonQuestions
    : [];
  const complaints = Array.isArray(reddit.commonComplaints)
    ? reddit.commonComplaints
    : [];

  return {
    found: filteredThreads.length > 0 || reddit.found || false,
    threads: filteredThreads.slice(0, 6),
    commonQuestions: questions,
    commonComplaints: complaints,
    overallSentiment: reddit.overallSentiment || "neutral",
  };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scoreRichness(data) {
  let s = 0;
  const w = data.website || {};
  const tp = data.trustpilot || {};
  const rd = data.reddit || {};

  if (w.homepage?.h1) s += 4;
  if (w.homepage?.metaDescription?.length > 50) s += 6;
  if (w.homepage?.heroTaglines?.length) s += 5;
  if (w.homepage?.productHeadings?.length >= 3) s += 8;
  if (w.homepage?.keyParagraphs?.length >= 2) s += 8;
  if (w.homepage?.customerReviews?.length) s += 5;
  if (w.homepage?.trustSignals?.returnWindow) s += 4;
  if (w.homepage?.trustSignals?.freeShippingThreshold) s += 4;
  if (w.homepage?.trustSignals?.warranty) s += 3;
  if (w.homepage?.trustSignals?.reviewCount) s += 3;
  if (w.homepage?.specialOffers?.financing) s += 2;
  if (w.homepage?.specialOffers?.loyaltyProgram) s += 2;
  if (w.homepage?.salePatterns?.length) s += 3;
  if (w.about?.keyParagraphs?.length) s += 8;
  if (w.about?.foundingStory) s += 4;
  if (w.about?.stats?.length) s += 3;
  if (w.faq?.faqs?.length >= 2) s += 10;
  if (w.shipping?.freeShippingThreshold) s += 4;
  if (w.returns?.returnWindow) s += 4;
  if (tp.found) s += 8;
  if (tp.rating) s += 3;
  if (tp.snippets?.length >= 2) s += 5;
  if (rd.found) s += 5;
  if (rd.commonQuestions?.length) s += 3;

  return Math.min(s, 100);
}

function assignTier(score, hasCoupons, hasWebUrl) {
  if (!hasWebUrl) return "D";
  if (score >= 55 && hasCoupons) return "A";
  if (score >= 30) return "B";
  if (score >= 10) return "C";
  return "D";
}

// ─── Safe subpage fetch with hard timeout ────────────────────────────────────
async function tryFetchSubpage(url, category) {
  return Promise.race([
    extractContent(url, category),
    new Promise((resolve) => setTimeout(() => resolve(null), SUBPAGE_TIMEOUT)),
  ]);
}

// ─── Scrape one merchant ──────────────────────────────────────────────────────
async function scrapeMerchant(merchant) {
  const base = merchant.web_url?.replace(/\/$/, "");
  if (!base) return { score: 0, tier: "D", data: null };

  // ✅ NEW: ensure consistent base structure
  const scraped = {
    website: {
      homepage: null,
      about: null,
      faq: null,
      shipping: null,
      returns: null,
    },
    trustpilot: {},
    reddit: {},
  };

  const discovery = await discoverUrls(base);
  if (discovery.homepageHtml) {
    scraped.website.homepage = extractHomepage(discovery.homepageHtml);
  }

  const toScrape = ["about", "faq", "shipping", "returns"];
  for (const category of toScrape) {
    const urls = discovery.classified[category] || [];
    if (!urls.length) continue;
    for (const { url } of urls) {
      const content = await tryFetchSubpage(url, category);
      if (hasUsefulContent(content)) {
        scraped.website[category] = content;
        if (content.usedPlaywright) console.log(`      ↳ Playwright: ${url}`);
        break;
      }
      await new Promise((r) => setTimeout(r, PAGE_DELAY));
    }
  }

  let tp = await scrapeTrustpilot(base);
  tp = {
    ...(tp || {}),
    snippets: cleanTrustpilotSnippets(tp?.snippets),
  };

  await new Promise((r) => setTimeout(r, 500));

  let rd = await scrapeReddit(merchant.name, base);
  rd = cleanRedditData(rd, merchant.name);

  scraped.trustpilot = tp;
  scraped.reddit = rd;

  const score = scoreRichness(scraped);
  const tier = assignTier(
    score,
    (parseInt(merchant.active_coupons_count) || 0) > 0,
    !!base,
  );

  return { score, tier, data: scraped };
}

// ─── Flush scraped_results.json → Supabase ───────────────────────────────────
async function flushToDb() {
  if (!fs.existsSync(SCRAPED_PATH)) {
    console.log("❌ No scraped_results.json found. Run scraper first.");
    return;
  }
  const results = JSON.parse(fs.readFileSync(SCRAPED_PATH));
  const updates = results
    .filter((r) => !r.error)
    .map((r) => ({
      id: parseInt(r.id),
      content_status: r.tier === "D" ? "noindex" : "scraped",
      content_tier: r.tier,
      scrape_score: r.score,
      scraped_data: r.scraped_data,
      scrape_attempted_at: r.scraped_at,
    }));

  console.log(`💾 Flushing ${updates.length} results to DB...`);
  for (let i = 0; i < updates.length; i += UPSERT_CHUNK) {
    const chunk = updates.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from("merchants").upsert(chunk);
    if (error) console.error(`  ✗ Upsert error:`, error.message);
    else
      console.log(
        `  ✓ ${Math.min(i + UPSERT_CHUNK, updates.length)}/${updates.length}`,
      );
  }
  console.log("🏁 Flush complete.");
}

async function main() {
  if (FLUSH) return flushToDb();

  console.log(
    `🔍 Scraper | Concurrency: ${CONCURRENCY} | Limit: ${LIMIT || "all"} | DryRun: ${DRY_RUN}\n`,
  );

  const limiter = pLimit(CONCURRENCY);

  // ─── SINGLE CSV LOADING ─────────────────────────────────────────────────────
  console.log("📁 Looking for CSV at:", CSV_PATH);

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`❌ CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const raw = parse(fs.readFileSync(CSV_PATH, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log("🔍 RAW CSV rows:", raw.length);

  const ALL_MERCHANTS = raw.filter((m) => {
    const isPublish = (m.is_publish || "").toString().trim().toLowerCase();
    const status = (m.content_status || "").toString().trim().toLowerCase();
    return (
      isPublish === "true" && ["template", "failed", "noindex"].includes(status)
    );
  });

  console.log(`📋 Filtered merchants: ${ALL_MERCHANTS.length}`);

  // ─── Filter merchants to scrape ──────────────────────────────────────────────
  let merchants = ALL_MERCHANTS.filter(
    (m) => !alreadyScraped.has(m.id?.toString()),
  );
  if (FROM_ID) merchants = merchants.filter((m) => parseInt(m.id) >= FROM_ID);
  if (LIMIT) merchants = merchants.slice(0, LIMIT);

  console.log(
    `📦 To scrape: ${merchants.length} stores (${alreadyScraped.size} already done)\n`,
  );

  if (!merchants.length) {
    console.log(
      "✅ Nothing to scrape. Use --force or delete scraped_results.json",
    );
    return;
  }

  // ─── Scrape loop ─────────────────────────────────────────────────────────────
  await Promise.all(
    merchants.map((m) =>
      limiter(async () => {
        console.log(`  ↳ ${m.name} (${m.web_url})`);

        try {
          const { score, tier, data } = await scrapeMerchant(m);

          const tpStr = data?.trustpilot?.found
            ? `⭐${data.trustpilot.rating}(${data.trustpilot.reviewCount})`
            : "no-tp";
          const rdStr = data?.reddit?.found
            ? `💬${data.reddit.threads.length}`
            : "no-reddit";
          const faqStr = data?.website?.faq?.faqs?.length
            ? `FAQs:${data.website.faq.faqs.length}`
            : "no-faq";
          console.log(
            `    ✓ Tier:${tier} Score:${score} | ${faqStr} | ${tpStr} | ${rdStr}`,
          );

          if (!DRY_RUN) {
            scrapedResults.push({
              id: m.id,
              name: m.name,
              slug: m.slug,
              web_url: m.web_url,
              active_coupons_count: m.active_coupons_count,
              category_names: m.category_names,
              tier,
              score,
              scraped_data: data,
              scraped_at: new Date().toISOString(),
            });
            saveProgress();
          }
        } catch (err) {
          console.error(`    ✗ ${err.message}`);
          if (!DRY_RUN) {
            scrapedResults.push({
              id: m.id,
              name: m.name,
              tier: "D",
              score: 0,
              error: err.message.substring(0, 500),
              scraped_at: new Date().toISOString(),
            });
            saveProgress();
          }
        }
      }),
    ),
  );

  console.log(`\n🏁 Done. Scraped: ${merchants.length} stores.`);
  console.log(`💾 Results saved to: ${SCRAPED_PATH}`);
  console.log(`💡 When ready to push to DB: node 02_scraper.js --flush`);
}

main().catch(console.error);

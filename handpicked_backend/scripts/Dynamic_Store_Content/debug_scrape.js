/**
 * Scrape Debugger v2
 * Tests the full data collection pipeline on a single store
 *
 * Run: node scripts/Dynamic_Store_Content/debug_scrape.js https://feelingirl.com
 *   or node scripts/Dynamic_Store_Content/debug_scrape.js --slug=feelingirl
 */

import { supabase } from "../../dbhelper/dbclient.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { discoverUrls, printDiscovery } from "./url_discoverer.js";
import {
  extractContentWithFallback,
  extractHomepage,
  hasUsefulContent,
} from "./content_extractor.js";
import { scrapeTrustpilot } from "./trustpilot_scraper.js";
import { scrapeReddit } from "./reddit_scraper.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env") });


const args = process.argv.slice(2);
const slugArg = args.find((a) => a.startsWith("--slug="))?.split("=")[1];
const urlArg = args.find((a) => !a.startsWith("--"));
const DUMP_HTML = args.includes('--dump');

function section(title) {
  console.log(`\n${"═".repeat(55)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(55));
}

function sub(title) {
  console.log(`\n  ── ${title} ──`);
}

async function main() {
  let webUrl, storeName;

  if (slugArg) {
    const { data: m } = await supabase
      .from("merchants")
      .select("name, web_url")
      .eq("slug", slugArg)
      .single();
    if (!m) {
      console.error(`Not found: ${slugArg}`);
      process.exit(1);
    }
    webUrl = m.web_url;
    storeName = m.name;
  } else if (urlArg) {
    webUrl = urlArg;
    storeName = new URL(urlArg).hostname.replace(/^www\./, "");
  } else {
    console.error("Usage: node debug_scrape.js https://store.com");
    console.error("    or node debug_scrape.js --slug=store-slug");
    process.exit(1);
  }

  const base = webUrl.replace(/\/$/, "");
  console.log(`\n🔍 Debug Scrape: ${storeName}`);
  console.log(`   URL: ${base}\n`);

  // ── Layer 1: URL Discovery ─────────────────────────────────────────────────
  section("LAYER 1: URL DISCOVERY");
  console.log("Scanning homepage nav + footer for links...\n");
  const discovery = await discoverUrls(base);
  printDiscovery(discovery, storeName);

  // ── Homepage extraction ────────────────────────────────────────────────────
  section("HOMEPAGE CONTENT");
  if (discovery.homepageHtml) {
    const hp = extractHomepage(discovery.homepageHtml);
    if (hp.h1) console.log(`  H1:           "${hp.h1}"`);
    if (hp.metaDescription)
      console.log(`  Meta:         "${hp.metaDescription}"`);
    if (hp.heroTaglines?.length) {
      console.log(`  Taglines:`);
      hp.heroTaglines.forEach((t) => console.log(`    • "${t}"`));
    }
    if (hp.productHeadings?.length) {
      console.log(`  Product headings (${hp.productHeadings.length}):`);
      hp.productHeadings.forEach((h) => console.log(`    • ${h}`));
    }
    if (hp.keyParagraphs?.length) {
      console.log(`  Key paragraphs (${hp.keyParagraphs.length}):`);
      hp.keyParagraphs.forEach((p, i) =>
        console.log(`    [${i + 1}] ${p.substring(0, 150)}...`),
      );
    }
    if (hp.customerReviews?.length) {
      console.log(
        `  Customer reviews on homepage (${hp.customerReviews.length}):`,
      );
      hp.customerReviews.forEach((r) =>
        console.log(`    "${r.substring(0, 120)}..."`),
      );
    }
    const t = hp.trustSignals || {};
    console.log(`  Trust signals:`);
    Object.entries(t)
      .filter(([, v]) => v && v !== false)
      .forEach(([k, v]) => console.log(`    ${k}: ${v}`));
    const s = hp.specialOffers || {};
    const specials = Object.entries(s)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (specials.length)
      console.log(`  Special offers: ${specials.join(", ")}`);
    if (hp.visibleCodes?.length)
      console.log(`  Visible codes: ${hp.visibleCodes.join(", ")}`);
    if (hp.salePatterns?.length)
      console.log(`  Sale patterns: ${hp.salePatterns.join(" | ")}`);
  }

  // ── Classified pages ───────────────────────────────────────────────────────
  const toScrape = ["about", "faq", "shipping", "returns", "sale", "blog"];
  for (const cat of toScrape) {
    const urls = discovery.classified[cat] || [];
    if (!urls.length) {
      console.log(`\n  [${cat.toUpperCase()}] — no URL found in nav`);
      continue;
    }

    let content = null;
    for (const { url } of urls) {
      section(`${cat.toUpperCase()}: ${url}`);
      content = await extractContentWithFallback(url, cat);
      if (content?.renderedWithPlaywright)
        console.log("  (rendered with Playwright)");
      if (hasUsefulContent(content)) break;
      console.log("  → empty, trying next URL...");
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!content) {
      console.log("  No content extracted from any URL");
      continue;
    }

    if (cat === "faq") {
      if (content.faqs?.length) {
        console.log(`  FAQs found: ${content.faqs.length}`);
        content.faqs.forEach((f) => {
          console.log(`\n  Q: ${f.question}`);
          console.log(`  A: ${f.answer?.substring(0, 200)}...`);
          console.log(`  (source: ${f.source})`);
        });
      } else {
        console.log("  No FAQs extracted — page may be JS-rendered");
      }
    } else if (cat === "about") {
      if (content.foundingStory)
        console.log(`  Founding: ${content.foundingStory}`);
      if (content.mission) console.log(`  Mission:  ${content.mission}`);
      if (content.stats?.length)
        console.log(`  Stats:    ${content.stats.join(" | ")}`);
      if (content.keyParagraphs?.length) {
        console.log(`  Paragraphs (${content.keyParagraphs.length}):`);
        content.keyParagraphs.forEach((p, i) =>
          console.log(`    [${i + 1}] ${p.substring(0, 150)}...`),
        );
      }
    } else if (cat === "shipping") {
      if (content.freeShippingThreshold)
        console.log(`  Free shipping: ${content.freeShippingThreshold}`);
      if (content.deliveryTimes?.length)
        console.log(`  Delivery: ${content.deliveryTimes.join(", ")}`);
      console.log(`  International: ${content.internationalShipping}`);
      console.log(`  Express: ${content.expressAvailable}`);
    } else if (cat === "returns") {
      if (content.returnWindow)
        console.log(`  Return window: ${content.returnWindow}`);
      console.log(`  Free returns: ${content.freeReturns}`);
      if (content.conditions?.length)
        console.log(`  Conditions: ${content.conditions.join(", ")}`);
    } else if (cat === "sale") {
      if (content.discountMentions?.length)
        console.log(`  Discounts: ${content.discountMentions.join(" | ")}`);
      if (content.saleMentions?.length)
        console.log(`  Sale types: ${content.saleMentions.join(" | ")}`);
      if (content.visibleCodes?.length)
        console.log(`  Codes: ${content.visibleCodes.join(", ")}`);
    } else if (cat === "blog") {
      if (content.topics?.length) {
        console.log(`  Blog topics (${content.topics.length}):`);
        content.topics.forEach((t) => console.log(`    • ${t}`));
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  // ── Layer 2: Trustpilot ────────────────────────────────────────────────────
  section("LAYER 2: TRUSTPILOT");
  console.log(
    `  Checking trustpilot.com/review/${new URL(base).hostname.replace(/^www\./, "")}...`,
  );
  const tp = await scrapeTrustpilot(base);
  if (tp.found) {
    console.log(`  ✓ Found`);
    if (tp.rating) console.log(`  Rating:   ${tp.rating}/5`);
    if (tp.reviewCount)
      console.log(`  Reviews:  ${tp.reviewCount.toLocaleString()}`);
    if (tp.category) console.log(`  Category: ${tp.category}`);
    console.log(`  Claimed:  ${tp.claimed}`);
    if (tp.snippets?.length) {
      console.log(`  Review snippets (${tp.snippets.length}):`);
      tp.snippets.forEach((s, i) =>
        console.log(`    [${i + 1}] "${s.substring(0, 150)}..."`),
      );
    }
    if (tp.commonPraise?.length)
      console.log(`  Common praise:     ${tp.commonPraise.join(", ")}`);
    if (tp.commonComplaints?.length)
      console.log(`  Common complaints: ${tp.commonComplaints.join(", ")}`);
  } else {
    console.log("  ✗ Not found on Trustpilot");
  }

  // ── Layer 3: Reddit ────────────────────────────────────────────────────────
  section("LAYER 3: REDDIT");
  console.log(`  Searching Reddit for "${storeName}"...`);
  const rd = await scrapeReddit(storeName, base);
  if (rd.found) {
    console.log(`  ✓ Found ${rd.threads.length} relevant threads`);
    console.log(`  Overall sentiment: ${rd.overallSentiment}`);
    if (rd.commonQuestions?.length) {
      console.log(`  Common questions:`);
      rd.commonQuestions.forEach((q) => console.log(`    • ${q}`));
    }
    if (rd.commonComplaints?.length) {
      console.log(`  Common complaints:`);
      rd.commonComplaints.forEach((c) => console.log(`    • ${c}`));
    }
    console.log(`  Top threads:`);
    rd.threads
      .slice(0, 4)
      .forEach((t) =>
        console.log(`    [${t.sentiment}] ${t.title} (r/${t.subreddit})`),
      );
  } else {
    console.log("  ✗ No Reddit discussions found");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  section("DATA RICHNESS SUMMARY");
  const faqCount = discovery.classified.faq?.length ? "✓" : "✗";
  const aboutCount = discovery.classified.about?.length ? "✓" : "✗";
  const shipCount = discovery.classified.shipping?.length ? "✓" : "✗";
  const retCount = discovery.classified.returns?.length ? "✓" : "✗";

  console.log(`  Nav links discovered: ${discovery.all.length}`);
  console.log(`  About page found:     ${aboutCount}`);
  console.log(`  FAQ page found:       ${faqCount}`);
  console.log(`  Shipping page found:  ${shipCount}`);
  console.log(`  Returns page found:   ${retCount}`);
  console.log(
    `  Trustpilot:           ${tp.found ? `✓ ${tp.rating}★ (${tp.reviewCount} reviews)` : "✗"}`,
  );
  console.log(
    `  Reddit:               ${rd.found ? `✓ ${rd.threads.length} threads` : "✗"}`,
  );
  console.log("");
}

main().catch(console.error);

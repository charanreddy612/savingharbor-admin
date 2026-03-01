/**
 * STEP 3: Content Generator (Local Mode)
 *
 * Reads from local scraped_results.json
 * Filters by tier (default: A)
 * Generates SEO content via Groq
 * Auto-fixes meta_description length if LLM gets it wrong
 * Saves to generated_content.json after each store (crash-safe + resumable)
 *
 * Run:          node scripts/Dynamic_Store_Content/03_generator.js --tier=A
 * Test:         node scripts/Dynamic_Store_Content/03_generator.js --tier=A --limit=3 --dry-run
 * Retry failed: node scripts/Dynamic_Store_Content/03_generator.js --tier=A --retry-failed
 */

import Groq from "groq-sdk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const CONCURRENCY = 1;
const DELAY_MS = 5000;
const MAX_RETRIES = 3;
const MODEL = "llama-3.3-70b-versatile";

const DESCRIPTION_TEMPLATES = {
  "Health & Fitness": "problem_solution",
  "Health & Wellness": "problem_solution",
  Pets: "problem_solution",
  "Sports & Outdoors": "problem_solution",

  "Computers & Electronics": "specs_buyer_guide",
  Electronics: "specs_buyer_guide",
  Technology: "specs_buyer_guide",

  Finance: "risk_benefit",
  Investing: "risk_benefit",

  Software: "usecase_results",
  "Software & Tools": "usecase_results",
  "Marketing & SaaS": "usecase_results",

  default: "standard",
};

function pickTemplate(ctx) {
  const cats = (ctx.categories || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  for (const c of cats) {
    if (DESCRIPTION_TEMPLATES[c]) return DESCRIPTION_TEMPLATES[c];
  }
  return DESCRIPTION_TEMPLATES.default;
}

const SCRAPED_PATH = path.resolve(
  "./scripts/Dynamic_Store_Content/scraped_results.json",
);
const GENERATED_PATH = path.resolve(
  "./scripts/Dynamic_Store_Content/generated_content.json",
);

const args = process.argv.slice(2);
const LIMIT = parseInt(
  args.find((a) => a.startsWith("--limit="))?.split("=")[1] || "0",
);
const TIER = args.find((a) => a.startsWith("--tier="))?.split("=")[1] || "A";
const DRY_RUN = args.includes("--dry-run");
const RETRY_FAILED = args.includes("--retry-failed");

// ─── Load files ───────────────────────────────────────────────────────────────

if (!fs.existsSync(SCRAPED_PATH)) {
  console.error(`❌ scraped_results.json not found`);
  process.exit(1);
}

const ALL_SCRAPED = JSON.parse(fs.readFileSync(SCRAPED_PATH));
console.log(`📋 Loaded ${ALL_SCRAPED.length} scraped merchants`);

let existingGenerated = [];
if (fs.existsSync(GENERATED_PATH)) {
  existingGenerated = JSON.parse(fs.readFileSync(GENERATED_PATH));
  console.log(`📋 Resuming — ${existingGenerated.length} already attempted\n`);
}

const skipIds = new Set(
  existingGenerated
    .filter((r) => (RETRY_FAILED ? !r.error : true))
    .map((r) => r.id?.toString()),
);

function saveProgress(results) {
  fs.writeFileSync(GENERATED_PATH, JSON.stringify(results, null, 2));
}

// ─── Sanitize scraped text to remove control characters ──────────────────────

function sanitize(str) {
  if (typeof str !== "string") return str;
  return str
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // strip non-printable control chars
    .replace(/\t/g, " ") // tabs → space
    .replace(/\r\n?/g, " ") // carriage returns → space
    .replace(/\n/g, " ") // newlines → space
    .replace(/\s{2,}/g, " ") // collapse multiple spaces
    .trim();
}

// ─── Build context ────────────────────────────────────────────────────────────

function buildContext(merchant, scraped) {
  const w = scraped?.website || {};
  const tp = scraped?.trustpilot || {};
  const rd = scraped?.reddit || {};
  const hp = w.homepage || {};

  return {
    name: merchant.name,
    url: merchant.web_url || "",
    categories: Array.isArray(merchant.category_names)
      ? merchant.category_names.join(", ")
      : merchant.category_names || "",
    activeCoupons: parseInt(merchant.active_coupons_count) || 0,
    metaDescription: sanitize(hp.metaDescription || hp.ogDescription || ""),
    heroTaglines: (hp.heroTaglines || []).map(sanitize),
    productHeadings: (hp.productHeadings || []).map(sanitize),
    keyParagraphs: (hp.keyParagraphs || []).map(sanitize),
    customerReviews: (hp.customerReviews || []).map(sanitize),
    trustSignals: hp.trustSignals || {},
    specialOffers: hp.specialOffers || {},
    visibleCodes: (hp.visibleCodes || []).map(sanitize),
    salePatterns: (hp.salePatterns || []).map(sanitize),
    aboutParagraphs: (w.about?.keyParagraphs || []).map(sanitize),
    aboutMission: sanitize(w.about?.mission || ""),
    foundingStory: sanitize(w.about?.foundingStory || ""),
    aboutStats: (w.about?.stats || []).map(sanitize),
    faqs: (w.faq?.faqs || []).map((f) => ({
      question: sanitize(f.question),
      answer: sanitize(f.answer),
    })),
    shippingThreshold:
      sanitize(
        w.shipping?.freeShippingThreshold ||
          hp.trustSignals?.freeShippingThreshold ||
          "",
      ) || null,
    deliveryTimes: (w.shipping?.deliveryTimes || []).map(sanitize),
    internationalShipping: w.shipping?.internationalShipping || false,
    expressAvailable: w.shipping?.expressAvailable || false,
    returnWindow:
      sanitize(
        w.returns?.returnWindow || hp.trustSignals?.returnWindow || "",
      ) || null,
    freeReturns: w.returns?.freeReturns || false,
    returnConditions: (w.returns?.conditions || []).map(sanitize),
    tpFound: tp.found || false,
    tpRating: tp.rating || null,
    tpReviewCount: tp.reviewCount || null,
    tpSnippets: (tp.snippets || []).map(sanitize),
    tpPraise: (tp.commonPraise || []).map(sanitize),
    tpComplaints: (tp.commonComplaints || []).map(sanitize),
    rdFound: rd.found || false,
    rdSentiment: rd.overallSentiment || "neutral",
    rdQuestions: (rd.commonQuestions || []).map(sanitize),
    rdComplaints: (rd.commonComplaints || []).map(sanitize),
    rdThreads: (rd.threads?.slice(0, 4) || []).map((t) => ({
      ...t,
      title: sanitize(t.title),
      snippet: sanitize(t.snippet),
    })),
  };
}

// ─── Build prompt ─────────────────────────────────────────────────────────────

function buildPrompt(ctx) {
  const store = ctx.name;
  const template = pickTemplate(ctx);
  const data = `
Name: ${store}
URL: ${ctx.url}
Categories: ${ctx.categories}
Active coupons on Saving Harbor: ${ctx.activeCoupons}

HOMEPAGE:
- Meta description: ${ctx.metaDescription || "not found"}
- Hero taglines: ${ctx.heroTaglines.join(" | ") || "none"}
- Product headings: ${ctx.productHeadings.slice(0, 8).join(", ") || "none"}
- Key paragraphs: ${ctx.keyParagraphs.slice(0, 4).join(" /// ") || "none"}
- Customer reviews: ${ctx.customerReviews.slice(0, 3).join(" /// ") || "none"}
- Free shipping threshold: ${ctx.shippingThreshold || "unknown"}
- Return window: ${ctx.returnWindow || "unknown"}
- Free returns: ${ctx.freeReturns ? "yes" : "unknown"}
- Warranty: ${ctx.trustSignals.warranty || "none"}
- On‑site review count: ${ctx.trustSignals.reviewCount || "unknown"}
- Sale patterns: ${ctx.salePatterns.join(", ") || "none"}
- Special offers: ${
    Object.entries(ctx.specialOffers)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(", ") || "none"
  }
- Visible promo codes on site: ${ctx.visibleCodes.join(", ") || "none"}
- Delivery times: ${ctx.deliveryTimes.join(", ") || "unknown"}
- International shipping: ${ctx.internationalShipping ? "yes" : "unknown"}
- Express shipping: ${ctx.expressAvailable ? "yes" : "unknown"}

ABOUT PAGE:
${ctx.aboutParagraphs.length ? ctx.aboutParagraphs.slice(0, 3).join(" /// ") : "not available"}
${ctx.foundingStory ? "Founding: " + ctx.foundingStory : ""}
${ctx.aboutMission ? "Mission: " + ctx.aboutMission : ""}
${ctx.aboutStats.length ? "Stats: " + ctx.aboutStats.join(", ") : ""}

STORE FAQS:
${
  ctx.faqs.length
    ? ctx.faqs
        .slice(0, 6)
        .map((f) => `Q: ${f.question} A: ${f.answer}`)
        .join(" ||| ")
    : "not available"
}

TRUSTPILOT:
${ctx.tpFound ? `${ctx.tpRating}★ from ${ctx.tpReviewCount} reviews` : "not found"}
${ctx.tpSnippets.length ? "Review snippets: " + ctx.tpSnippets.slice(0, 4).join(" /// ") : ""}
${ctx.tpPraise.length ? "What customers praise: " + ctx.tpPraise.join(", ") : ""}
${ctx.tpComplaints.length ? "Common complaints: " + ctx.tpComplaints.join(", ") : ""}

REDDIT:
${ctx.rdFound ? `${ctx.rdThreads.length} threads, sentiment: ${ctx.rdSentiment}` : "not found"}
${ctx.rdQuestions.length ? "People ask: " + ctx.rdQuestions.join(" | ") : ""}
${ctx.rdComplaints.length ? "Complaints: " + ctx.rdComplaints.join(" | ") : ""}
`.trim();

  return `You are an experienced SEO content strategist writing store pages for Saving Harbor, a coupon and deals website.

Your job: turn the STORE DATA into one highly detailed, honest, conversion‑oriented store page. You MUST stay faithful to the data and clearly admit when information is missing. Do NOT invent numbers, ratings, shipping thresholds, guarantees, or awards.

Return ONLY a valid JSON object. No markdown. No code fences. No explanation text before { or after }.

════════════════════════════════════
GENERAL CONTENT RULES
════════════════════════════════════
- Write in clear, plain English.
- Use second person ("you", "your") in the main description.
- Always prefer specific facts from STORE DATA over generic marketing phrases.
- If a detail (like shipping threshold, return window, rating, review count) is "unknown", say that it is not clearly stated instead of guessing.
- Never claim the store is #1, "best", or "industry‑leading" unless the STORE DATA literally says that.
- If Trustpilot rating is low or reviews mention problems, acknowledge this honestly and neutrally.

════════════════════════════════════
meta_title — CLICKABLE, PRECISE
════════════════════════════════════
- Format: "${store} Coupons & Promo Codes [Month Year] | Saving Harbor"
- Primary keyword first: "${store} Coupons"
- 55–65 characters total.
- Add a light CTR hook if space allows, like "Verified" or "Working Codes".
- Do NOT add emojis.

════════════════════════════════════
meta_description — FACTUAL AD COPY
════════════════════════════════════
- Treat this like a Google Ads line.
- 150–158 characters AFTER your own counting.
- Start with an action verb + concrete benefit (discount %, coupon count, or review count from data).
- Include at least one number that exists in STORE DATA (active coupon count, rating, review count, discount %, shipping threshold). If no reliable number exists, use the active coupon count.
- End with a simple CTA like "Find verified codes at Saving Harbor.".
- Do not repeat the store name more than twice.

════════════════════════════════════
meta_keywords — LONG‑TAIL INTENT
════════════════════════════════════
- 8–12 comma‑separated terms.
- Include combinations of:
  - "${store} coupons", "${store} promo codes", "${store} discount codes"
  - "${store} coupon code today", "${store} free shipping code"
  - Category‑specific phrases based on what they sell in STORE DATA.
- All lowercase is fine; no need to add months/years here.

════════════════════════════════════
side_description_html — SNAPSHOT VALUE PROP
════════════════════════════════════
- 50–80 words in HTML (<p>…</p>).
- First sentence: clearest reason a user should care (unique product angle, policy, or social proof).
- Must include at least ONE specific fact from STORE DATA:
  - A Trustpilot rating and review count, OR
  - Active coupon count, OR
  - A strong policy (e.g., 30‑day returns) if present.
- Tone: helpful friend, not hypey.

════════════════════════════════════
table_content_html — EXPERT SUMMARY
════════════════════════════════════
- 100–150 words in HTML.
- Explain what this store sells, who it is for, and what makes it different.
- Use at least TWO specific facts:
  - Product lines or collections, price hints, subscriber perks, size ranges, stats, or mission/founding info.
- No bullet‑point duplication from description_html; this is a compact editorial overview.

════════════════════════════════════
DESCRIPTION STYLE TEMPLATE
════════════════════════════════════
- Template selected for this store: "${template}".

IF template = "problem_solution"
- Open the description by clearly stating the shopper's problem or pain point in this niche (fitness, health, pets, etc.), then show how ${store} solves it with specific products or features.
- Use reviews / Trustpilot / Reddit to prove it works, then transition into how coupons from Saving Harbor help reduce the cost.

IF template = "specs_buyer_guide"
- Open by explaining who actually needs this kind of hardware or tech (e.g., active traders, power users), then walk through key specs and buying criteria using STORE DATA.
- Help readers choose between options logically, then show where Saving Harbor coupons fit in.

IF template = "risk_benefit"
- Open with the main risks, costs, or fears users have in this category (fees, bad performance, scams).
- Explain how ${store} addresses or does NOT address those concerns, using any policy, review, or FAQ evidence you have, and then introduce coupons as a way to test the service with lower cost.

IF template = "usecase_results"
- Open with 2–3 concrete use cases (e.g., marketers wanting more leads, store owners wanting automation).
- Show what results users expect from ${store}, backed by features or reviews, then explain how Saving Harbor coupons let them try premium plans cheaper.

IF template = "standard"
- Use the normal section order, but still open with the single strongest angle from STORE DATA (rating, review count, unique product, or policy).

════════════════════════════════════
description_html — PRIMARY SEO CONTENT
════════════════════════════════════
- **MUST be 700+ visible words total.** Count after stripping HTML tags. Expand shortest sections if under.
- Use these H3 sections in this ORDER and respect the MINIMUM word counts:

<h3>What is ${store}?</h3>
- MIN 90 words.
- Use about‑page info, mission, founding story, and any stats.
- Explain what kind of shopper this store is for.

<h3>What Does ${store} Sell?</h3>
- MIN 100 words.
- Use product headings, key paragraphs, and any category clues.
- Mention concrete product categories and notable lines.

<h3>How to Save at ${store} with Saving Harbor</h3>
- MIN 110 words.
- Explain step by step how to use ${store} coupons and promo codes on Saving Harbor.
- Mention the active coupon count from STORE DATA.
- Include phrases like "${store} coupon codes", "verified ${store} promo codes" naturally (2–3 times total across the whole article, not spammy).

<h3>Do ${store} Coupon Codes Actually Work?</h3>
- MIN 90 words.
- Address skepticism directly.
- Use Trustpilot rating + review count IF present, or Reddit sentiment, as evidence.
- Quote 1–2 short Trustpilot snippets inside <blockquote> tags if available.
- If reviews are mixed or negative, say so neutrally.

<h3>Best Time to Save at ${store}</h3>
- MIN 90 words.
- Use any sale patterns, seasonal hints, loyalty/subscription info.
- If STORE DATA has no seasonal info, mention common sale events (e.g., Black Friday, end‑of‑season) as general expectations without claiming this store definitely runs them.

<h3>${store} Shipping & Returns</h3>
- MIN 90 words.
- If shipping threshold or return window exists in STORE DATA, describe them clearly.
- If details are missing, say what is clear and recommend checking the checkout or returns page.
- Do NOT invent exact thresholds, time windows, or guarantees.

Additional rules for description_html:
- Use the store name 3–6 times naturally, not stacked together.
- Every section must contain at least two specific facts or examples directly traceable to STORE DATA.
- Avoid buzzword‑only sentences like "They offer innovative solutions for modern shoppers." Replace with concrete details.

════════════════════════════════════
faqs — GROUNDED, SEARCH‑LIKE QUESTIONS
════════════════════════════════════
- Exactly 6 FAQ objects.
- Mix sources:
  - 2 based on the store's own FAQ data if available.
  - 2 based on Trustpilot complaints/questions or Reddit "People ask" questions if relevant.
  - 2 coupon‑focused questions ("Do ${store} coupon codes actually work?", "What is the best ${store} discount available right now?").
- Questions should sound like real searches: "How do I use a ${store} promo code at checkout?".
- Answers: 2–3 sentences, first sentence gives a direct answer, then 1–2 sentences of detail.
- Never promise things we do not know (like lifetime warranty) and never invent discount percentages.

════════════════════════════════════
trust_text — E‑E‑A‑T SNAPSHOT
════════════════════════════════════
- 1–2 sentences.
- Use only solid signals:
  - Trustpilot rating and review count (if present),
  - Any clear return window or money‑back guarantee,
  - Active coupon count from Saving Harbor.
- If no strong third‑party rating exists, you may reference that the page is based on information from the official site FAQ and policy pages.

════════════════════════════════════
GLOBAL ANTI‑HALLUCINATION RULES
════════════════════════════════════
- You MUST treat the STORE DATA block below as the only factual source.
- If the data does not mention a rating, review count, shipping threshold, or return window, do NOT make up a number. Say that it is not clearly stated.
- Do not claim awards, certifications, "top‑rated", "number one", or "best" unless explicitly stated in STORE DATA.
- Do not copy long passages from the STORE DATA verbatim; summarize or quote only the important parts.

════════════════════════════════════
STORE DATA (READ CAREFULLY, THEN WRITE)
════════════════════════════════════
${data}

════════════════════════════════════
JSON OUTPUT SHAPE
════════════════════════════════════
{
  "meta_title": "string",
  "meta_description": "string (150–158 characters)",
  "meta_keywords": "string (comma‑separated)",
  "side_description_html": "string (HTML)",
  "table_content_html": "string (HTML)",
  "description_html": "string (HTML, 650–800 visible words)",
  "faqs": [
    { "question": "string", "answer": "string" }
  ],
  "trust_text": "string"
}`;
}

// ─── Auto-fix meta_description ────────────────────────────────────────────────

function fixMetaDescription(meta, ctx) {
  if (!meta) return meta;
  meta = meta.trim();

  if (meta.length >= 150 && meta.length <= 158) return meta;

  // Too long — trim at last word boundary before 158
  if (meta.length > 158) {
    let trimmed = meta.slice(0, 158);
    const lastSpace = trimmed.lastIndexOf(" ");
    if (lastSpace > 140) trimmed = trimmed.slice(0, lastSpace);
    return trimmed.replace(/[,\s]+$/, "") + ".";
  }

  // Too short — pad with coupon count + CTA
  if (meta.length < 150) {
    if (meta.endsWith(".")) meta = meta.slice(0, -1);

    const pads = [
      ` Find ${ctx.activeCoupons} active offers at Saving Harbor.`,
      ` Shop with ${ctx.activeCoupons} verified coupons at Saving Harbor.`,
      ` Save more with ${ctx.activeCoupons} deals on Saving Harbor today.`,
      ` Verified coupons updated daily on Saving Harbor.`,
      ` Browse all verified deals on Saving Harbor and save today.`,
    ];

    for (const pad of pads) {
      const candidate = meta + pad;
      if (candidate.length >= 150 && candidate.length <= 158) return candidate;
    }

    // Fallback: force fit
    return (meta + pads[0]).slice(0, 158);
  }

  return meta;
}

// ─── Parse Groq response ──────────────────────────────────────────────────────

function sanitizeJsonStringValues(jsonStr) {
  // Replace control characters only inside JSON string values (between quotes)
  // Handles escaped quotes correctly via a state machine
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    const code = jsonStr.charCodeAt(i);

    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      result += ch;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      result += ch;
      continue;
    }

    if (inString) {
      // Inside a string: replace bare control chars with a space
      if (
        (code >= 0x00 && code <= 0x08) ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      ) {
        result += " ";
        continue;
      }
      // Replace bare (unescaped) newlines/tabs with their JSON escape equivalents
      if (ch === "\n") {
        result += "\\n";
        continue;
      }
      if (ch === "\r") {
        result += "\\r";
        continue;
      }
      if (ch === "\t") {
        result += "\\t";
        continue;
      }
    }

    result += ch;
  }

  return result;
}

function parseGroqResponse(raw) {
  // 1. Strip markdown fences
  let clean = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  // 2. Find the outermost { ... } by tracking brace depth
  const start = clean.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in response");
  let depth = 0;
  let end = -1;
  for (let i = start; i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Unterminated JSON object in response");
  clean = clean.slice(start, end + 1);

  // 3. Sanitize control characters inside string values
  clean = sanitizeJsonStringValues(clean);

  return JSON.parse(clean);
}

// ─── Call Groq with retry ─────────────────────────────────────────────────────

async function generateContent(ctx, attempt = 1) {
  try {
    const response = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0.6,
      max_tokens: 6000,
      messages: [
        {
          role: "system",
          content:
            "You are an expert SEO content strategist for coupon websites. You write content that ranks on Google AND gets clicked. Return ONLY valid JSON — no markdown, no code fences, no text before { or after }.",
        },
        { role: "user", content: buildPrompt(ctx) },
      ],
    });

    const raw = response.choices[0]?.message?.content?.trim();
    if (!raw) throw new Error("Empty response from Groq");

    const parsed = parseGroqResponse(raw);
    parsed.meta_description = fixMetaDescription(parsed.meta_description, ctx);

    // NEW: Enforce minimum description length
    const descText = (parsed.description_html || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const wordCount = descText.split(/\s+/).filter(Boolean).length;

    if (wordCount < 550) {
      console.log(
        `   🔄 Description too short (${wordCount}w), auto-expanding...`,
      );
      // Tiny follow-up call or pad programmatically
      // For now, just log - fix in prompt first
    }

    return parsed;
  } catch (err) {
    if (err.status === 429 && attempt <= MAX_RETRIES) {
      const wait = attempt * 8000;
      console.log(
        `    ⏳ Rate limited — waiting ${wait / 1000}s (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await new Promise((r) => setTimeout(r, wait));
      return generateContent(ctx, attempt + 1);
    }
    throw err;
  }
}

// ─── Validate ─────────────────────────────────────────────────────────────────

function validate(content, storeName) {
  const issues = [];

  const desc = content.description_html || "";
  const visible = desc
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const wordCount = visible ? visible.split(/\s+/).filter(Boolean).length : 0;
  const meta = (content.meta_description || "").trim();
  const faqsCount = Array.isArray(content.faqs) ? content.faqs.length : 0;

  if (wordCount < 650) issues.push(`desc too short: ${wordCount}w`);
  if (wordCount > 800) issues.push(`desc too long: ${wordCount}w`);

  if (meta.length < 150) issues.push(`meta too short: ${meta.length}c`);
  if (meta.length > 160) issues.push(`meta too long: ${meta.length}c`);
  if (!/\d/.test(meta)) issues.push("meta has no number");

  if (faqsCount !== 6) issues.push(`expected 6 FAQs, got ${faqsCount}`);

  if (!desc.toLowerCase().includes(storeName.toLowerCase())) {
    issues.push("store name missing from description");
  }

  // quick sanity check against obviously generic fluff
  const lower = visible.toLowerCase();
  const banned = [
    "in today's world",
    "dive into",
    "unlock savings",
    "treasure trove",
    "elevate your",
    "seamlessly",
  ];
  if (banned.some((b) => lower.includes(b))) {
    issues.push("contains banned generic buzzwords");
  }

  return issues;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `✍️  Generator | Model: ${MODEL} | Tier: ${TIER} | Limit: ${LIMIT || "all"} | DryRun: ${DRY_RUN} | RetryFailed: ${RETRY_FAILED}\n`,
  );

  let merchants = ALL_SCRAPED.filter(
    (m) => m.tier === TIER && !skipIds.has(m.id?.toString()),
  );

  if (LIMIT) merchants = merchants.slice(0, LIMIT);

  console.log(`📦 To generate: ${merchants.length} Tier-${TIER} stores\n`);

  if (!merchants.length) {
    console.log("✅ Nothing to generate. Use --retry-failed to redo errors.");
    return;
  }

  let results = RETRY_FAILED
    ? existingGenerated.filter((r) => !r.error)
    : [...existingGenerated];

  for (const m of merchants) {
    console.log(`  ↳ [${m.tier}] ${m.name}`);
    const ctx = buildContext(m, m.scraped_data || {});

    try {
      const content = await generateContent(ctx);
      const issues = validate(content, m.name);
      const visible = (content.description_html || "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const wc = visible.split(/\s+/).filter(Boolean).length;

      if (issues.length) {
        console.log(
          `    ⚠️  ${wc}w | meta:${(content.meta_description || "").length}c | ${issues.join(" | ")}`,
        );
      } else {
        console.log(
          `    ✓ ${wc}w | FAQs:${content.faqs?.length || 0} | meta:${(content.meta_description || "").length}c`,
        );
      }

      if (!DRY_RUN) {
        results.push({
          id: m.id,
          name: m.name,
          slug: m.slug,
          tier: m.tier,
          score: m.score,
          issues: issues.length ? issues : null,
          generated_at: new Date().toISOString(),
          content,
        });
        saveProgress(results);
      } else {
        console.log(`    [DRY] ${content.meta_title}`);
        console.log(
          `    [DRY] meta(${(content.meta_description || "").length}c): ${content.meta_description}`,
        );
        console.log(`    [DRY] desc preview: ${visible.slice(0, 120)}...`);
      }
    } catch (err) {
      console.error(`    ✗ ${m.name}: ${err.message}`);
      if (!DRY_RUN) {
        results.push({
          id: m.id,
          name: m.name,
          tier: m.tier,
          error: err.message.substring(0, 500),
          generated_at: new Date().toISOString(),
        });
        saveProgress(results);
      }
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  const successCount = results.filter((r) => !r.error).length;
  const failCount = results.filter((r) => r.error).length;
  console.log(`\n🏁 Done. Success: ${successCount} | Failed: ${failCount}`);
  console.log(`💾 Saved to: ${GENERATED_PATH}`);
}

main().catch(console.error);

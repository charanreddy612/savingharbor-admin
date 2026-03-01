/**
 * Reddit Scraper
 * Uses Reddit public JSON API — no auth needed
 *
 * FIXES:
 * 1. Subreddit-level disambiguation — filters r/movies, r/gaming, r/nfl etc.
 * 2. Shopping-intent queries — appends "coupon OR review OR discount" to every query
 * 3. Domain relevance check — if domain never appears in results, returns null not garbage
 * 4. Store name must appear in title OR snippet (not just title)
 */

const DELAY_MS = 800;

// Subreddits that indicate wrong context — discard entire thread
const OFF_TOPIC_SUBREDDITS = new Set([
  'movies', 'film', 'television', 'tv', 'gaming', 'games', 'pcgaming',
  'ps5', 'xbox', 'nintendo', 'nfl', 'nba', 'soccer', 'sports', 'baseball',
  'hockey', 'mma', 'wrestling', 'marvelrivals', 'leagueoflegends', 'valorant',
  'ffxiv', 'wow', 'dota2', 'globaloffensive', 'apexlegends', 'fortnitebr',
  'politics', 'worldnews', 'news', 'science', 'history', 'askhistorians',
  'books', 'literature', 'music', 'hiphopheads', 'popheads', 'indieheads',
  'celebrity', 'entertainment', 'popculturechat', 'relationships', 'amitheasshole',
  'wallstreetbets', 'investing', 'stocks', 'cryptocurrency', 'bitcoin',
  'anime', 'manga', 'cosplay', 'lostark', 'pathofexile',
]);

// Shopping-relevant subreddits get a relevance boost
const SHOPPING_SUBREDDITS = new Set([
  'frugal', 'deals', 'coupons', 'buildapc', 'churning', 'personalfinance',
  'buyitforlife', 'malefashionadvice', 'femalefashionadvice', 'skincareaddiction',
  'makeupaddiction', 'fitness', 'running', 'cycling', 'photography', 'coffee',
  'coffee', 'homeimprovement', 'gardening', 'cooking', 'mealprep',
]);

function classifySentiment(text) {
  const lower = text.toLowerCase();
  const pos = ['great', 'love', 'excellent', 'legit', 'worth', 'good', 'best', 'recommend', 'happy', 'fast', 'quality'].filter(k => lower.includes(k));
  const neg = ['scam', 'fake', 'awful', 'terrible', 'avoid', 'worst', 'broken', 'fraud', 'disappointed', 'late', 'never arrived', 'rip off'].filter(k => lower.includes(k));
  return pos.length > neg.length ? 'positive' : neg.length > pos.length ? 'negative' : 'neutral';
}

function isRelevantThread(post, storeName, domain) {
  const subreddit = (post.subreddit || '').toLowerCase();

  // Immediately discard known off-topic subreddits
  if (OFF_TOPIC_SUBREDDITS.has(subreddit)) return false;

  const title   = (post.title || '').toLowerCase();
  const snippet = (post.selftext || '').toLowerCase();
  const storeLC = storeName.toLowerCase();

  // Must mention store name OR domain in title or snippet
  const mentionsStore  = title.includes(storeLC) || snippet.includes(storeLC);
  const mentionsDomain = domain && (title.includes(domain) || snippet.includes(domain));

  if (!mentionsStore && !mentionsDomain) return false;

  // Extra check: if store name is a common word, require domain OR shopping context
  const isAmbiguousName = storeLC.split(' ').length === 1 && storeLC.length <= 6;
  if (isAmbiguousName && !mentionsDomain) {
    // Require at least one shopping signal in title
    const shoppingSignals = ['coupon', 'promo', 'discount', 'code', 'sale', 'deal', 'review', 'worth', 'buy', 'order', 'shipping', 'return', 'refund', 'store', 'shop', 'purchase'];
    const hasShoppingSignal = shoppingSignals.some(k => title.includes(k) || snippet.includes(k));
    if (!hasShoppingSignal) return false;
  }

  return true;
}

export async function scrapeReddit(storeName, webUrl) {
  const result = {
    found: false,
    threads: [],
    commonQuestions: [],
    commonComplaints: [],
    overallSentiment: 'neutral',
  };

  let domain = '';
  try { domain = new URL(webUrl).hostname.replace(/^www\./, ''); } catch {}

  // Shopping-intent queries — always append context
  const queries = [
    `${storeName} coupon promo code`,
    `${storeName} review worth it`,
    `site:${domain} OR "${storeName}" discount`,
  ].filter(Boolean);

  const allThreads = [];

  for (const query of queries) {
    await new Promise(r => setTimeout(r, DELAY_MS));
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=relevance&limit=8&type=link`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SavingHarborBot/1.0 (coupon research)' },
      });
      if (!res.ok) continue;
      const data = await res.json();

      for (const child of data?.data?.children || []) {
        const post = child.data;
        if (!isRelevantThread(post, storeName, domain)) continue;

        const subreddit = (post.subreddit || '').toLowerCase();
        const relevanceBoost = SHOPPING_SUBREDDITS.has(subreddit) ? 50 : 0;

        allThreads.push({
          title:          post.title,
          snippet:        post.selftext?.substring(0, 400) || null,
          score:          (post.score || 0) + relevanceBoost,
          subreddit:      post.subreddit,
          sentiment:      classifySentiment(post.title + ' ' + (post.selftext || '')),
          url:            post.permalink ? `https://reddit.com${post.permalink}` : null,
        });
      }
    } catch { continue; }
  }

  // Deduplicate by title
  const seen = new Set();
  result.threads = allThreads
    .filter(t => { if (seen.has(t.title)) return false; seen.add(t.title); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  if (!result.threads.length) return result;

  result.found           = true;
  result.commonQuestions = result.threads
    .filter(t => t.title.endsWith('?') || /\b(is|are|does|worth|legit|good|safe)\b/i.test(t.title))
    .map(t => t.title)
    .slice(0, 4);
  result.commonComplaints = result.threads
    .filter(t => ['scam', 'problem', 'issue', 'avoid', 'broken', 'late', 'never', 'disappointed', 'terrible'].some(k => t.title.toLowerCase().includes(k)))
    .map(t => t.title)
    .slice(0, 3);

  const pos = result.threads.filter(t => t.sentiment === 'positive').length;
  const neg = result.threads.filter(t => t.sentiment === 'negative').length;
  result.overallSentiment = pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';

  return result;
}

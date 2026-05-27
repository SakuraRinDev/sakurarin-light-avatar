const { File, Blob } = require('buffer');

if (!globalThis.File) globalThis.File = File;
if (!globalThis.Blob) globalThis.Blob = Blob;

const { GoogleSearch } = require('google-search-ts');
const cheerio = require('cheerio');

const SEARCH_PATTERNS = [
  /(?:google|Google|グーグル|ぐぐ|ググ|検索|調べて|しらべて|最新|ニュース)/,
];

function cleanQueryPart(text) {
  return String(text || '')
    .replace(/^(?:google|Google|グーグル|ぐぐって|ググって|検索して|調べて|しらべて)\s*/i, '')
    .replace(/(?:を)?(?:google|Google|グーグル)?(?:で)?(?:検索|調べて|しらべて|ググって|ぐぐって)(?:して)?[。！？!?\s]*$/i, '')
    .replace(/[「」『』"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function extractSearchQuery(message) {
  const text = String(message || '').trim();
  if (!text) return null;

  const colon = text.match(/(?:検索|Google|google|グーグル)\s*[:：]\s*(.+)$/);
  if (colon) return cleanQueryPart(colon[1]);

  const direct = text.match(/(?:Google|google|グーグル)(?:で)?(.+?)(?:を)?(?:検索|調べて|しらべて|ググって|ぐぐって)/);
  if (direct) return cleanQueryPart(direct[1]);

  if (!SEARCH_PATTERNS.some((pattern) => pattern.test(text))) return null;
  return cleanQueryPart(text);
}

function normalizeSearchResult(result) {
  const url = String(result && (result.url || result.link) || '').trim();
  const title = decodeHtml(String(result && result.title || '')).replace(/\s+/g, ' ').trim();
  const snippet = decodeHtml(String(result && (result.description || result.snippet) || '')).replace(/\s+/g, ' ').trim();
  if (!url.startsWith('http') || !title) return null;
  return { title, url, snippet };
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

async function searchGoogle(query, options = {}) {
  const cleanedQuery = cleanQueryPart(query);
  if (!cleanedQuery) throw new Error('search query is empty');

  const limit = Math.max(1, Math.min(Number(options.limit || 4), 8));
  const html = await GoogleSearch.makeRequest(cleanedQuery, {
    numResults: limit,
    lang: options.lang || 'ja',
    region: options.region || 'JP',
    safe: 'active',
    timeout: options.timeoutMs || 10000,
  });

  let results = parseGoogleHtml(html);
  let mode = 'web';
  if (results.length === 0) {
    results = await searchGoogleNews(cleanedQuery, { limit, lang: options.lang || 'ja', region: options.region || 'JP' });
    mode = 'news-rss-fallback';
  }
  const normalized = results.map(normalizeSearchResult).filter(Boolean).slice(0, limit);
  return {
    provider: 'google-search-ts',
    mode,
    query: cleanedQuery,
    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(cleanedQuery)}`,
    results: normalized,
  };
}

function parseGoogleHtml(html) {
  const $ = cheerio.load(html || '');
  const candidates = [];
  $('a[href]').each((_, element) => {
    const anchor = $(element);
    const rawUrl = anchor.attr('href') || '';
    const title = anchor.find('h3').first().text().trim() || anchor.text().trim();
    const resultBlock = anchor.closest('div.g, div.MjjYud, div.ezO2md, div[data-sokoban-container]');
    const snippet = resultBlock
      .find('div.VwiC3b, span.FrIlee, div.s, div.IsZvec')
      .first()
      .text()
      .trim();
    let url = rawUrl;
    if (url.startsWith('/url?')) {
      url = new URL(url, 'https://www.google.com').searchParams.get('q') || '';
    }
    if (url.startsWith('/search?') || url.includes('support.google.com/websearch')) return;
    candidates.push({ title, url, description: snippet });
  });
  return candidates;
}

async function searchGoogleNews(query, options = {}) {
  const lang = options.lang || 'ja';
  const region = options.region || 'JP';
  const params = new URLSearchParams({
    q: query,
    hl: lang,
    gl: region,
    ceid: `${region}:${lang}`,
  });
  const response = await fetch(`https://news.google.com/rss/search?${params.toString()}`, {
    headers: {
      'user-agent': 'SakuraRin-Light-Avatar/0.1',
      accept: 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
    },
  });
  if (!response.ok) throw new Error(`Google News RSS error ${response.status}`);
  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $('item').each((_, element) => {
    const item = $(element);
    items.push({
      title: item.find('title').first().text().trim(),
      url: item.find('link').first().text().trim(),
      description: item.find('description').first().text().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });
  });
  return items.slice(0, options.limit || 4);
}

function formatSearchContext(searchPayload) {
  if (!searchPayload || !Array.isArray(searchPayload.results) || searchPayload.results.length === 0) {
    return `Google検索クエリ: ${searchPayload?.query || ''}\n検索結果: 取得できませんでした。`;
  }
  const lines = searchPayload.results.map((result, index) => {
    const snippet = result.snippet ? ` - ${result.snippet}` : '';
    return `${index + 1}. ${result.title}${snippet}\nURL: ${result.url}`;
  });
  return `Google検索クエリ: ${searchPayload.query}\n検索結果:\n${lines.join('\n')}`;
}

function createSearchSubtitle(searchPayload) {
  if (!searchPayload || !Array.isArray(searchPayload.results) || searchPayload.results.length === 0) {
    return 'Google検索、ちょっと転んじゃった。もう一回だけ試してみて。';
  }
  const first = searchPayload.results[0];
  const sourceParts = first.title.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const source = sourceParts.length > 1 ? sourceParts[sourceParts.length - 1] : '';
  const headline = (sourceParts[0] || first.title).split(/｜|\|/)[0].trim();
  const shortHeadline = headline.length > 34 ? `${headline.slice(0, 33)}...` : headline;
  const suffix = source && source !== headline ? `（${source}）` : '';
  return `検索したよ。${shortHeadline}${suffix}`.slice(0, 60);
}

module.exports = {
  cleanQueryPart,
  createSearchSubtitle,
  decodeHtml,
  extractSearchQuery,
  formatSearchContext,
  parseGoogleHtml,
  searchGoogle,
  searchGoogleNews,
};

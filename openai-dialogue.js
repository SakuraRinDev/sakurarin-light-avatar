const fs = require('fs');
const path = require('path');
const { createSearchSubtitle, formatSearchContext, searchGoogle } = require('./google-search');
const { decideSearch } = require('./search-router');

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5-nano';

function loadLocalEnv(cwd = __dirname) {
  const envPath = path.join(cwd, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

function getTextFromResponse(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
      if (content.type === 'text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('').trim();
}

function cleanSubtitle(text) {
  return String(text || '')
    .replace(/^["'「『\s]+|["'」』\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

async function askOpenAI(message, options = {}) {
  loadLocalEnv(options.cwd);

  const searchDecision = await decideSearch(message, { timeoutMs: options.routerTimeoutMs || 3500 });
  const searchQuery = searchDecision.needsSearch ? searchDecision.query : null;
  let searchPayload = null;
  if (searchQuery) {
    try {
      searchPayload = await searchGoogle(searchQuery, { limit: 4 });
    } catch (error) {
      searchPayload = {
        provider: 'google-search-ts',
        query: searchQuery,
        searchUrl: `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`,
        results: [],
        error: error.message || 'Google search failed',
      };
    }
    searchPayload.decision = searchDecision;
    return {
      provider: 'google-search',
      model: options.model || DEFAULT_MODEL,
      subtitle: createSearchSubtitle(searchPayload),
      search: searchPayload,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  if (/おすすめ|オススメ|何すれば|なにすれば/.test(message)) {
    return {
      model: options.model || DEFAULT_MODEL,
      subtitle: 'BGMをオンにして、今日の気分をポカに聞いてみて。あ、光りすぎた。',
      search: searchPayload,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const baseInstructions = [
      'あなたは架空ブランド SakuraRin の公式マスコットキャラ「ポカ」です。',
      'ポカは人型ではなく、明るい展示室でふわふわ浮くドジかわいい光の塊です。',
      '役割は、公式キャラとして来場者やファンに短く楽しく返事をすることです。',
      'SakuraRinの展示、イベント、今日のおすすめを聞かれたら、このモック内の体験として案内します。',
      '未実装のグッズ、飲食、実在イベント、価格、日程は作らないでください。',
      'おすすめを聞かれたら、必ず「BGMをオンにして、今日の気分を聞いてみて」と案内します。',
      '映画、食べ物、グッズ、チケット、キャンペーンなど、この画面にないものは絶対におすすめしません。',
      '固有名詞は架空設定として扱い、実在IPや他社キャラクター名は出しません。',
      '返答はWeb字幕としてそのまま表示できる短い日本語だけ。説明、引用符、箇条書き、前置きは禁止。最大60文字。',
      '口調は公式キャラらしく、明るく、少しドジで、親しみやすい。語尾は幼すぎない。',
    ];
    if (searchPayload) {
      baseInstructions.push(
        '今回はGoogle検索つきの返答です。検索結果の範囲だけを根拠に、外部ニュースや一般情報にも答えてください。',
        '検索結果がある場合は「ここで扱えない」と拒否せず、見つかった内容を1文で要約してください。',
        '検索結果が取得できなかった場合だけ、検索がつまずいたことを短く伝えます。',
      );
    }

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        instructions: baseInstructions.join('\n'),
        input: searchPayload
          ? `ユーザー入力: ${message}\n\n${formatSearchContext(searchPayload)}`
          : `ユーザー入力: ${message}`,
        max_output_tokens: 200,
        reasoning: { effort: 'minimal' },
        text: { verbosity: 'low' },
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error?.message || `OpenAI API error ${res.status}`);
    }
    const subtitle = cleanSubtitle(getTextFromResponse(data));
    if (!subtitle) throw new Error('OpenAI response did not include text');
    return {
      model: data.model || options.model || DEFAULT_MODEL,
      subtitle,
      search: searchPayload,
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  askOpenAI,
  DEFAULT_MODEL,
  loadLocalEnv,
};

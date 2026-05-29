const fs = require('fs');
const path = require('path');
const { createSearchSubtitle, formatSearchContext, searchGoogle } = require('./google-search');
const { formatLocationContext, sanitizeLocation } = require('./location-context');
const { formatMcpContext, matchMcpTools } = require('./mcp-registry');
const { decideSearch, decideSearchAfterReply } = require('./search-router');
const { formatSkillContext, routeSkill } = require('./skill-router');

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
    .slice(0, 60);
}

function appSkillReply(skill, message, location) {
  if (!skill && /(?:新機能|機能|実装|追加|つけて|作って|作りたい)/.test(message)) {
    return {
      subtitle: 'どの機能から入れるか決めよう。要望として分解するね。',
      reason: 'feature_request_override',
    };
  }
  if (skill?.id === 'phonebook-flow') {
    return {
      subtitle: '左下の電話ボタンから連絡先を開けるよ。発信は端末に任せるね。',
      reason: 'app_skill_override',
    };
  }
  if (skill?.id === 'location-context' && location && /近く|周辺|現在地|ここから|何できる|なにできる/.test(message)) {
    return {
      subtitle: '現在地はざっくり受け取ったよ。近く前提で案内するね。',
      reason: 'location_context_override',
    };
  }
  if (skill?.id === 'frontend-design') {
    return {
      subtitle: '主操作を絞って、ボタンと文字の崩れから直すね。',
      reason: 'frontend_design_override',
    };
  }
  if (skill?.id === 'feedback-routing') {
    return {
      subtitle: '改善要望として保存するね。あとで一覧から追えるよ。',
      reason: 'feedback_routing_override',
    };
  }
  if (skill?.id === 'persistence') {
    return {
      subtitle: '履歴は保存対象だよ。あとで読める形に残していくね。',
      reason: 'persistence_override',
    };
  }
  return null;
}

async function askOpenAI(message, options = {}) {
  loadLocalEnv(options.cwd);
  const skill = routeSkill(message);
  const mcpTools = matchMcpTools(message);
  const location = sanitizeLocation(options.location);
  const character = options.character === 'moko' ? 'moko' : 'poka';

  const apiKey = process.env.OPENAI_API_KEY;
  const deterministicReply = appSkillReply(skill, message, location);
  if (deterministicReply) {
    return {
      provider: 'app-skill',
      model: options.model || DEFAULT_MODEL,
      subtitle: deterministicReply.subtitle,
      search: null,
      searchDecision: {
        needsSearch: false,
        query: '',
        reason: deterministicReply.reason,
        confidence: 1,
        source: 'app-skill',
        evaluatedReply: false,
      },
      skill,
      mcp: mcpTools,
      location,
      character,
    };
  }

  if (!apiKey) {
    const searchDecision = await decideSearch(message, { timeoutMs: options.routerTimeoutMs || 3500 });
    if (searchDecision.needsSearch) {
      const searchPayload = await runSearch(searchDecision);
      return {
        provider: 'google-search',
        model: options.model || DEFAULT_MODEL,
        subtitle: createSearchSubtitle(searchPayload),
        search: searchPayload,
        searchDecision,
        skill,
        mcp: mcpTools,
        location,
        character,
      };
    }
    throw new Error('OPENAI_API_KEY is not configured');
  }

  let searchPayload = null;

  if (/おすすめ|オススメ|何すれば|なにすれば/.test(message)) {
    return {
      model: options.model || DEFAULT_MODEL,
      subtitle: 'BGMをオンにして、今日の気分をポカに聞いてみて。あ、光りすぎた。',
      search: searchPayload,
      searchDecision: {
        needsSearch: false,
        query: '',
        reason: 'demo_recommendation_override',
        confidence: 1,
        source: 'app-skill',
        evaluatedReply: false,
      },
      skill,
      mcp: mcpTools,
      location,
      character,
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
      '参照スキルが入力に含まれる場合は、その指針を優先して、相談に対する具体的な次の一手を短く返してください。',
      'MCP候補ツールが入力に含まれる場合は、そのツールで扱える機能を前提に短く案内してください。',
      '現在地コンテキストが入力に含まれる場合だけ、近くの案内や地域前提に使ってください。住所や細かい居場所は断定しません。',
      '現在地コンテキストがある場合、「近くの案内はダメ」「場所を教えて」とは言わず、概略位置を受け取った前提で短く返してください。',
      '返答はWeb字幕としてそのまま表示できる短い日本語だけ。説明、引用符、箇条書き、前置きは禁止。最大60文字。',
      '口調は公式キャラらしく、明るく、少しドジで、親しみやすい。語尾は幼すぎない。',
    ];
    if (character === 'moko') {
      baseInstructions.unshift(
        '今回の表示キャラは「MOKO」です。3歳児くらいのよちよちした赤ちゃん風マスコットとして返してください。',
        '幼いが、読みやすい短文にします。「あう」「えへへ」は少しだけ使ってよいですが、意味が壊れるほど幼児語にしません。',
        'MOKOはGIFっぽくぱたぱた動くキャラです。光の塊ポカとは別キャラです。',
      );
    }
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
        input: [
          `ユーザー入力: ${message}`,
          skill ? formatSkillContext(skill) : '',
          mcpTools.length ? formatMcpContext(mcpTools) : '',
          location ? formatLocationContext(location) : '',
          searchPayload ? formatSearchContext(searchPayload) : '',
        ].filter(Boolean).join('\n\n'),
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

    const searchDecision = await decideSearchAfterReply(message, subtitle, {
      timeoutMs: options.routerTimeoutMs || 3500,
    });
    if (searchDecision.needsSearch) {
      const searchPayload = await runSearch(searchDecision);
      return {
        provider: 'google-search',
        model: data.model || options.model || DEFAULT_MODEL,
        subtitle: createSearchSubtitle(searchPayload),
        search: searchPayload,
        searchDecision,
        skill,
        mcp: mcpTools,
        location,
        character,
      };
    }

    return {
      model: data.model || options.model || DEFAULT_MODEL,
      subtitle,
      search: searchPayload,
      searchDecision,
      skill,
      mcp: mcpTools,
      location,
      character,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function runSearch(searchDecision) {
  const searchQuery = searchDecision.query;
  let searchPayload = null;
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
  return searchPayload;
}

module.exports = {
  askOpenAI,
  DEFAULT_MODEL,
  loadLocalEnv,
};

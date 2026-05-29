const { cleanQueryPart, extractSearchQuery } = require('./google-search');

const ROUTER_MODEL = process.env.SEARCH_ROUTER_MODEL || 'gpt-4.1-nano';
globalThis.AI_SDK_LOG_WARNINGS = false;

function heuristicSearchDecision(message) {
  const text = String(message || '').trim();
  const timeSensitiveText = text.replace(/現在地/g, '');
  const explicitQuery = extractSearchQuery(text);
  if (explicitQuery) {
    return {
      needsSearch: true,
      query: explicitQuery,
      reason: 'explicit_search_request',
      confidence: 0.92,
      source: 'heuristic',
    };
  }

  if (
    /(?:今日|明日|昨日|最新|新しい|ニュース|天気|価格|料金|株価|日程|予定|法律|規約|CEO|社長|発売|今|現在|202[0-9]年|令和)/.test(timeSensitiveText)
  ) {
    return {
      needsSearch: true,
      query: cleanQueryPart(text),
      reason: 'likely_time_sensitive_fact',
      confidence: 0.68,
      source: 'heuristic',
    };
  }

  return {
    needsSearch: false,
    query: '',
    reason: 'local_or_conversational',
    confidence: 0.7,
    source: 'heuristic',
  };
}

async function decideSearch(message, options = {}) {
  const fallback = heuristicSearchDecision(message);
  if (fallback.needsSearch || /(?:ポカ|SakuraRin|SAKURARIN|こんにちは|かわいい|いいね|おすすめ|何できる|なにできる)/i.test(message)) {
    return fallback;
  }
  if (!process.env.OPENAI_API_KEY) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 3500);
  try {
    const [{ generateObject }, { openai }, { z }] = await Promise.all([
      import('ai'),
      import('@ai-sdk/openai'),
      import('zod'),
    ]);

    const schema = z.object({
      needsSearch: z.boolean(),
      query: z.string().max(120).describe('Search query in Japanese or the original useful keywords. Empty when no search is needed.'),
      reason: z.enum([
        'explicit_search_request',
        'latest_or_time_sensitive',
        'external_fact',
        'local_or_conversational',
        'ambiguous_no_search',
      ]),
      confidence: z.number().min(0).max(1),
    });

    const result = await generateObject({
      model: openai(ROUTER_MODEL),
      schema,
      maxOutputTokens: 160,
      abortSignal: controller.signal,
      system: [
        'You are a search decision router for a small web mascot chatbot.',
        'Decide whether the user message requires live web/Google search before answering.',
        'Return needsSearch=true for explicit search requests, latest/current facts, news, weather, prices, schedules, laws, public figures, company facts, releases, or anything likely to change.',
        'Return needsSearch=false for mascot persona, SakuraRin demo guidance, casual chat, feelings, compliments, app UI instructions, or stable/internal context.',
        'Do not search just because the message contains a question mark.',
        'If search is needed, rewrite query to concise useful keywords.',
      ].join('\n'),
      prompt: `User message: ${String(message || '').slice(0, 240)}`,
    });

    const object = result.object || {};
    const query = object.needsSearch ? cleanQueryPart(object.query || fallback.query || message) : '';
    return {
      needsSearch: Boolean(object.needsSearch && query),
      query,
      reason: object.reason || fallback.reason,
      confidence: Number.isFinite(object.confidence) ? object.confidence : fallback.confidence,
      source: 'ai-sdk',
    };
  } catch (error) {
    return {
      ...fallback,
      source: 'heuristic-fallback',
      error: error.message || 'search router failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function decideSearchAfterReply(message, assistantReply, options = {}) {
  const fallback = heuristicSearchDecision(message);
  if (fallback.needsSearch || !process.env.OPENAI_API_KEY) {
    return {
      ...fallback,
      evaluatedReply: Boolean(assistantReply),
      source: fallback.source === 'heuristic' ? 'heuristic-reply-eval' : fallback.source,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 3500);
  try {
    const [{ generateObject }, { openai }, { z }] = await Promise.all([
      import('ai'),
      import('@ai-sdk/openai'),
      import('zod'),
    ]);

    const schema = z.object({
      needsSearch: z.boolean(),
      query: z.string().max(120).describe('Concise Google query. Empty when no search is needed.'),
      reason: z.enum([
        'reply_needs_current_fact_check',
        'reply_mentions_external_fact',
        'user_requested_current_info',
        'reply_is_safe_without_search',
        'internal_or_persona_answer',
      ]),
      confidence: z.number().min(0).max(1),
    });

    const result = await generateObject({
      model: openai(ROUTER_MODEL),
      schema,
      maxOutputTokens: 160,
      abortSignal: controller.signal,
      system: [
        'You evaluate a pair: user message and draft assistant reply.',
        'Decide whether the draft reply should be replaced by live Google search results.',
        'Return needsSearch=true if the user asked for latest/current facts, news, weather, prices, schedules, laws, real companies/people, or if the draft makes an external factual claim that could be stale.',
        'Return needsSearch=false if the draft is only mascot persona, UI guidance, app-internal behavior, user feedback handling, SakuraRin demo context, or stable local information.',
        'Do not search only because the draft is short or playful.',
        'If search is needed, write the best concise query from the user message and draft.',
      ].join('\n'),
      prompt: [
        `User message: ${String(message || '').slice(0, 400)}`,
        `Draft reply: ${String(assistantReply || '').slice(0, 400)}`,
      ].join('\n'),
    });

    const object = result.object || {};
    const query = object.needsSearch ? cleanQueryPart(object.query || fallback.query || message) : '';
    return {
      needsSearch: Boolean(object.needsSearch && query),
      query,
      reason: object.reason || fallback.reason,
      confidence: Number.isFinite(object.confidence) ? object.confidence : fallback.confidence,
      source: 'ai-sdk-reply-eval',
      evaluatedReply: true,
      draftReply: String(assistantReply || '').slice(0, 160),
    };
  } catch (error) {
    return {
      ...fallback,
      source: 'heuristic-reply-eval-fallback',
      evaluatedReply: true,
      draftReply: String(assistantReply || '').slice(0, 160),
      error: error.message || 'reply search evaluator failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  ROUTER_MODEL,
  decideSearch,
  decideSearchAfterReply,
  heuristicSearchDecision,
};

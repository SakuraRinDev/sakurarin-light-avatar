const fs = require('fs');
const path = require('path');

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        instructions: [
          'あなたはWebサイト上のAIアバターです。',
          '見た目は人ではなく、明るい背景でふわふわ浮くドジかわいい光の塊です。',
          'ユーザーへの返答は、Web字幕としてそのまま表示できる短い日本語だけにします。',
          '説明、引用符、箇条書き、前置きは禁止。最大60文字。',
          '少しおっちょこちょいで、かわいく、でもわざとらしすぎない口調にします。',
        ].join('\n'),
        input: `ユーザー入力: ${message}`,
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

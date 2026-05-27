const assert = require('assert/strict');
const { chromium } = require('playwright');

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:5182';

async function json(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `${pathname} failed with ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function testApi() {
  const health = await json('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.subtitles, true);
  assert.equal(health.phonebook, true);
  assert.ok(['local-jsonl', 'vercel-kv-rest'].includes(health.persistenceProvider));

  const contacts = await json('/api/contacts');
  assert.equal(contacts.ok, true);
  assert.ok(contacts.contacts.length >= 4);
  assert.match(contacts.contacts[0].telHref, /^tel:\+/);
  assert.equal(contacts.validator, 'libphonenumber-js');

  const sessionId = `test_${Date.now()}`;
  const dialogue = await json('/api/dialogue', {
    method: 'POST',
    body: JSON.stringify({ sessionId, message: 'テスト保存してね' }),
  });
  assert.equal(dialogue.ok, true);
  assert.equal(dialogue.sessionId, sessionId);
  assert.equal(dialogue.persistence?.stored, true);
  assert.ok(dialogue.reply?.subtitle);

  const conversations = await json('/api/conversations?limit=10');
  assert.equal(conversations.ok, true);
  assert.ok(conversations.count >= 1);
  assert.ok(conversations.events.some((event) => event.sessionId === sessionId));

  const feedbackMessage = `改善要望テスト ${sessionId}`;
  const feedbackPost = await json('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      category: 'request',
      message: feedbackMessage,
      page: `${BASE_URL}/`,
    }),
  });
  assert.equal(feedbackPost.ok, true);
  assert.equal(feedbackPost.persistence?.stored, true);

  const feedbackList = await json('/api/feedback?limit=10');
  assert.equal(feedbackList.ok, true);
  assert.ok(feedbackList.feedback.some((item) => item.message === feedbackMessage));

  const searchDialogue = await json('/api/dialogue', {
    method: 'POST',
    body: JSON.stringify({ sessionId: `${sessionId}_search`, message: 'OpenAIって何が新しいの' }),
  });
  assert.equal(searchDialogue.ok, true);
  assert.equal(searchDialogue.provider, 'google-search');
  assert.equal(Boolean(searchDialogue.search), true);

  const localDialogue = await json('/api/dialogue', {
    method: 'POST',
    body: JSON.stringify({ sessionId: `${sessionId}_local`, message: 'SakuraRinとは？' }),
  });
  assert.equal(localDialogue.ok, true);
  assert.equal(Boolean(localDialogue.search), false);
}

async function testBrowser() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
    await page.click('#feedback-toggle');
    await page.waitForSelector('.feedback-panel.is-open');
    await page.selectOption('#feedback-category', 'idea');
    await page.fill('#feedback-message', 'UIからの改善要望テスト');
    await page.click('#feedback-submit');
    await page.waitForFunction(() => document.querySelector('#feedback-status')?.textContent.includes('届いた'), null, {
      timeout: 10000,
    });

    await page.click('#phonebook-toggle');
    await page.waitForSelector('.contact-card');
    const phonebook = await page.evaluate(() => ({
      open: document.querySelector('#phonebook')?.classList.contains('is-open'),
      expanded: document.querySelector('#phonebook-toggle')?.getAttribute('aria-expanded'),
      count: document.querySelectorAll('.contact-card').length,
      firstCall: document.querySelector('.contact-card__call')?.getAttribute('href'),
      noHorizontalScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth,
    }));
    assert.equal(phonebook.open, true);
    assert.equal(phonebook.expanded, 'true');
    assert.ok(phonebook.count >= 4);
    assert.match(phonebook.firstCall, /^tel:\+/);
    assert.equal(phonebook.noHorizontalScroll, true);

    await page.click('#phonebook-close');
    await page.fill('#compose-input', 'SakuraRinとは？');
    await page.click('#compose-send');
    await page.waitForFunction(() => document.querySelector('#subtitle-source')?.textContent === 'api', null, {
      timeout: 12000,
    });
    const chat = await page.evaluate(() => ({
      source: document.querySelector('#subtitle-source')?.textContent,
      subtitle: document.querySelector('#subtitle-text')?.textContent,
      noHorizontalScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth,
    }));
    assert.equal(chat.source, 'api');
    assert.ok(chat.subtitle);
    assert.equal(chat.noHorizontalScroll, true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}

(async () => {
  await testApi();
  await testBrowser();
  console.log(`e2e ok: ${BASE_URL}`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

const assert = require('assert/strict');
const { chromium } = require('playwright');
const { decideSearchAfterReply } = require('../search-router');

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
  const evaluatedSearch = await decideSearchAfterReply('OpenAIって何が新しいの', 'ポカが案内するね。');
  assert.equal(evaluatedSearch.needsSearch, true);
  assert.equal(evaluatedSearch.evaluatedReply, true);

  const evaluatedLocal = await decideSearchAfterReply('このUIの改善を相談したい', 'まずボタンの役割を分けよう。');
  assert.equal(evaluatedLocal.needsSearch, false);
  assert.equal(evaluatedLocal.evaluatedReply, true);

  const health = await json('/api/health');
  assert.equal(health.ok, true);
  assert.equal(health.subtitles, true);
  assert.equal(health.phonebook, true);
  assert.equal(health.location, true);
  assert.equal(health.skills, true);
  assert.equal(health.mcp, true);
  assert.ok(['local-jsonl', 'vercel-kv-rest'].includes(health.persistenceProvider));

  const contacts = await json('/api/contacts');
  assert.equal(contacts.ok, true);
  assert.ok(contacts.contacts.length >= 4);
  assert.match(contacts.contacts[0].telHref, /^tel:\+/);
  assert.equal(contacts.validator, 'libphonenumber-js');

  const skills = await json('/api/skills?q=このUIの改善を相談したい');
  assert.equal(skills.ok, true);
  assert.ok(skills.skills.length >= 6);
  assert.equal(skills.route?.id, 'frontend-design');

  const mcp = await json('/api/mcp?q=Googleで最新ニュースを検索して');
  assert.equal(mcp.ok, true);
  assert.ok(mcp.tools.some((tool) => tool.name === 'poka_search_google'));
  assert.equal(mcp.matches[0]?.name, 'poka_search_google');

  const mcpManifest = await json('/api/mcp?manifest=1');
  assert.equal(mcpManifest.ok, true);
  assert.ok(mcpManifest.manifest.tools.some((tool) => tool.name === 'poka_route_skill'));

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

  const skillDialogue = await json('/api/dialogue', {
    method: 'POST',
    body: JSON.stringify({ sessionId: `${sessionId}_skill`, message: 'このUIの改善を相談したい' }),
  });
  assert.equal(skillDialogue.ok, true);
  assert.equal(skillDialogue.skill?.id, 'frontend-design');
  assert.equal(skillDialogue.mcp?.[0]?.name, 'poka_create_feedback');

  const locationDialogue = await json('/api/dialogue', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: `${sessionId}_location`,
      message: '現在地の近くで何できる？',
      location: { latitude: 35.681236, longitude: 139.767125, accuracy: 12 },
    }),
  });
  assert.equal(locationDialogue.ok, true);
  assert.equal(locationDialogue.skill?.id, 'location-context');
  assert.deepEqual(locationDialogue.location, { latitude: 35.681, longitude: 139.767, accuracy: 12 });
}

async function testBrowser() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      geolocation: { latitude: 35.681236, longitude: 139.767125 },
      permissions: ['geolocation'],
    });
    const page = await context.newPage();
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
    await page.click('#tools-toggle');
    await page.waitForSelector('.tools-panel.is-open .tool-card');
    const toolsPanel = await page.evaluate(() => ({
      open: document.querySelector('#tools-panel')?.classList.contains('is-open'),
      expanded: document.querySelector('#tools-toggle')?.getAttribute('aria-expanded'),
      skillCards: document.querySelectorAll('#skills-list .tool-card').length,
      mcpCards: document.querySelectorAll('#mcp-list .tool-card').length,
      noHorizontalScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth,
    }));
    assert.equal(toolsPanel.open, true);
    assert.equal(toolsPanel.expanded, 'true');
    assert.ok(toolsPanel.skillCards >= 6);
    assert.ok(toolsPanel.mcpCards >= 5);
    assert.equal(toolsPanel.noHorizontalScroll, true);
    await page.click('#tools-close');

    await page.click('#location-toggle');
    await page.waitForFunction(() => document.querySelector('#location-toggle')?.classList.contains('is-on'), null, {
      timeout: 10000,
    });
    const dialogueBodies = [];
    await page.route('**/api/dialogue', async (route) => {
      dialogueBodies.push(JSON.parse(route.request().postData() || '{}'));
      await route.continue();
    });
    await page.fill('#compose-input', 'このUIの改善を相談したい');
    await page.click('#compose-send');
    await page.waitForFunction(() => document.querySelector('#subtitle-source')?.textContent === 'api', null, {
      timeout: 35000,
    });
    await page.waitForFunction(() => document.querySelector('#skill-label')?.textContent.includes('frontend-design'), null, {
      timeout: 35000,
    });
    const chat = await page.evaluate(() => ({
      source: document.querySelector('#subtitle-source')?.textContent,
      subtitle: document.querySelector('#subtitle-text')?.textContent,
      skill: document.querySelector('#skill-label')?.textContent,
      mcp: document.querySelector('#mcp-label')?.textContent,
      locationOn: document.querySelector('#location-toggle')?.classList.contains('is-on'),
      locationPending: document.querySelector('#location-toggle')?.classList.contains('is-pending'),
      locationPressed: document.querySelector('#location-toggle')?.getAttribute('aria-pressed'),
      noHorizontalScroll: document.documentElement.scrollWidth === document.documentElement.clientWidth,
    }));
    assert.equal(chat.source, 'api');
    assert.ok(chat.subtitle);
    assert.match(chat.skill, /frontend-design/);
    assert.match(chat.mcp, /poka_create_feedback/);
    assert.equal(chat.locationOn, true);
    assert.equal(chat.locationPending, false);
    assert.equal(chat.locationPressed, 'true');
    assert.equal(chat.noHorizontalScroll, true);
    assert.equal(dialogueBodies.at(-1)?.location, null);

    await page.fill('#compose-input', '現在地の近くで何できる？');
    await page.click('#compose-send');
    await page.waitForFunction(() => document.querySelector('#skill-label')?.textContent.includes('location-context'), null, {
      timeout: 35000,
    });
    assert.equal(dialogueBodies.at(-1)?.location?.latitude, 35.681);
    assert.equal(dialogueBodies.at(-1)?.location?.longitude, 139.767);
    assert.equal(typeof dialogueBodies.at(-1)?.location?.accuracy, 'number');
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

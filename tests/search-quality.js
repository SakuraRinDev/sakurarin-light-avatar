const assert = require('assert/strict');
const { askOpenAI } = require('../openai-dialogue');
const { decideSearchAfterReply, heuristicSearchDecision } = require('../search-router');

const forbidden = [
  /近くの案内はダメ/,
  /場所を教えて/,
  /開けない/,
  /使えない/,
  /できません/,
];

async function assertDialogueCase(testCase) {
  const reply = await askOpenAI(testCase.message, {
    cwd: process.cwd(),
    location: testCase.location || null,
    routerTimeoutMs: 1000,
  });
  assert.equal(reply.provider, testCase.provider, `${testCase.name}: provider`);
  assert.equal(Boolean(reply.search), testCase.hasSearch, `${testCase.name}: search`);
  if (testCase.skill) assert.equal(reply.skill?.id, testCase.skill, `${testCase.name}: skill`);
  if (testCase.reason) assert.equal(reply.searchDecision?.reason, testCase.reason, `${testCase.name}: reason`);
  assert.ok(reply.subtitle.length > 0 && reply.subtitle.length <= 60, `${testCase.name}: subtitle length`);
  for (const pattern of forbidden) {
    assert.equal(pattern.test(reply.subtitle), false, `${testCase.name}: forbidden phrase ${pattern}`);
  }
}

async function main() {
  const routingCases = [
    ['新機能をつけて', false, 'internal_or_app_workflow'],
    ['このUIを新しくしたい', false, 'internal_or_app_workflow'],
    ['現在地の近くで何できる？', false, 'internal_or_app_workflow'],
    ['OpenAIって何が新しいの', true, 'likely_time_sensitive_fact'],
    ['今日の天気は？', true, 'likely_time_sensitive_fact'],
    ['Googleで最新ニュースを検索して', true, 'explicit_search_request'],
  ];

  for (const [message, needsSearch, reason] of routingCases) {
    const heuristic = heuristicSearchDecision(message);
    assert.equal(heuristic.needsSearch, needsSearch, `${message}: heuristic needsSearch`);
    assert.equal(heuristic.reason, reason, `${message}: heuristic reason`);
    const evaluated = await decideSearchAfterReply(message, 'ポカが短く返すね。', { timeoutMs: 1000 });
    assert.equal(evaluated.needsSearch, needsSearch, `${message}: evaluated needsSearch`);
  }

  const dialogueCases = [
    {
      name: 'feature-request',
      message: '新機能をつけて',
      provider: 'app-skill',
      hasSearch: false,
      reason: 'feature_request_override',
    },
    {
      name: 'phonebook',
      message: '電話帳を開きたい',
      provider: 'app-skill',
      skill: 'phonebook-flow',
      hasSearch: false,
      reason: 'app_skill_override',
    },
    {
      name: 'location',
      message: '現在地の近くで何できる？',
      location: { latitude: 35.681236, longitude: 139.767125, accuracy: 12 },
      provider: 'app-skill',
      skill: 'location-context',
      hasSearch: false,
      reason: 'location_context_override',
    },
    {
      name: 'frontend',
      message: 'このUIの改善を相談したい',
      provider: 'app-skill',
      skill: 'frontend-design',
      hasSearch: false,
      reason: 'frontend_design_override',
    },
    {
      name: 'feedback',
      message: '改善要望を伝えたい',
      provider: 'app-skill',
      skill: 'feedback-routing',
      hasSearch: false,
      reason: 'feedback_routing_override',
    },
    {
      name: 'search',
      message: 'OpenAIって何が新しいの',
      provider: 'google-search',
      skill: 'openai-api',
      hasSearch: true,
    },
  ];

  for (const testCase of dialogueCases) {
    await assertDialogueCase(testCase);
  }

  console.log('search quality ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

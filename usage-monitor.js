const { listConversationEvents, storageProvider } = require('./conversation-store');

const DEFAULT_LIMITS = {
  total10m: 30,
  openai1h: 60,
  search1h: 30,
  total24h: 300,
};

function getLimits() {
  return {
    total10m: Number(process.env.USAGE_LIMIT_TOTAL_10M || DEFAULT_LIMITS.total10m),
    openai1h: Number(process.env.USAGE_LIMIT_OPENAI_1H || DEFAULT_LIMITS.openai1h),
    search1h: Number(process.env.USAGE_LIMIT_SEARCH_1H || DEFAULT_LIMITS.search1h),
    total24h: Number(process.env.USAGE_LIMIT_TOTAL_24H || DEFAULT_LIMITS.total24h),
  };
}

function countRecent(events, now, windowMs, predicate = () => true) {
  return events.filter((event) => {
    const createdAt = new Date(event.createdAt).getTime();
    return Number.isFinite(createdAt) && now - createdAt <= windowMs && predicate(event);
  }).length;
}

function createUsageSummary(events, now = Date.now(), limits = getLimits()) {
  const openaiProvider = (event) => event.provider === 'openai-api';
  const searchProvider = (event) => event.provider === 'google-search';
  const counts = {
    total10m: countRecent(events, now, 10 * 60 * 1000),
    openai1h: countRecent(events, now, 60 * 60 * 1000, openaiProvider),
    search1h: countRecent(events, now, 60 * 60 * 1000, searchProvider),
    total24h: countRecent(events, now, 24 * 60 * 60 * 1000),
  };
  const alerts = [];
  for (const [key, value] of Object.entries(counts)) {
    const limit = limits[key];
    if (Number.isFinite(limit) && limit > 0 && value >= limit) {
      alerts.push({
        key,
        count: value,
        limit,
        level: value >= limit * 1.5 ? 'critical' : 'warning',
      });
    }
  }
  return {
    ok: true,
    provider: storageProvider(),
    checkedAt: new Date(now).toISOString(),
    limits,
    counts,
    alert: alerts.length > 0,
    level: alerts.some((item) => item.level === 'critical') ? 'critical' : alerts.length ? 'warning' : 'ok',
    alerts,
  };
}

async function getUsageSummary(limit = 200) {
  const events = await listConversationEvents(limit);
  return createUsageSummary(events);
}

module.exports = {
  DEFAULT_LIMITS,
  createUsageSummary,
  getLimits,
  getUsageSummary,
};

const fs = require('fs');
const path = require('path');

const registryPath = path.join(__dirname, 'data', 'mcp-servers.json');

function loadMcpServers() {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

function listMcpTools() {
  return loadMcpServers().flatMap((server) =>
    (server.tools || []).map((tool) => ({
      ...tool,
      serverId: server.id,
      serverName: server.name,
      transport: server.transport,
    })),
  );
}

function matchMcpTools(message, limit = 3) {
  const normalized = String(message || '').toLowerCase();
  return listMcpTools()
    .map((tool) => {
      const score = (tool.triggers || []).reduce((total, trigger) => {
        const needle = String(trigger || '').toLowerCase();
        return needle && normalized.includes(needle) ? total + 1 : total;
      }, 0);
      return { ...tool, score };
    })
    .filter((tool) => tool.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, Math.min(Number(limit || 3), 8)));
}

function createMcpManifest() {
  return {
    name: 'poka-browser-ai-os',
    version: '0.1.0',
    description: 'Browser AI OS prototype with skills and MCP-style tool routing.',
    tools: listMcpTools().map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: {
        readOnlyHint: Boolean(tool.readOnly),
        destructiveHint: false,
        idempotentHint: tool.method === 'GET',
        openWorldHint: tool.name.includes('search'),
      },
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'User request text used to route or execute the tool.',
          },
        },
      },
    })),
  };
}

function formatMcpContext(tools) {
  if (!tools || !tools.length) return '';
  return [
    'MCP候補ツール:',
    ...tools.map((tool) => `- ${tool.name}: ${tool.description} (${tool.method} ${tool.endpoint})`),
  ].join('\n');
}

module.exports = {
  createMcpManifest,
  formatMcpContext,
  listMcpTools,
  loadMcpServers,
  matchMcpTools,
};

#!/usr/bin/env node
/**
 * THRYX MCP Server — Model Context Protocol interface for ThryxProtocol
 *
 * Wraps the existing toolkit scripts (scripts/toolkit/) so any AI agent
 * can launch tokens, buy, sell, claim fees, check info, and scan portfolios
 * on ThryxProtocol v2.4 Diamond (Base mainnet).
 *
 * Each tool spawns the corresponding CLI script as a child process with
 * --json --execute flags, parses stdout, and returns structured results.
 *
 * Transports:
 *   stdio  — for local Claude Desktop / Claude Code integration (default)
 *   http   — for remote access (--http <port>)
 *
 * Smithery hosted runtime:
 *   Exports default factory function, configSchema, and createSandboxServer
 *   per @smithery/sdk ServerModule spec.
 *
 * Usage:
 *   node mcp-server/index.js              # stdio mode (default)
 *   node mcp-server/index.js --http 3100  # HTTP mode on port 3100
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools.js';
import { z } from 'zod';

// ── Smithery ServerModule exports ────────────────────────────────────

/** Config schema — private key is optional (read-only tools work without it) */
export const configSchema = z.object({
  PRIVATE_KEY: z.string().optional().describe(
    'Your wallet private key (optional). Needed for write tools (launch, buy, sell, claim). Gasless launches sign with your key but need no ETH — relay pays gas. Read tools work without it.'
  ),
});

/** Smithery hosted runtime factory — default export per ServerModule spec */
export default async function createServer(context) {
  // Inject config into env so toolkit scripts can access it
  // Accept PRIVATE_KEY from user config, map to internal env var for toolkit scripts
  const key = context?.config?.PRIVATE_KEY || process.env.PRIVATE_KEY || process.env.THRYXTREASURY_PRIVATE_KEY;
  if (key) {
    process.env.THRYXTREASURY_PRIVATE_KEY = key;
  }

  const server = new McpServer({
    name: 'thryx-protocol',
    version: '1.2.0',
    description: 'ThryxProtocol v2.4 Diamond — The AI Agent Launchpad on Base. Launch tokens, buy/sell with ETH, gasless metaLaunch, paymaster-sponsored gas. Zero cost launches, 0.5% swap fees, bonding curve to AMM graduation.',
  });
  registerAllTools(server);
  return server;
}

/** Smithery deployment scanning — lightweight server with tools registered, no transport */
export function createSandboxServer() {
  const sandbox = new McpServer({
    name: 'thryx-protocol',
    version: '1.2.0',
    description: 'ThryxProtocol v2.4 Diamond — The AI Agent Launchpad on Base.',
  });
  registerAllTools(sandbox);
  return sandbox;
}

/** Not stateful — each request is independent */
export const stateful = false;

// ── CLI entrypoint (direct node invocation) ──────────────────────────

const isCLI = process.argv[1] && (
  process.argv[1].endsWith('index.js') ||
  process.argv[1].endsWith('thryx-mcp')
);

if (isCLI) {
  const args = process.argv.slice(2);
  const httpFlag = args.indexOf('--http');
  const httpPort = httpFlag >= 0 ? parseInt(args[httpFlag + 1] || '3100', 10) : null;

  const server = await createServer({});

  if (httpPort) {
    const { startHttpServer } = await import('./http.js');
    await startHttpServer(server, httpPort);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

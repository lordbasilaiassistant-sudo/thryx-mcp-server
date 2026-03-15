#!/usr/bin/env node
/**
 * THRYX MCP Server — Model Context Protocol interface for ThryxProtocol
 *
 * Wraps the existing toolkit scripts (scripts/toolkit/) so any AI agent
 * can launch tokens, buy, sell, claim fees, check info, and scan portfolios
 * on ThryxProtocol v2.1 (Base mainnet).
 *
 * Each tool spawns the corresponding CLI script as a child process with
 * --json --execute flags, parses stdout, and returns structured results.
 *
 * Transports:
 *   stdio  — for local Claude Desktop / Claude Code integration (default)
 *   http   — for remote access (--http <port>)
 *
 * Usage:
 *   node mcp-server/index.js              # stdio mode (default)
 *   node mcp-server/index.js --http 3100  # HTTP mode on port 3100
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAllTools } from './tools.js';

const args = process.argv.slice(2);
const httpFlag = args.indexOf('--http');
const httpPort = httpFlag >= 0 ? parseInt(args[httpFlag + 1] || '3100', 10) : null;

const server = new McpServer({
  name: 'thryx-protocol',
  version: '1.0.1',
  description: 'ThryxProtocol v2.4 Diamond — The AI Agent Launchpad on Base. Launch tokens, trade, claim fees, check stats. Zero cost launches, 0.5% swap fees, bonding curve to AMM graduation.',
});

registerAllTools(server);

// Smithery sandbox scanning — returns a server with tools registered but no transport
export function createSandboxServer() {
  const sandbox = new McpServer({
    name: 'thryx-protocol',
    version: '1.0.1',
    description: 'ThryxProtocol v2.4 Diamond — The AI Agent Launchpad on Base.',
  });
  registerAllTools(sandbox);
  return sandbox;
}

async function main() {
  if (httpPort) {
    const { startHttpServer } = await import('./http.js');
    await startHttpServer(server, httpPort);
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

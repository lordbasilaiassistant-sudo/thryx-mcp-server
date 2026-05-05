#!/usr/bin/env node
/**
 * THRYX MCP Server v1.5.0 — entrypoint.
 *
 * Thin MCP wrapper around the launchpad's REST API at https://thryx.fun.
 * Every tool is one HTTP fetch against a verified endpoint — no local
 * signing, no ethers.js, no toolkit-script dependencies.
 *
 * First-run flow:
 *   1. If THRYX_API_KEY env var is set → use it.
 *   2. Else, look for ~/.thryx-mcp/credentials.json.
 *   3. Else, POST /api/agent/register, save the returned key+wallet
 *      to that file (mode 0600 on POSIX), and use it.
 *
 * Transports:
 *   stdio (default)            — node index.js
 *   http  (Smithery / remote)  — node index.js --http <port>
 *
 * Smithery hosted runtime: exports default factory + configSchema +
 * createSandboxServer per @smithery/sdk ServerModule.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { registerAllTools, makeContext } from './tools.js';

const PKG_VERSION = '1.5.0';
const DEFAULT_BASE_URL = 'https://thryx.fun';

// ── Credentials persistence ────────────────────────────────────────────

function credentialsPath() {
  return path.join(os.homedir(), '.thryx-mcp', 'credentials.json');
}

function loadStoredCredentials() {
  try {
    const raw = fs.readFileSync(credentialsPath(), 'utf8');
    const obj = JSON.parse(raw);
    if (typeof obj?.apiKey === 'string' && obj.apiKey.startsWith('thryx_')) return obj;
  } catch { /* file missing or unreadable — fall through */ }
  return null;
}

function saveCredentials(creds) {
  const p = credentialsPath();
  const dir = path.dirname(p);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(creds, null, 2), { encoding: 'utf8' });
    if (process.platform !== 'win32') {
      try { fs.chmodSync(p, 0o600); } catch { /* best-effort on POSIX */ }
    }
  } catch (err) {
    // Non-fatal: if we can't persist, the key is still usable for this run.
    process.stderr.write(`[thryx-mcp] WARNING: could not save credentials to ${p}: ${err.message}\n`);
  }
}

async function autoRegister(baseUrl) {
  const url = `${baseUrl}/api/agent/register`;
  const body = JSON.stringify({ name: `mcp-${process.pid}-${Date.now().toString(36)}` });
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
  } catch (netErr) {
    throw new Error(`Could not reach ${url}: ${netErr.message}`);
  }
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { _raw: text.slice(0, 200) }; }
  if (!res.ok || !parsed?.apiKey) {
    throw new Error(`Auto-register failed (HTTP ${res.status}): ${parsed?.error || text.slice(0, 200)}`);
  }
  return {
    apiKey: parsed.apiKey,
    wallet: parsed.wallet,
    registeredAt: new Date().toISOString(),
    baseUrl,
  };
}

/**
 * Resolve the API key to use for this MCP session.
 * Priority: explicit config / env > stored creds file > auto-register (only when allowed).
 */
async function resolveCredentials({ explicitKey, baseUrl, autoRegisterAllowed }) {
  if (explicitKey && explicitKey.startsWith('thryx_')) return { apiKey: explicitKey, source: 'env-or-config' };

  const stored = loadStoredCredentials();
  if (stored?.apiKey) return { apiKey: stored.apiKey, wallet: stored.wallet, source: 'stored-file' };

  if (!autoRegisterAllowed) return { apiKey: null, source: 'no-key-no-auto-register' };

  try {
    const fresh = await autoRegister(baseUrl);
    saveCredentials(fresh);
    process.stderr.write(`[thryx-mcp] Auto-registered fresh wallet ${fresh.wallet}. API key saved to ${credentialsPath()}.\n`);
    process.stderr.write('[thryx-mcp] To reuse across machines, copy the credentials file or set THRYX_API_KEY in your env.\n');
    return { apiKey: fresh.apiKey, wallet: fresh.wallet, source: 'auto-registered' };
  } catch (err) {
    process.stderr.write(`[thryx-mcp] Auto-register failed: ${err.message}\n`);
    process.stderr.write('[thryx-mcp] Read tools will still work; write tools will fail until you set THRYX_API_KEY.\n');
    return { apiKey: null, source: `auto-register-failed: ${err.message}` };
  }
}

// ── Smithery ServerModule exports ──────────────────────────────────────

export const configSchema = z.object({
  THRYX_API_KEY: z.string().optional().describe(
    'Your THRYX API key (starts with thryx_). Get one for free with `curl -X POST https://thryx.fun/api/agent/register`. If unset, the package will auto-register a fresh wallet on first run.',
  ),
  THRYX_BASE_URL: z.string().url().optional().describe(
    'Override the launchpad base URL. Defaults to https://thryx.fun.',
  ),
});

export default async function createServer(context) {
  const explicitKey = context?.config?.THRYX_API_KEY || process.env.THRYX_API_KEY;
  const baseUrl = context?.config?.THRYX_BASE_URL || process.env.THRYX_BASE_URL || DEFAULT_BASE_URL;

  // Smithery hosted runs are stateless and have no home dir to persist
  // credentials to — disable auto-register there to avoid creating
  // disposable wallets per request. CLI runs auto-register by default.
  const autoRegisterAllowed = !context?._smithery && !process.env.THRYX_DISABLE_AUTO_REGISTER;

  const creds = await resolveCredentials({ explicitKey, baseUrl, autoRegisterAllowed });
  const ctx = makeContext({ apiKey: creds.apiKey, baseUrl });

  const server = new McpServer({
    name: 'thryx-protocol',
    version: PKG_VERSION,
    description:
      'ThryxProtocol v3.1 Diamond on Base — gasless AI agent launchpad + trading platform. ' +
      '21 tools wrapping the thryx.fun HTTP API. Server-managed wallets, paymaster gas, ' +
      'free LLM-driven autotrader. No private keys, no signing, no API bills. ' +
      'Auto-registers on first run if THRYX_API_KEY is unset.',
  });
  registerAllTools(server, ctx);
  return server;
}

export function createSandboxServer() {
  const server = new McpServer({
    name: 'thryx-protocol',
    version: PKG_VERSION,
    description: 'ThryxProtocol v3.1 — gasless AI agent launchpad + trading platform on Base.',
  });
  registerAllTools(server, makeContext({ apiKey: null, baseUrl: DEFAULT_BASE_URL }));
  return server;
}

export const stateful = false;

// ── CLI entrypoint ─────────────────────────────────────────────────────

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

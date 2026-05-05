#!/usr/bin/env node
/**
 * v1.5.0 smoke test. Drives the MCP server over real stdio JSON-RPC.
 * No mainnet writes. Verifies:
 *   - server boots, advertises name + version
 *   - tools/list returns exactly 21 named thryx_*
 *   - every read tool returns specific expected fields (not just "valid JSON")
 *   - write tools are registered with correct schemas (no invocation)
 *
 * Usage:
 *   THRYX_API_KEY=thryx_xxx node smoke-test.js
 *
 * If THRYX_API_KEY is unset, balance/portfolio will be skipped instead of
 * exercising the auto-register path during a smoke run.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const APIKEY = process.env.THRYX_API_KEY || '';
const SKIP_AUTH_TOOLS = !APIKEY;

const env = { ...process.env };
if (!APIKEY) env.THRYX_DISABLE_AUTO_REGISTER = '1';

const child = spawn(process.execPath, ['index.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env,
});

let buf = '';
const pending = new Map();
let nextId = 1;
const stderrLines = [];

child.stderr.on('data', (d) => stderrLines.push(d.toString()));
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        const { resolve } = pending.get(msg.id);
        pending.delete(msg.id);
        resolve(msg);
      }
    } catch { /* not a JSON-RPC frame */ }
  }
});

function rpc(method, params, timeoutMs = 20000) {
  const id = nextId++;
  const frame = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve: (m) => { clearTimeout(t); resolve(m); } });
    child.stdin.write(frame);
  });
}

const results = [];
function record(name, status, detail) {
  results.push({ name, status, detail });
  const tag = status === 'ok' ? 'OK  ' : status === 'warn' ? 'WARN' : status === 'skip' ? 'SKIP' : 'FAIL';
  const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 200);
  process.stderr.write(`[${tag}] ${name}: ${detailStr}\n`);
}

async function callTool(name, args) {
  try {
    const r = await rpc('tools/call', { name, arguments: args }, 25000);
    if (r.error) return { error: r.error.message };
    const content = r.result?.content;
    const text = Array.isArray(content) ? content.map(c => c.text || '').join('') : '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { text, parsed, isError: !!r.result?.isError };
  } catch (e) {
    return { error: e.message };
  }
}

function expectFields(name, parsed, fields) {
  if (!parsed) return record(name, 'fail', 'response not JSON');
  for (const f of fields) {
    const segs = f.split('.');
    let cur = parsed;
    for (const seg of segs) { cur = cur?.[seg]; if (cur === undefined) break; }
    if (cur === undefined) return record(name, 'fail', `missing field "${f}"`);
  }
  record(name, 'ok', `${fields.length} expected fields present`);
}

async function main() {
  // ── initialize handshake ────────────────────────────────────────
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'thryx-mcp-smoke', version: '1.0' },
  });
  if (init.error) { record('initialize', 'fail', init.error.message); return finish(); }
  const server = init.result?.serverInfo || {};
  if (server.name !== 'thryx-protocol') {
    record('initialize.name', 'fail', `expected thryx-protocol, got ${server.name}`);
  } else { record('initialize.name', 'ok', server.name); }
  if (server.version !== '1.5.0') {
    record('initialize.version', 'fail', `expected 1.5.0, got ${server.version}`);
  } else { record('initialize.version', 'ok', server.version); }

  await rpc('notifications/initialized', {}).catch(() => {});

  // ── tools/list ──────────────────────────────────────────────────
  const list = await rpc('tools/list', {});
  const tools = list.result?.tools || [];
  const names = tools.map(t => t.name).sort();
  const expected = [
    'thryx_about', 'thryx_balance', 'thryx_buy', 'thryx_claim', 'thryx_claim_referral',
    'thryx_graduating', 'thryx_info', 'thryx_launch', 'thryx_leaderboard', 'thryx_paymaster_stats',
    'thryx_portfolio', 'thryx_protocol_params', 'thryx_recent_tokens', 'thryx_rug_check',
    'thryx_safety_score', 'thryx_search', 'thryx_sell', 'thryx_set_referrer', 'thryx_stats_v2',
    'thryx_token_of_day', 'thryx_trending',
  ].sort();
  if (names.length !== 21) record('tools/list.count', 'fail', `expected 21, got ${names.length}`);
  else record('tools/list.count', 'ok', '21 tools');
  const missing = expected.filter(n => !names.includes(n));
  const extra = names.filter(n => !expected.includes(n));
  if (missing.length || extra.length) {
    record('tools/list.naming', 'fail', `missing=${missing.join(',') || 'none'} extra=${extra.join(',') || 'none'}`);
  } else { record('tools/list.naming', 'ok', 'matches expected set'); }

  // ── READ tools (no key required) ────────────────────────────────
  const SPEED = '0xb319FE7314ba1634B75dD831abC8f3cb8aeE87A3';
  const TPV31 = '0x86baAbd8ebfb28164297B3fc10F4e2d8ea987d9D';

  let r;
  r = await callTool('thryx_about', {});
  expectFields('thryx_about', r.parsed, ['diamond', 'agentSurfaces', 'mcpVersion']);

  r = await callTool('thryx_info', { token: SPEED });
  expectFields('thryx_info', r.parsed, ['address', 'symbol', 'spotPrice', 'tradeCount']);

  r = await callTool('thryx_info', { token: TPV31 });
  expectFields('thryx_info.v4native', r.parsed, ['address', 'symbol', 'isV4Native', 'priceUsd']);

  r = await callTool('thryx_safety_score', { token: SPEED });
  expectFields('thryx_safety_score', r.parsed, ['token', 'symbol', 'healthScore']);

  r = await callTool('thryx_rug_check', { token: SPEED });
  expectFields('thryx_rug_check', r.parsed, ['token', 'deployer', 'feeBps', 'notes']);

  r = await callTool('thryx_recent_tokens', { limit: 3 });
  expectFields('thryx_recent_tokens', r.parsed, ['count', 'tokens']);

  r = await callTool('thryx_search', { query: 'SPEED' });
  expectFields('thryx_search', r.parsed, ['count', 'tokens']);

  r = await callTool('thryx_trending', { limit: 3 });
  expectFields('thryx_trending', r.parsed, ['count', 'tokens']);

  r = await callTool('thryx_graduating', { limit: 3 });
  expectFields('thryx_graduating', r.parsed, ['count', 'tokens']);

  r = await callTool('thryx_leaderboard', { range: '7d' });
  expectFields('thryx_leaderboard', r.parsed, ['traders', 'creators', 'period']);

  r = await callTool('thryx_token_of_day', {});
  expectFields('thryx_token_of_day', r.parsed, ['token']);

  r = await callTool('thryx_paymaster_stats', {});
  expectFields('thryx_paymaster_stats', r.parsed, ['paymaster', 'rpc']);

  r = await callTool('thryx_stats_v2', {});
  expectFields('thryx_stats_v2', r.parsed, ['tokens', 'users', 'trades', 'thryxPrice']);

  r = await callTool('thryx_protocol_params', {});
  expectFields('thryx_protocol_params', r.parsed, ['feeBps', 'creatorFeeSplit', 'graduationThreshold', 'ethRate']);

  // ── auth-required reads ────────────────────────────────────────
  if (SKIP_AUTH_TOOLS) {
    record('thryx_balance', 'skip', 'no THRYX_API_KEY in env — skipping auth tools');
    record('thryx_portfolio', 'skip', 'no THRYX_API_KEY in env — skipping auth tools');
  } else {
    r = await callTool('thryx_balance', {});
    expectFields('thryx_balance', r.parsed, ['agent', 'balance', 'stats']);
    r = await callTool('thryx_portfolio', {});
    if (r.parsed) record('thryx_portfolio', 'ok', `${(r.text || '').length} chars`);
    else record('thryx_portfolio', r.isError ? 'warn' : 'fail', r.error || 'no JSON');
  }

  // ── WRITE tools — schema check only, no invocation ─────────────
  const writeTools = ['thryx_launch', 'thryx_buy', 'thryx_sell', 'thryx_claim', 'thryx_set_referrer', 'thryx_claim_referral'];
  for (const t of writeTools) {
    const def = tools.find(x => x.name === t);
    if (!def) record(`schema.${t}`, 'fail', 'tool not registered');
    else if (!def.inputSchema) record(`schema.${t}`, 'fail', 'no inputSchema');
    else record(`schema.${t}`, 'ok', `properties=${Object.keys(def.inputSchema?.properties || {}).join(',')}`);
  }

  finish();
}

function finish() {
  const total = results.length;
  const okCount = results.filter(r => r.status === 'ok').length;
  const failCount = results.filter(r => r.status === 'fail').length;
  const warnCount = results.filter(r => r.status === 'warn').length;
  const skipCount = results.filter(r => r.status === 'skip').length;

  process.stderr.write(`\n=== SMOKE SUMMARY === ok=${okCount} fail=${failCount} warn=${warnCount} skip=${skipCount} total=${total}\n`);

  const lines = [];
  lines.push('# THRYX MCP Server v1.5.0 — Smoke Test Report');
  lines.push('');
  lines.push(`Date: ${new Date().toISOString()}`);
  lines.push('Package: @thryx/mcp-server@1.5.0 (LOCAL SOURCE — NOT PUBLISHED)');
  lines.push('Transport: stdio (real JSON-RPC frames over child stdin/stdout)');
  lines.push(`Auth: ${SKIP_AUTH_TOOLS ? 'NO key (auth tools skipped, auto-register disabled)' : 'X-API-Key set, auth tools exercised'}`);
  lines.push('Mainnet writes: NONE attempted. Write tools schema-checked only.');
  lines.push('');
  lines.push(`## Verdict: ${failCount === 0 ? 'GREEN — ready for publish gate' : 'HOLD — failures present'}`);
  lines.push('');
  lines.push(`Pass: ${okCount} | Fail: ${failCount} | Warn: ${warnCount} | Skip: ${skipCount} | Total: ${total}`);
  lines.push('');
  lines.push('## Detail');
  lines.push('| Check | Status | Detail |');
  lines.push('|---|---|---|');
  for (const r of results) {
    const detail = (typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)).replace(/\|/g, '\\|');
    lines.push(`| ${r.name} | ${r.status.toUpperCase()} | ${detail} |`);
  }
  lines.push('');
  lines.push('## Stderr (server boot output)');
  lines.push('```');
  lines.push(stderrLines.join('').slice(0, 4000));
  lines.push('```');

  writeFileSync('SMOKE_TEST_REPORT.md', lines.join('\n'));
  process.stderr.write('Report written to SMOKE_TEST_REPORT.md\n');

  child.kill();
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`smoke fatal: ${e.message}\n`);
  child.kill();
  process.exit(2);
});

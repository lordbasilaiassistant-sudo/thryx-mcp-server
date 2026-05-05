/**
 * THRYX MCP Server v1.5.0 — tool registrations.
 *
 * v1.5.0 is a thin HTTP wrapper around the launchpad's REST API at
 * https://thryx.fun/api/*. No local signing, no ethers.js, no toolkit
 * scripts. Every tool is one fetch() against a verified endpoint.
 *
 * Auth: X-API-Key. The user provides THRYX_API_KEY (env var or via
 * MCP config). If missing, index.js auto-registers a fresh wallet on
 * first init and persists the key to ~/.thryx-mcp/credentials.json.
 *
 * 21 tools registered:
 *   READ (15):  about, balance, portfolio, info, safety_score, rug_check,
 *               recent_tokens, search, trending, graduating, leaderboard,
 *               token_of_day, paymaster_stats, stats_v2, protocol_params
 *   WRITE  (6): launch, buy, sell, claim, set_referrer, claim_referral
 *
 * Every endpoint was hand-verified against the live launchpad on
 * 2026-05-05 — see SMOKE_TEST_REPORT.md for the matrix.
 */
import { z } from 'zod';

const DEFAULT_BASE_URL = 'https://thryx.fun';

/**
 * Build the runtime context once per server instance.
 * `apiKey` may be null if the user has no key and auto-register is
 * disabled — read tools still work, write tools return a clear error.
 */
export function makeContext({ apiKey = null, baseUrl = DEFAULT_BASE_URL } = {}) {
  return { apiKey, baseUrl };
}

// ── HTTP helpers ───────────────────────────────────────────────────────

async function thryxFetch(ctx, path, init = {}) {
  const url = `${ctx.baseUrl}${path}`;
  const headers = { Accept: 'application/json', ...(init.headers || {}) };
  if (ctx.apiKey && !headers['X-API-Key']) headers['X-API-Key'] = ctx.apiKey;
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (netErr) {
    throw new Error(`Network error reaching ${url}: ${netErr.message}`);
  }
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { _raw: text.slice(0, 400) }; }
  if (!res.ok) {
    const msg = body?.error || body?.message || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message, hint) {
  const payload = { success: false, error: message };
  if (hint) payload.hint = hint;
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
}

function requireKey(ctx) {
  if (!ctx.apiKey) {
    return fail(
      'No THRYX_API_KEY configured.',
      'Set THRYX_API_KEY env var, or run with auto-register enabled (default in CLI mode). See https://thryx.fun/api/agent/register.',
    );
  }
  return null;
}

// ── Tool registrations ─────────────────────────────────────────────────

export function registerAllTools(server, ctx) {
  // -----------------------------------------------------------------
  // READ — protocol meta
  // -----------------------------------------------------------------
  server.tool(
    'thryx_about',
    'Protocol overview: Diamond address, chain, agent surfaces, doc links. Always available, no key required. Start here when an agent first connects.',
    {},
    async () => {
      try {
        const data = await thryxFetch(ctx, '/api/agent/about');
        return ok({
          ...data,
          mcpVersion: '1.5.0',
          tooling: 'Every tool below wraps a verified HTTPS endpoint at thryx.fun/api/*.',
        });
      } catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_balance',
    'Your wallet balance — ETH, THRYX, total value, and a recommended next-action. Requires THRYX_API_KEY. Equivalent to GET /api/agent/home.',
    {},
    async () => {
      const k = requireKey(ctx); if (k) return k;
      try { return ok(await thryxFetch(ctx, '/api/agent/home')); }
      catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_portfolio',
    'Full portfolio scan for your wallet — every token holding with live prices and PnL. Requires THRYX_API_KEY. Heavier than thryx_balance; call when you need per-token detail.',
    {},
    async () => {
      const k = requireKey(ctx); if (k) return k;
      try {
        // /api/agent/home returns the wallet; /api/portfolio/:address has full PnL.
        const home = await thryxFetch(ctx, '/api/agent/home');
        const wallet = home?.agent?.wallet;
        if (!wallet) return fail('Could not resolve wallet from agent home endpoint', 'API key may have been revoked. Re-register at POST /api/agent/register.');
        const portfolio = await thryxFetch(ctx, `/api/portfolio/${wallet}`);
        return ok(portfolio);
      } catch (e) { return fail(e.message); }
    },
  );

  // -----------------------------------------------------------------
  // READ — token discovery
  // -----------------------------------------------------------------
  server.tool(
    'thryx_info',
    'Detailed info for a single token: price, supply, raised, fees, graduation status, V4-native flag, healthScore. No key required.',
    { token: z.string().describe('Token contract address — 0x-prefixed 40-char hex.') },
    async ({ token }) => {
      try { return ok(await thryxFetch(ctx, `/api/tokens/${token}`)); }
      catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_safety_score',
    'Token safety score (0–100, higher is safer). Computed by the launchpad from on-chain liquidity, holder distribution, deployer history, and trading patterns. Reads the healthScore field from the token detail endpoint.',
    { token: z.string().describe('Token contract address.') },
    async ({ token }) => {
      try {
        const t = await thryxFetch(ctx, `/api/tokens/${token}`);
        return ok({
          token: t.address,
          symbol: t.symbol,
          healthScore: t.healthScore ?? null,
          graduated: !!t.graduated,
          isV4Native: !!t.isV4Native,
          tradeCount: t.tradeCount,
          progressBps: t.progressBps,
        });
      } catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_rug_check',
    'Rug-risk indicators for a token: deployer address, graduated status, trade count, anti-sniper window, fee tier. Uses the same token detail endpoint as thryx_info, surfacing the fields a rug check cares about.',
    { token: z.string().describe('Token contract address.') },
    async ({ token }) => {
      try {
        const t = await thryxFetch(ctx, `/api/tokens/${token}`);
        const launchSec = t.v4NativeLaunchTime || 0;
        const nowSec = Math.floor(Date.now() / 1000);
        const antiSniperSecsLeft = launchSec > 0 ? Math.max(0, (launchSec + 60) - nowSec) : 0;
        return ok({
          token: t.address,
          symbol: t.symbol,
          deployer: t.deployer,
          deployerUsername: t.deployerUsername || null,
          graduated: !!t.graduated,
          isV4Native: !!t.isV4Native,
          antiSniperSecsLeft,
          feeBps: t.feeBps,
          tradeCount: t.tradeCount,
          progressBps: t.progressBps,
          healthScore: t.healthScore ?? null,
          notes: [
            t.feeBps === 100 ? 'Fee 1% (post-2026-04-26 default)' : t.feeBps === 50 ? 'Fee 0.5% (legacy grandfathered)' : `Fee ${t.feeBps}bps`,
            antiSniperSecsLeft > 0 ? `Anti-sniper window active — fee decays from 80% to 1% over the next ${antiSniperSecsLeft}s.` : 'Anti-sniper window cleared (or not V4-native).',
          ],
        });
      } catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_recent_tokens',
    'Most recently launched tokens. No key required. Sorted newest-first.',
    {
      limit: z.number().int().min(1).max(50).default(10).describe('How many to return. 1–50, default 10.'),
    },
    async ({ limit = 10 }) => {
      try {
        const data = await thryxFetch(ctx, `/api/tokens?sort=newest&limit=${limit}`);
        return ok({ count: (data.tokens || []).length, tokens: data.tokens || [] });
      } catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_search',
    'Search tokens by name, symbol, or address.',
    {
      query: z.string().min(1).describe('Search query — name fragment, symbol, or address.'),
    },
    async ({ query }) => {
      try {
        const data = await thryxFetch(ctx, `/api/tokens/search?q=${encodeURIComponent(query)}`);
        return ok({ count: (data.tokens || []).length, tokens: data.tokens || [] });
      } catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_trending',
    'Tokens with the most trading activity in the last 6 hours. Top conviction signals.',
    {
      limit: z.number().int().min(1).max(20).default(10).describe('How many to return. 1–20, default 10.'),
    },
    async ({ limit = 10 }) => {
      try {
        const data = await thryxFetch(ctx, `/api/tokens/trending?limit=${limit}`);
        return ok({ count: (data.trending || []).length, tokens: data.trending || [] });
      } catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_graduating',
    'Tokens closest to graduation (250M THRYX raised → migrates to Uniswap V4). High-conviction late-stage curve plays.',
    {
      limit: z.number().int().min(1).max(20).default(10).describe('How many to return. 1–20, default 10.'),
    },
    async ({ limit = 10 }) => {
      try {
        const data = await thryxFetch(ctx, `/api/tokens/graduating?limit=${limit}`);
        return ok({
          count: (data.tokens || []).length,
          threshold: data.threshold ?? null,
          tokens: data.tokens || [],
        });
      } catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_leaderboard',
    'Top traders by volume + top creators by fees earned. Range: 24h | 7d | 30d.',
    {
      range: z.enum(['24h', '7d', '30d']).default('7d').describe('Time window.'),
    },
    async ({ range = '7d' }) => {
      try { return ok(await thryxFetch(ctx, `/api/leaderboard?range=${range}`)); }
      catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_token_of_day',
    'The currently-featured token of the day, picked by the platform algorithm.',
    {},
    async () => {
      try { return ok(await thryxFetch(ctx, '/api/token-of-the-day')); }
      catch (e) { return fail(e.message); }
    },
  );

  // -----------------------------------------------------------------
  // READ — protocol stats / health
  // -----------------------------------------------------------------
  server.tool(
    'thryx_paymaster_stats',
    'Live paymaster state — sponsored ETH balance, THRYX reserves, capacity. Pulled from /api/status.',
    {},
    async () => {
      try {
        const status = await thryxFetch(ctx, '/api/status');
        return ok({
          paymaster: status.checks?.paymaster ?? status.checks?.relay?.paymaster ?? null,
          relay: status.checks?.relay ?? null,
          rpc: status.checks?.rpc ?? null,
          protocol: status.checks?.protocol ?? null,
        });
      } catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_stats_v2',
    'Platform-wide stats: total tokens, users, trades, ETH/THRYX prices, reserves, lifetime fees, reward pool. Pulled from /api/stats.',
    {},
    async () => {
      try { return ok(await thryxFetch(ctx, '/api/stats')); }
      catch (e) { return fail(e.message); }
    },
  );

  server.tool(
    'thryx_protocol_params',
    'Live protocol params: fee in basis points, creator fee split, graduation threshold, ETH/THRYX exchange rate, total launched, total graduated. Pulled from /api/protocol-params.',
    {},
    async () => {
      try { return ok(await thryxFetch(ctx, '/api/protocol-params')); }
      catch (e) { return fail(e.message); }
    },
  );

  // -----------------------------------------------------------------
  // WRITE — gasless on-chain ops via X-API-Key
  // -----------------------------------------------------------------
  server.tool(
    'thryx_launch',
    'Launch a new token on Base (gasless). The platform pays gas via paymaster. Returns tokenAddress + txHash. Requires THRYX_API_KEY. Image required (public URL or data: URL).',
    {
      name: z.string().min(1).max(64).describe('Display name, e.g. "My Agent Coin".'),
      symbol: z.string().min(1).max(12).describe('Ticker, 1–12 chars, will be uppercased.'),
      image: z.string().describe('Image URL (https:// public URL) or data: URL. PNG/JPEG/GIF/WebP, under 400KB.'),
      description: z.string().max(2000).optional(),
      twitter: z.string().url().optional(),
      telegram: z.string().url().optional(),
      website: z.string().url().optional(),
      article: z.string().optional().describe('Optional long-form article body, max ~10K chars.'),
    },
    async (args) => {
      const k = requireKey(ctx); if (k) return k;
      try {
        const data = await thryxFetch(ctx, '/api/launch', {
          method: 'POST',
          body: JSON.stringify(args),
        });
        return ok(data);
      } catch (e) { return fail(e.message, e.body?.hint); }
    },
  );

  server.tool(
    'thryx_buy',
    'Buy a token with ETH. Gasless via paymaster. Slippage protected. Requires THRYX_API_KEY and enough ETH in your wallet to cover the trade value (gas is sponsored separately).',
    {
      token: z.string().describe('Token contract address — 0x-prefixed 40-char hex.'),
      amount: z.string().describe('ETH amount as a decimal string, e.g. "0.0003".'),
      comment: z.string().max(280).optional().describe('Optional public comment to attach to the trade (max 280 chars).'),
    },
    async ({ token, amount, comment }) => {
      const k = requireKey(ctx); if (k) return k;
      try {
        const body = { amount };
        if (comment) body.comment = comment;
        const data = await thryxFetch(ctx, `/api/tokens/${token}/buy`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return ok(data);
      } catch (e) { return fail(e.message, e.body?.hint); }
    },
  );

  server.tool(
    'thryx_sell',
    'Sell a token for ETH. Gasless via paymaster. Routes through bonding curve OR V4 pool depending on graduation/V4-native status. Slippage protected.',
    {
      token: z.string().describe('Token contract address.'),
      amount: z.string().describe('Token quantity (not wei) as a decimal string, e.g. "1000000".'),
      comment: z.string().max(280).optional(),
    },
    async ({ token, amount, comment }) => {
      const k = requireKey(ctx); if (k) return k;
      try {
        const body = { amount };
        if (comment) body.comment = comment;
        const data = await thryxFetch(ctx, `/api/tokens/${token}/sell`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        return ok(data);
      } catch (e) { return fail(e.message, e.body?.hint); }
    },
  );

  server.tool(
    'thryx_claim',
    'Claim accumulated creator fees for a token you launched (70% of every swap fee accrues to the creator). Returns claimed amount + txHash. Requires THRYX_API_KEY and creator status.',
    {
      tokenAddress: z.string().describe('The token whose creator fees you want to claim.'),
    },
    async ({ tokenAddress }) => {
      const k = requireKey(ctx); if (k) return k;
      try {
        const data = await thryxFetch(ctx, '/api/claim/creator-fees', {
          method: 'POST',
          body: JSON.stringify({ tokenAddress }),
        });
        return ok(data);
      } catch (e) { return fail(e.message, e.body?.hint); }
    },
  );

  server.tool(
    'thryx_set_referrer',
    'Set a referrer wallet for your account. The referrer earns 5% of the protocol fee share on every trade you make.',
    {
      referrer: z.string().describe('Referrer wallet — 0x-prefixed 40-char hex.'),
    },
    async ({ referrer }) => {
      const k = requireKey(ctx); if (k) return k;
      try {
        const data = await thryxFetch(ctx, '/api/auth/set-referrer', {
          method: 'POST',
          body: JSON.stringify({ referrer }),
        });
        return ok(data);
      } catch (e) { return fail(e.message, e.body?.hint); }
    },
  );

  server.tool(
    'thryx_claim_referral',
    'Claim accumulated referral fees (5% of protocol fees on trades made by accounts you referred). No body required.',
    {},
    async () => {
      const k = requireKey(ctx); if (k) return k;
      try {
        const data = await thryxFetch(ctx, '/api/claim/referral-fees', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        return ok(data);
      } catch (e) { return fail(e.message, e.body?.hint); }
    },
  );
}

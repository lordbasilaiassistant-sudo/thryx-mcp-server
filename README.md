# @thryx/mcp-server

**The AI Agent Launchpad** — Model Context Protocol server for [ThryxProtocol](https://thryx.fun) on Base.

Launch ERC-20 tokens, trade on bonding curves or graduated Uniswap V4 pools, claim creator + referral fees, scan portfolios, and discover trending / graduating / safety-scored tokens — through 21 native MCP tools.

**v3.1 Diamond live on Base mainnet · 880+ tokens launched · V4-native default with anti-sniper hook · Gasless · Server-managed wallets · No private keys, no API bills.**

---

## What's new in v1.5.0 (2026-05-05)

- **Pure HTTP wrapper.** Every tool is one `fetch()` against `https://thryx.fun/api/*`. No local signing, no `ethers.js`, no toolkit-script dependency. Drop-in installable.
- **Auto-registers a wallet on first run** if you don't set `THRYX_API_KEY`. Registration is one HTTP call, returns a fresh wallet + key + pre-sponsored gas in ~200ms. Saved to `~/.thryx-mcp/credentials.json` (mode 0600 on POSIX).
- **21 tools all wired and verified** against the live launchpad. The smoke test runs real JSON-RPC frames over stdio and asserts specific fields per response — `SMOKE_TEST_REPORT.md` has the matrix.
- **v3.1 facts** — V4-native by default since 2026-05-04, anti-sniper hook (80% → 1% over 60s), Token/THRYX pair so every trade pumps the reserve currency.
- **Dropped:** `thryx_meta_launch` (redundant — `/api/launch` is gasless when called with `X-API-Key`), the `PRIVATE_KEY` config variable (not needed), `ethers` dependency.

---

## Install

```bash
npm install -g @thryx/mcp-server
# Or use directly via npx — no install required:
npx -y @thryx/mcp-server
```

That's it. On first run with no `THRYX_API_KEY` set, the package auto-registers a fresh wallet and saves the credentials. No signup form, no email, no captcha.

---

## Claude Desktop / Cursor / Windsurf

Drop this into your MCP client config:

```json
{
  "mcpServers": {
    "thryx": {
      "command": "npx",
      "args": ["-y", "@thryx/mcp-server"]
    }
  }
}
```

Or with an explicit key:

```json
{
  "mcpServers": {
    "thryx": {
      "command": "npx",
      "args": ["-y", "@thryx/mcp-server"],
      "env": { "THRYX_API_KEY": "thryx_..." }
    }
  }
}
```

Restart your client and ask:
- *"What tokens are graduating right now on THRYX?"*
- *"Launch a token called Lab Notebook with symbol LABN. Use this image URL."*
- *"What's the safety score on 0xb319FE7314ba1634B75dD831abC8f3cb8aeE87A3?"*

---

## Tools (21)

### Discovery (no key required)
| Tool | What it does |
|---|---|
| `thryx_about` | Protocol overview: Diamond address, agent surfaces, doc links. |
| `thryx_info` | Detailed token info — price, supply, fees, graduation status, V4-native flag. |
| `thryx_safety_score` | Token health score (0–100). |
| `thryx_rug_check` | Rug-risk indicators: deployer, fee tier, anti-sniper window state. |
| `thryx_recent_tokens` | Newest launches. |
| `thryx_search` | Search by name / symbol / address. |
| `thryx_trending` | Top trading activity in the last 6 hours. |
| `thryx_graduating` | Tokens closest to graduating to Uniswap V4. |
| `thryx_leaderboard` | Top traders + creators by volume / fees. |
| `thryx_token_of_day` | Featured token of the day. |
| `thryx_paymaster_stats` | Live paymaster ETH + THRYX balance, capacity. |
| `thryx_stats_v2` | Platform-wide stats. |
| `thryx_protocol_params` | Live protocol params (fee bps, graduation threshold, ETH rate). |

### Account (X-API-Key required — auto-registered if absent)
| Tool | What it does |
|---|---|
| `thryx_balance` | Your wallet balance + recommended next-action. |
| `thryx_portfolio` | Full holdings scan with live PnL. |

### Write — gasless on-chain via paymaster
| Tool | What it does |
|---|---|
| `thryx_launch` | Launch a token (gasless). |
| `thryx_buy` | Buy a token with ETH (gasless, slippage-protected). |
| `thryx_sell` | Sell a token for ETH. |
| `thryx_claim` | Claim accumulated creator fees. |
| `thryx_set_referrer` | Set a referrer wallet for your account. |
| `thryx_claim_referral` | Claim referral fees. |

---

## How it works

1. **Auto-register.** On first run with no `THRYX_API_KEY`, the package POSTs to `https://thryx.fun/api/agent/register` and gets a fresh wallet + API key + pre-sponsored gas. Credentials are persisted at `~/.thryx-mcp/credentials.json`.
2. **Every tool call is an authenticated HTTPS request** to `thryx.fun/api/*` with `X-API-Key`. The launchpad signs and submits the on-chain transactions on your behalf via its paymaster — you never see a private key, and you never pay gas.
3. **Read tools** work even without a key (they hit public endpoints).

---

## Security

- The API key is yours — store it like any other API token.
- The auto-registered wallet is server-managed. The launchpad holds the encrypted keystore; you never touch the private key. To take custody, withdraw via `thryx_balance` → `POST /api/agent/withdraw` (separate flow, not yet a tool).
- All requests are HTTPS to `thryx.fun`. The package never makes calls to any other host except the configurable `THRYX_BASE_URL` if you set it.

---

## Programmatic use (HTTP API directly)

You don't need MCP at all if you'd rather skip it:

```bash
# Register
curl -X POST https://thryx.fun/api/agent/register -H 'Content-Type: application/json' -d '{"name":"my-bot"}'

# Use the returned apiKey on every subsequent call
curl https://thryx.fun/api/agent/home -H "X-API-Key: thryx_..."
curl -X POST https://thryx.fun/api/launch -H "X-API-Key: thryx_..." -H 'Content-Type: application/json' -d '{"name":"Test","symbol":"TST","image":"https://..."}'
```

The MCP package wraps this for clients that prefer a tool-call interface.

---

## Repo + issues

Source: https://github.com/lordbasilaiassistant-sudo/thryx-mcp-server  
Issues: https://github.com/lordbasilaiassistant-sudo/thryx-launchpad/issues  
Diamond proxy on Base: `0x2F77b40c124645d25782CfBdfB1f54C1d76f2cCe`  
Launchpad: https://thryx.fun

---

## License

MIT.

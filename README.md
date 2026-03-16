# @thryx/mcp-server

**The AI Agent Launchpad** -- Model Context Protocol server for [ThryxProtocol](https://thryx.xyz) on Base.

Any AI agent (Claude, GPT, custom agents) can launch tokens, trade on bonding curves, claim fees, scan portfolios, and check token safety -- all through native MCP tools. Zero cost per launch (gas only, ~$0.01 on Base).

**150+ tokens launched across 4 protocol versions. Verified Diamond proxy on Base mainnet.**

**Early user bonus: First 10 new addresses that launch or trade automatically receive THRYX rewards. No claiming needed -- rewards arrive in your wallet instantly.**

---

## What's New (v1.1.0)

- **Gasless launches via metaLaunch()** -- sign a message, relay pays gas. Zero ETH needed to launch a token.
- **Simple buy()/sell() interface** -- send ETH to buy tokens, sell tokens to receive ETH. No need to acquire THRYX first.
- **Real THRYX volume** -- every buy/sell generates real THRYX volume on the V4 Doppler pool
- **Dynamic graduation threshold** -- ETH-denominated, auto-converts to THRYX at market rate
- **Paymaster gas sponsorship** -- paymaster contract holds ETH/THRYX to cover gas for new users
- **Relay** -- https://thryx-relay.thryx.workers.dev for gasless operations
- **4 new tools** -- thryx_meta_launch, thryx_paymaster_stats, plus updated thryx_buy/thryx_sell for ETH-native trading
- **17 total tools** -- up from 13

### Previous (v1.0.3)

- v2.4 Diamond proxy -- same address forever, verified on Basescan + Sourcify
- 0.5% swap fees -- lowest on Base. 70% creator / 30% protocol
- Auto-distributed fees -- creator fees paid instantly on every swap
- Per-token ETH reserves -- each token has isolated reserves, safer graduation
- Uniswap V4 graduation -- tokens graduate to V4 AMM
- Early user THRYX rewards -- first 10 new users automatically earn THRYX

---

## Quick Start

### npx (no install)

```bash
npx @thryx/mcp-server
```

### Global install

```bash
npm install -g @thryx/mcp-server
thryx-mcp
```

---

## Integration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thryx-protocol": {
      "command": "npx",
      "args": ["-y", "@thryx/mcp-server"],
      "env": {
        "THRYXTREASURY_PRIVATE_KEY": "your-private-key-here"
      }
    }
  }
}
```

### Claude Code

Add to `~/.claude/settings.json` or project `.mcp.json`:

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

### HTTP Mode (remote agents)

```bash
npx @thryx/mcp-server --http 3100
```

Endpoints:
- `POST /mcp` -- MCP protocol endpoint (Streamable HTTP)
- `GET /health` -- Health check

---

## Tools (17 total)

### Read Tools (no wallet needed)

| Tool | Description |
|------|-------------|
| `thryx_about` | Protocol overview: what ThryxProtocol is, how it works, gasless launches, buy/sell interface, relay, key addresses, available tools |
| `thryx_info` | Token details: bonding curve state, price, graduation progress, fees, vesting. Or protocol overview if no token specified |
| `thryx_balance` | Quick ETH + THRYX balance check for any wallet address |
| `thryx_portfolio` | Full portfolio scan across all wallets: token holdings, ETH balances, USD values via Blockscout + Multicall3 + DexScreener |
| `thryx_stats_v2` | Protocol-wide stats: total THRYX burned, graduation treasury collected |
| `thryx_safety_score` | Rate any ThryxProtocol token 0-100 on safety (vesting, liquidity, distribution, activity). Can score all deployed tokens at once |
| `thryx_rug_check` | Check ANY ERC20 on Base for rug signals: verification, honeypot, dangerous functions, ownership, liquidity, tax |
| `thryx_paymaster_stats` | Check paymaster ETH/THRYX balance and gas sponsorship capacity. Shows estimated launches/swaps remaining |

### Write Tools (wallet key required)

| Tool | Description |
|------|-------------|
| `thryx_launch` | Deploy a new token on the bonding curve. 1B supply, 80% curve / 15% graduation LP / 5% creator vested 90 days. Gas only (~$0.01) |
| `thryx_buy` | Buy tokens with ETH (default) or THRYX. Simple interface: send ETH, receive tokens. Protocol routes through V4 Doppler pool internally. 0.5% fee |
| `thryx_sell` | Sell tokens for ETH. Simple interface: send tokens, receive ETH. Falls back to universal routing for non-Diamond tokens. Partial-sell fallback (100% > 50% > 25% > 10%) |
| `thryx_meta_launch` | Gasless token launch via metaLaunch(). Returns EIP-712 signing data. Sign and POST to relay -- zero ETH needed |
| `thryx_claim` | Claim accumulated creator or protocol fees from a token. Auto-detects v2.4 Diamond vs legacy factory |
| `thryx_set_referrer` | Set a referrer address for a token. Referrer earns 5% of protocol fee share |
| `thryx_claim_referral` | Claim accumulated referral fees (THRYX) |

---

## Example Usage

### Launch a token

```
> Use thryx_launch to create a token called "Autonomous Agent Token" with symbol "AAT"
```

The agent calls `thryx_launch` with `name: "Autonomous Agent Token"` and `symbol: "AAT"`. Returns the token address, tx hash, and bonding curve details.

### Gasless launch (no ETH needed)

```
> Use thryx_meta_launch to create a gasless token called "Zero Gas Token" with symbol "ZGT"
```

Returns EIP-712 typed data to sign. Sign with your wallet, then POST the signature to the relay at `https://thryx-relay.thryx.workers.dev/meta-launch`. The relay submits the transaction and pays gas.

### Buy tokens with ETH

```
> Use thryx_buy with token 0x1234...abcd and amount "0.01"
```

Sends 0.01 ETH to buy tokens on the bonding curve. Protocol handles THRYX routing internally -- you just send ETH.

### Sell tokens for ETH

```
> Use thryx_sell with token 0x1234...abcd and amount "all"
```

Sells your entire token balance and returns ETH. Protocol handles THRYX routing internally.

### Check paymaster capacity

```
> Use thryx_paymaster_stats to check gas sponsorship status
```

Returns paymaster ETH/THRYX balances and estimated number of sponsored launches and swaps remaining.

### Check token safety

```
> Use thryx_rug_check to analyze 0x1234...abcd
```

Returns risk level (LOW/MEDIUM/HIGH/CRITICAL) with detailed analysis of contract verification, dangerous functions, ownership, liquidity, and honeypot indicators.

### Scan portfolio

```
> Use thryx_portfolio to scan all wallets
```

Discovers tokens via Blockscout, reads balances via Multicall3, prices via DexScreener. Returns a full breakdown by wallet.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `THRYXTREASURY_PRIVATE_KEY` | For write tools | Private key for the default wallet. Read tools work without it. |

Write tools (`thryx_launch`, `thryx_buy`, `thryx_sell`, `thryx_claim`, `thryx_set_referrer`, `thryx_claim_referral`) need wallet access. `thryx_meta_launch` only needs a wallet address (not private key) since signing happens client-side. Read tools (`thryx_info`, `thryx_balance`, `thryx_portfolio`, `thryx_stats_v2`, `thryx_safety_score`, `thryx_rug_check`, `thryx_paymaster_stats`, `thryx_about`) query Base mainnet RPC directly and require no configuration.

---

## How It Works

Every token launched through ThryxProtocol:

1. **Creates a bonding curve** -- virtual x*y=k curve paired with THRYX as the quote token
2. **Tradeable immediately** -- buy/sell with ETH via simple `buy()`/`sell()` functions, no DEX listing needed
3. **Generates real volume** -- every trade routes through the V4 Doppler pool, generating real THRYX volume
4. **Generates fees** -- 0.5% per swap (30% protocol, 70% creator). 20% of protocol fees are burned
5. **Graduates to AMM** -- at dynamic ETH-denominated threshold, migrates to Uniswap V4 with real liquidity
6. **Locks THRYX** -- every launch permanently locks THRYX in the bonding curve = scarcity

### v2.4 Diamond Features

- **Gasless launches** -- `metaLaunch()` lets users sign off-chain, relay pays gas. Zero ETH to launch.
- **Simple buy/sell** -- `buy(token)` with ETH, `sell(token, amount)` for ETH. Protocol handles THRYX routing internally.
- **Real THRYX volume** -- every trade generates real volume on the V4 Doppler pool
- **Dynamic graduation** -- ETH-denominated threshold auto-converts to THRYX at market rate
- **Paymaster gas sponsorship** -- paymaster contract sponsors gas for new users
- **Relay service** -- https://thryx-relay.thryx.workers.dev for gasless operations
- Auto-distribute creator fees in every swap (no claiming needed)
- 0.5% swap fees -- lowest on Base
- Per-token ETH reserves for safer graduation
- Per-token fee overrides for premium tokens
- Bonding curve hardening (minimum reserve floor, overflow protection)
- Same contract address forever via Diamond proxy (EIP-2535)
- Referral system: referrers earn 5% of protocol fee share
- 90-day linear vesting for creator tokens
- Mandatory 10% slippage floor
- 20% fee burn for deflationary THRYX pressure
- Loyalty rebates for ecosystem holders

---

## Network

| | |
|--|--|
| **Chain** | Base mainnet (Chain ID 8453) |
| **Protocol v2.4 Diamond** | `0x2F77b40c124645d25782CfBdfB1f54C1d76f2cCe` |
| **Protocol v2.2** | `0xcDC734c1AFC2822E0d7E332DC914c0a7311633bF` |
| **THRYX Token** | `0xc07E889e1816De2708BF718683e52150C20F3BA3` |
| **RPC** | `https://mainnet.base.org` |
| **Explorer** | [basescan.org](https://basescan.org) |

---

## Architecture

The MCP server wraps the ThryxProtocol CLI toolkit (`scripts/toolkit/`), spawning each script as a child process with `--json --execute` flags. This means the server inherits all routing logic, safety checks, and fallback behavior:

- NEVER_SELL guards for protected tokens
- Partial-sell fallback (100% > 50% > 25% > 10%)
- Multi-DEX aggregator routing (Odos, Kyberswap)
- Rate limiting and RPC rotation
- NonceManager for transaction safety

```
thryx_launch       -->  launch.js "Name" SYMBOL --wallet main --json --execute
thryx_buy          -->  buy.js <token> <amount> --with eth --wallet main --json --execute
thryx_sell         -->  swap-sell.js <token> all --wallet main --json --execute
thryx_claim        -->  claim.js <token> --wallet main --json --execute
thryx_info         -->  info.js [token] --json
thryx_meta_launch  -->  (self-contained: returns EIP-712 signing data for relay submission)
thryx_paymaster_stats  -->  (self-contained: reads paymaster balance via RPC)
```

---

## Related

- [npx thryx](https://www.npmjs.com/package/thryx) -- standalone CLI for one-command token deploys
- [ThryxProtocol](https://thryx.xyz) -- the launchpad protocol
- [THRYX on DexScreener](https://dexscreener.com/base/0xc07E889e1816De2708BF718683e52150C20F3BA3) -- live THRYX token chart

---

## License

MIT

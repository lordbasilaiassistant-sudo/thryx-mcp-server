# THRYX MCP Server v1.5.0 — Smoke Test Report

Date: 2026-05-05T14:51:44.942Z
Package: @thryx/mcp-server@1.5.0 (LOCAL SOURCE — NOT PUBLISHED)
Transport: stdio (real JSON-RPC frames over child stdin/stdout)
Auth: X-API-Key set, auth tools exercised
Mainnet writes: NONE attempted. Write tools schema-checked only.

## Verdict: GREEN — ready for publish gate

Pass: 26 | Fail: 0 | Warn: 0 | Skip: 0 | Total: 26

## Detail
| Check | Status | Detail |
|---|---|---|
| initialize.name | OK | thryx-protocol |
| initialize.version | OK | 1.5.0 |
| tools/list.count | OK | 21 tools |
| tools/list.naming | OK | matches expected set |
| thryx_about | OK | 3 expected fields present |
| thryx_info | OK | 4 expected fields present |
| thryx_info.v4native | OK | 4 expected fields present |
| thryx_safety_score | OK | 3 expected fields present |
| thryx_rug_check | OK | 4 expected fields present |
| thryx_recent_tokens | OK | 2 expected fields present |
| thryx_search | OK | 2 expected fields present |
| thryx_trending | OK | 2 expected fields present |
| thryx_graduating | OK | 2 expected fields present |
| thryx_leaderboard | OK | 3 expected fields present |
| thryx_token_of_day | OK | 1 expected fields present |
| thryx_paymaster_stats | OK | 2 expected fields present |
| thryx_stats_v2 | OK | 4 expected fields present |
| thryx_protocol_params | OK | 4 expected fields present |
| thryx_balance | OK | 3 expected fields present |
| thryx_portfolio | OK | 340 chars |
| schema.thryx_launch | OK | properties=name,symbol,image,description,twitter,telegram,website,article |
| schema.thryx_buy | OK | properties=token,amount,comment |
| schema.thryx_sell | OK | properties=token,amount,comment |
| schema.thryx_claim | OK | properties=tokenAddress |
| schema.thryx_set_referrer | OK | properties=referrer |
| schema.thryx_claim_referral | OK | properties= |

## Stderr (server boot output)
```

```
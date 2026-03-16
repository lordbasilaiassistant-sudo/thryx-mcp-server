/**
 * THRYX MCP Tool Definitions
 *
 * Each tool spawns the corresponding CLI script from scripts/toolkit/ as a
 * child process with --json and --execute flags. Stdout is parsed as JSON
 * and returned to the MCP client. Stderr is captured for diagnostics.
 *
 * Tools:
 *   READ  — thryx_info, thryx_portfolio, thryx_balance, thryx_stats_v2, thryx_paymaster_stats
 *   WRITE — thryx_launch, thryx_buy, thryx_sell, thryx_claim, thryx_set_referrer, thryx_claim_referral, thryx_meta_launch
 */
import { z } from 'zod';
import { execFile } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';

// ── Paths ──────────────────────────────────────────────────────────

let __dirnameResolved;
try { __dirnameResolved = dirname(fileURLToPath(import.meta.url)); } catch { __dirnameResolved = process.cwd(); }
const PROJECT_ROOT = resolve(__dirnameResolved, '..');
const TOOLKIT = resolve(PROJECT_ROOT, 'scripts', 'toolkit');

// ── Script Runner ──────────────────────────────────────────────────

/**
 * Run a toolkit script and return { stdout, stderr, exitCode }.
 * Throws on timeout (120s) or spawn failure.
 *
 * @param {string} script - Script filename inside scripts/toolkit/
 * @param {string[]} args - CLI arguments
 * @param {number} [timeoutMs=120000] - Max execution time
 */
function runScript(script, args = [], timeoutMs = 120_000) {
  const scriptPath = resolve(TOOLKIT, script);

  return new Promise((resolve, reject) => {
    const proc = execFile(
      'node',
      [scriptPath, ...args],
      {
        cwd: PROJECT_ROOT,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        env: { ...process.env },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const exitCode = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
          ? 1
          : (error?.code ?? 0);

        resolve({
          stdout: stdout?.trim() || '',
          stderr: stderr?.trim() || '',
          exitCode: typeof exitCode === 'number' ? exitCode : (error ? 1 : 0),
        });
      }
    );
  });
}

/**
 * Parse the last line of stdout as JSON (toolkit scripts output human text
 * to stderr in --json mode, and exactly one JSON line to stdout).
 */
function parseJsonOutput(stdout) {
  if (!stdout) return null;
  // The JSON line is typically the last non-empty line
  const lines = stdout.split('\n').filter(l => l.trim());
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') || line.startsWith('[')) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
  }
  return null;
}

// ── MCP Response Helpers ───────────────────────────────────────────

function ok(data) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: 'text', text }] };
}

/** Enrich a result with next actions and links so agents know what to do next */
function okEnriched(json, context) {
  const enriched = { ...json };
  if (context.nextActions) enriched.nextActions = context.nextActions;
  if (context.links) enriched.links = context.links;
  if (context.hint) enriched.hint = context.hint;
  return ok(enriched);
}

function err(message, details) {
  const obj = {
    success: false,
    error: message,
    hint: details || 'Check the token address, wallet label, and ensure sufficient gas/balance.',
    docs: 'Use thryx_about for available tools and protocol details.',
  };
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], isError: true };
}

// ── Register All Tools ─────────────────────────────────────────────

export function registerAllTools(server) {

  // ═══════════════════════════════════════════════════════════════════
  // thryx_launch — Deploy a new token
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_launch',
    'Launch a new token on ThryxProtocol v2.4 Diamond (Base mainnet). Creates a bonding curve paired with THRYX. Supply: 1B tokens (80% curve, 15% graduation LP, 5% creator vested 90 days linear). Costs only gas (~$0.01). Token is tradeable immediately. BONUS: First 10 new users automatically receive THRYX rewards for launching. Features: mandatory 10% slippage floor, referral support, fee burn, loyalty rebates, per-token ETH reserves.',
    {
      name: z.string().describe('Token name (e.g. "Autonomous Agent Token")'),
      symbol: z.string().describe('Token ticker symbol (e.g. "AAT")'),
      wallet: z.string().default('main').describe('Wallet label or address to deploy from'),
    },
    async ({ name, symbol, wallet }) => {
      try {
        const args = [name, symbol, '--wallet', wallet, '--json', '--execute'];
        const result = await runScript('launch.js', args);
        const json = parseJsonOutput(result.stdout);

        if (json && json.success) {
          return okEnriched(json, {
            nextActions: [
              `Use thryx_info with token "${json.token}" to check the bonding curve state`,
              `Use thryx_buy with token "${json.token}" to purchase tokens (ETH or THRYX accepted)`,
              `Share the token: https://basescan.org/address/${json.token}`,
              'Use thryx_claim to collect creator fees once trading generates volume',
            ],
            links: {
              basescan: `https://basescan.org/address/${json.token}`,
              trade: `Swap ETH or THRYX for this token using thryx_buy`,
            },
            hint: 'Token is live on the bonding curve. Anyone can buy with ETH or THRYX. Fees: 0.5% (70% to you as creator).',
          });
        }

        if (json) return ok(json);
        if (result.exitCode !== 0) return err('Launch failed', result.stderr || result.stdout);
        return ok(result.stdout || 'Launch completed (no JSON output)');
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_buy — Buy tokens with ETH or THRYX
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_buy',
    'Buy a token with ETH via ThryxProtocol v2.4 Diamond. Simple interface: send ETH, receive tokens. Protocol handles THRYX routing internally via V4 Doppler pool — real THRYX volume on every trade. 0.5% fee per trade (70% creator, 30% protocol). 20% of protocol fees burned. 10% slippage protection included. Also supports paying with THRYX directly. BONUS: First 10 new traders automatically receive THRYX rewards.',
    {
      token: z.string().describe('Token contract address to buy (0x...)'),
      amount: z.string().describe('Amount of input currency (e.g. "0.001" for 0.001 ETH, "10" for 10 THRYX)'),
      with: z.enum(['thryx', 'eth']).default('eth').describe('Pay with ETH (default, simple) or THRYX'),
      wallet: z.string().default('main').describe('Wallet label or address'),
    },
    async ({ token, amount, with: currency, wallet }) => {
      try {
        const args = [token, amount, '--with', currency, '--wallet', wallet, '--json', '--execute'];
        const result = await runScript('buy.js', args);
        const json = parseJsonOutput(result.stdout);

        if (json && json.success) {
          return okEnriched(json, {
            nextActions: [
              `Use thryx_info with token "${token}" to see updated curve state after your buy`,
              `Use thryx_sell with token "${token}" to sell later and receive ETH back`,
              `Use thryx_claim with token "${token}" if you are the creator to collect fees`,
            ],
            hint: `Bought tokens on the bonding curve. Your tokens are in wallet "${wallet}". Sell anytime with thryx_sell to get ETH back.`,
          });
        }

        if (json) return ok(json);
        if (result.exitCode !== 0) return err('Buy failed', result.stderr || result.stdout);
        return ok(result.stdout || 'Buy completed (no JSON output)');
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_sell — Universal sell (Protocol → Factory → Odos → Kyberswap)
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_sell',
    'Sell a token for ETH via ThryxProtocol v2.4 Diamond. Simple interface: send tokens, receive ETH. Protocol handles THRYX routing internally via V4 Doppler pool. Falls back to universal routing (Legacy Factory → Odos → Kyberswap) for non-Diamond tokens. Includes partial-sell fallback (100% → 50% → 25% → 10%). Use "all" to sell entire balance.',
    {
      token: z.string().describe('Token contract address to sell (0x...)'),
      amount: z.string().default('all').describe('Amount to sell (human-readable number) or "all" for full balance'),
      wallet: z.string().default('main').describe('Wallet label or address'),
    },
    async ({ token, amount, wallet }) => {
      try {
        const args = [token, amount, '--wallet', wallet, '--json', '--execute'];
        const result = await runScript('swap-sell.js', args);
        const json = parseJsonOutput(result.stdout);

        if (json) {
          return ok(json);
        }

        // Exit code 2 = partial success
        if (result.exitCode === 2) {
          return ok({
            success: true,
            partial: true,
            message: 'Partial sell completed (less than requested amount)',
            output: result.stdout,
          });
        }

        if (result.exitCode !== 0) {
          return err('Sell failed', result.stderr || result.stdout);
        }

        return ok(result.stdout || 'Sell completed (no JSON output)');
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_claim — Claim creator or protocol fees
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_claim',
    'Claim accumulated fees from a token. Auto-detects ThryxProtocol v2.4 Diamond (THRYX fees) or legacy factory (ETH/USDC fees). Must be called by the deployer wallet.',
    {
      token: z.string().describe('Token contract address to claim fees for (0x...)'),
      wallet: z.string().default('main').describe('Wallet label or address (must be the token deployer)'),
      protocolFees: z.boolean().default(false).describe('Claim protocol fees instead of creator fees (v2.4 only, protocol owner only)'),
    },
    async ({ token, wallet, protocolFees }) => {
      try {
        const args = [token, '--wallet', wallet, '--json', '--execute'];
        if (protocolFees) args.push('--protocol-fees');
        const result = await runScript('claim.js', args);
        const json = parseJsonOutput(result.stdout);

        if (json) {
          return ok(json);
        }

        if (result.exitCode !== 0) {
          return err('Claim failed', result.stderr || result.stdout);
        }

        return ok(result.stdout || 'Claim completed (no JSON output)');
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_info — Token info or protocol overview
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_info',
    'Get detailed info about a specific token (bonding curve state, price, graduation progress, fees, vesting, burn/referral data) or protocol-wide overview if no token is specified. Auto-detects v2.4 Diamond vs legacy factory tokens. Shows v2.4 burn and referral data when available.',
    {
      token: z.string().optional().describe('Token contract address (0x...). Omit for protocol overview.'),
    },
    async ({ token }) => {
      try {
        const args = ['--json'];
        if (token) args.unshift(token);
        const result = await runScript('info.js', args);
        const json = parseJsonOutput(result.stdout);

        if (json && json.success && token) {
          const actions = [
            `Use thryx_buy with token "${token}" and amount "0.001" --with eth to purchase`,
          ];
          if (json.graduated) {
            actions.push(`Token has graduated to Aerodrome AMM — view on DexScreener`);
          } else {
            actions.push(`Token is on bonding curve at ${json.progressPct || '0'}% to graduation (${json.threshold || '500000000'} THRYX needed)`);
          }
          if (parseFloat(json.creatorFees || '0') > 0) {
            actions.push(`Use thryx_claim with token "${token}" to collect ${json.creatorFees} THRYX in creator fees`);
          }
          return okEnriched(json, {
            nextActions: actions,
            links: { basescan: `https://basescan.org/address/${token}` },
          });
        }

        if (json) return ok(json);
        if (result.exitCode !== 0) return err('Info query failed', result.stderr || result.stdout);
        return ok(result.stdout || 'No info returned');
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_portfolio — Full portfolio scan
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_portfolio',
    'Scan all wallets for token holdings, ETH balances, and USD values. Discovers tokens via Blockscout, reads balances via Multicall3, prices via DexScreener. Writes a detailed JSON report. Can take 1-2 minutes for many wallets.',
    {},
    async () => {
      try {
        // Portfolio scan can take a while — use 5 minute timeout
        const result = await runScript('scan-portfolio.js', ['--json'], 300_000);

        // scan-portfolio.js doesn't have --json output mode yet,
        // so return the full stdout as text
        if (result.exitCode !== 0) {
          return err('Portfolio scan failed', result.stderr || result.stdout);
        }

        // Try to find the report file path from output
        const reportMatch = (result.stdout + '\n' + result.stderr).match(/Report written: (.+\.json)/);
        const reportPath = reportMatch ? reportMatch[1] : null;

        // Try reading the report file for structured data
        if (reportPath) {
          try {
            const { readFileSync } = await import('fs');
            const reportData = JSON.parse(readFileSync(reportPath, 'utf8'));
            return ok({
              success: true,
              reportFile: reportPath,
              summary: reportData.summary,
              wallets: reportData.wallets.map(w => ({
                label: w.label,
                address: w.address,
                ethBalance: w.ethBalance,
                ethValueUsd: w.ethValueUsd,
                totalValueUsd: w.totalValueUsd,
                tokenCount: w.tokens.length,
                sellableTokens: w.tokens.filter(t => t.sellable).map(t => ({
                  symbol: t.symbol,
                  address: t.address,
                  balance: t.balance,
                  valueUsd: t.valueUsd,
                  liquidityUsd: t.liquidityUsd,
                })),
              })),
            });
          } catch {
            // Fall back to raw output
          }
        }

        return ok(result.stderr || result.stdout || 'Portfolio scan completed');
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_balance — Check wallet balances (ETH + THRYX)
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_balance',
    'Check ETH and THRYX balances for a wallet. Quick balance check without full portfolio scan.',
    {
      wallet: z.string().default('main').describe('Wallet label (e.g. "main", "treasury") or 0x address'),
    },
    async ({ wallet: walletArg }) => {
      try {
        // Self-contained balance check using ethers.js directly (no toolkit dependency)
        const THRYX = '0xc07E889e1816De2708BF718683e52150C20F3BA3';
        const RPC_URL = 'https://mainnet.base.org';
        const CHAIN_ID = 8453;
        const BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

        const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
        let address;

        if (walletArg.startsWith('0x') && walletArg.length === 42) {
          address = walletArg;
        } else {
          // Try loading wallets.json from project root (optional — works when installed in project)
          try {
            const { readFileSync } = await import('fs');
            const walletsPath = resolve(PROJECT_ROOT, 'wallets.json');
            const wallets = JSON.parse(readFileSync(walletsPath, 'utf8'));
            const match = wallets.find(w => (w.label || '').toLowerCase().includes(walletArg.toLowerCase()));
            if (match) {
              address = match.address;
            }
          } catch {
            // wallets.json not found — that's fine for standalone installs
          }

          if (!address) {
            return err(`Wallet "${walletArg}" not found. Pass a 0x address directly, or ensure wallets.json exists in the project root.`);
          }
        }

        const [ethBal, thryxBal] = await Promise.all([
          provider.getBalance(address),
          new ethers.Contract(THRYX, BALANCE_ABI, provider).balanceOf(address),
        ]);

        return ok({
          wallet: walletArg,
          address,
          balances: {
            ETH: ethers.formatEther(ethBal),
            THRYX: ethers.formatEther(thryxBal),
          },
        });
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_about — Protocol overview (no script needed)
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_about',
    'Get information about ThryxProtocol — what it is, how it works, key addresses, and available tools.',
    {},
    async () => {
      return ok({
        name: 'ThryxProtocol v2.4 Diamond',
        tagline: 'The AI Agent Launchpad on Base',
        description: 'Zero-cost token launchpad with bonding curves that graduate to real AMM liquidity. Built for AI agents to operate autonomously. Auto-distributes fees, 0.5% lowest fees on Base. Per-token ETH reserves, same CA forever via Diamond proxy. Gasless launches via metaLaunch(). Simple buy()/sell() interface with ETH. Real THRYX volume on every trade via V4 Doppler pool. Dynamic ETH-denominated graduation threshold. Paymaster sponsors gas for new users.',
        network: 'Base mainnet (Chain ID 8453)',
        contracts: {
          protocol: '0x2F77b40c124645d25782CfBdfB1f54C1d76f2cCe',
          legacyProtocol_v2_3: '0x4f25b9ecC67dC597f35abaE6Fa495457EC82284B',
          legacyProtocol_v2_2: '0xcDC734c1AFC2822E0d7E332DC914c0a7311633bF',
          legacyProtocol_v2_1: '0xDfCC0341484C7890b3C96c3013EfDb4D2FD5a45a',
          legacyFactory: '0x3A33F1463517a76082EE6dCd41a19Ec5ac2889B9',
          thryx: '0xc07E889e1816De2708BF718683e52150C20F3BA3',
          weth: '0x4200000000000000000000000000000000000006',
        },
        relay: 'https://thryx-relay.thryx.workers.dev',
        mechanics: {
          launchCost: 'Gas only (~$0.01 on Base), or FREE via gasless metaLaunch() through the relay',
          supply: '1 billion tokens per launch',
          distribution: '80% bonding curve, 15% graduation LP reserve, 5% creator vested (90 days linear)',
          fees: '0.5% per swap (30% protocol, 70% creator)',
          graduation: 'Dynamic ETH-denominated threshold — migrates to Uniswap V4 AMM with real liquidity and real THRYX volume via Doppler pool',
          quoteToken: 'THRYX — all bonding curves are paired with THRYX',
          buyAndSell: 'Simple buy(token, amount) and sell(token, amount) interface — send ETH, receive tokens (or vice versa). Protocol handles THRYX routing internally.',
        },
        features: {
          diamondProxy: 'EIP-2535 Diamond — same address forever, upgradeable facets, verified on Basescan',
          gaslessLaunches: 'metaLaunch() lets users sign a message off-chain, relay submits the tx and pays gas. Zero ETH needed to launch.',
          paymasterGas: 'Paymaster contract sponsors gas for new users — holds ETH and THRYX reserves to cover transactions',
          buyAndSell: 'buy(token) and sell(token, amount) — simple ETH-native interface. No need to acquire THRYX first.',
          realThryxVolume: 'Every buy/sell generates real THRYX volume on the V4 Doppler pool — genuine liquidity, not virtual',
          dynamicGraduation: 'Graduation threshold is ETH-denominated and converts to THRYX at market rate — adjusts automatically',
          autoDistribute: 'Creator and referral fees paid instantly on every swap — no claiming needed',
          perTokenReserves: 'Each token has its own ETH reserves — safer graduation, no cross-token risk',
          referralSystem: 'Referrers earn 5% of protocol fee share',
          linearVesting: '90-day linear vesting for creator tokens',
          slippageFloor: 'Mandatory 10% slippage floor — auto-enforced if minOut is 0',
          feeBurn: '20% of protocol fees burned permanently — deflationary THRYX',
          earlyUserRewards: 'First 10 external users automatically earn THRYX rewards for launching and trading — no claiming needed',
        },
        tools: [
          'thryx_launch — Deploy a new token on the bonding curve',
          'thryx_buy — Buy tokens with ETH (simple interface: send ETH, get tokens)',
          'thryx_sell — Sell tokens for ETH (simple interface: send tokens, get ETH)',
          'thryx_meta_launch — Gasless token launch via metaLaunch() (returns signing data for relay submission)',
          'thryx_paymaster_stats — Check paymaster ETH/THRYX balance and sponsorship capacity',
          'thryx_claim — Claim creator or protocol fees',
          'thryx_set_referrer — Set referrer address for a token (v2.4)',
          'thryx_claim_referral — Claim accumulated referral fees (v2.4)',
          'thryx_stats_v2 — Get v2.4 protocol stats: total burned, graduation treasury collected',
          'thryx_safety_score — Rate any ThryxProtocol token 0-100 on safety (vesting, liquidity, distribution, activity)',
          'thryx_rug_check — Check ANY Base token for rug signals (verification, honeypot, dangerous functions, ownership)',
          'thryx_info — Token details or protocol overview',
          'thryx_portfolio — Full portfolio scan across all wallets',
          'thryx_balance — Quick ETH + THRYX balance check',
          'thryx_about — This overview',
        ],
      });
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_set_referrer — Set referrer for a token (v2.3)
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_set_referrer',
    'Set a referrer address for a token on ThryxProtocol v2.4 Diamond. The referrer earns 5% of the protocol fee share from that token. Must be called by the token creator.',
    {
      token: z.string().describe('Token contract address (0x...)'),
      referrer: z.string().describe('Referrer wallet address (0x...) to receive 5% of protocol fee share'),
      wallet: z.string().default('main').describe('Wallet label or address (must be the token creator)'),
    },
    async ({ token, referrer, wallet: walletArg }) => {
      try {
        const PROTOCOL_V2_4 = '0x2F77b40c124645d25782CfBdfB1f54C1d76f2cCe';
        const SET_REFERRER_ABI = ['function setReferrer(address referrer) external'];
        const RPC_URL = 'https://mainnet.base.org';
        const CHAIN_ID = 8453;

        const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
        let signer;

        if (walletArg.startsWith('0x') && walletArg.length === 42) {
          return err('Must provide a wallet label (not address) so the private key can be loaded from wallets.json.');
        }

        try {
          const { readFileSync } = await import('fs');
          const walletsPath = resolve(PROJECT_ROOT, 'wallets.json');
          const wallets = JSON.parse(readFileSync(walletsPath, 'utf8'));
          const match = wallets.find(w => (w.label || '').toLowerCase().includes(walletArg.toLowerCase()));
          if (!match) return err(`Wallet "${walletArg}" not found in wallets.json.`);
          if (!match.privateKey && !match.key) return err(`Wallet "${walletArg}" has no private key.`);
          signer = new ethers.Wallet(match.privateKey || match.key, provider);
        } catch (e) {
          return err(`Failed to load wallet: ${e.message}`);
        }

        const protocol = new ethers.Contract(PROTOCOL_V2_4, SET_REFERRER_ABI, signer);
        const tx = await protocol.setReferrer(referrer);
        const receipt = await tx.wait();

        return ok({
          success: true,
          action: 'setReferrer',
          token,
          referrer,
          txHash: receipt.hash,
          from: signer.address,
        });
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_claim_referral — Claim referral fees (v2.3)
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_claim_referral',
    'Claim accumulated referral fees from ThryxProtocol v2.4 Diamond. Referrers earn 5% of protocol fee share from tokens they referred. Returns THRYX to the caller wallet.',
    {
      wallet: z.string().default('main').describe('Wallet label (must be a referrer with unclaimed fees)'),
    },
    async ({ wallet: walletArg }) => {
      try {
        const PROTOCOL_V2_4 = '0x2F77b40c124645d25782CfBdfB1f54C1d76f2cCe';
        const CLAIM_REFERRAL_ABI = [
          'function claimReferralFees() external',
          'function referralFees(address) view returns (uint256)',
        ];
        const RPC_URL = 'https://mainnet.base.org';
        const CHAIN_ID = 8453;

        const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
        let signer;

        if (walletArg.startsWith('0x') && walletArg.length === 42) {
          return err('Must provide a wallet label (not address) so the private key can be loaded from wallets.json.');
        }

        try {
          const { readFileSync } = await import('fs');
          const walletsPath = resolve(PROJECT_ROOT, 'wallets.json');
          const wallets = JSON.parse(readFileSync(walletsPath, 'utf8'));
          const match = wallets.find(w => (w.label || '').toLowerCase().includes(walletArg.toLowerCase()));
          if (!match) return err(`Wallet "${walletArg}" not found in wallets.json.`);
          if (!match.privateKey && !match.key) return err(`Wallet "${walletArg}" has no private key.`);
          signer = new ethers.Wallet(match.privateKey || match.key, provider);
        } catch (e) {
          return err(`Failed to load wallet: ${e.message}`);
        }

        const protocol = new ethers.Contract(PROTOCOL_V2_4, CLAIM_REFERRAL_ABI, signer);

        // Check pending referral fees first
        const pendingFees = await protocol.referralFees(signer.address);
        if (pendingFees === 0n) {
          return ok({
            success: true,
            action: 'claimReferralFees',
            message: 'No referral fees to claim.',
            pendingThryx: '0',
            from: signer.address,
          });
        }

        const tx = await protocol.claimReferralFees();
        const receipt = await tx.wait();

        return ok({
          success: true,
          action: 'claimReferralFees',
          claimedThryx: ethers.formatEther(pendingFees),
          txHash: receipt.hash,
          from: signer.address,
        });
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_stats_v2 — Get v2.3 protocol stats (burned, graduation treasury)
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_stats_v2',
    'Get ThryxProtocol v2.4 Diamond extended stats: total THRYX burned from fee burn mechanism, and total graduation treasury THRYX collected. Read-only, no wallet needed.',
    {},
    async () => {
      try {
        const PROTOCOL_V2_4 = '0x2F77b40c124645d25782CfBdfB1f54C1d76f2cCe';
        const STATS_ABI = ['function getProtocolStats() view returns (uint256 launched, uint256 graduated, uint256 lifetimeFees, uint256 thryxReserves, uint256 ethReserves, uint256 ethRate, uint256 thryxBurned, uint256 gradTreasuryCollected)'];
        const RPC_URL = 'https://mainnet.base.org';
        const CHAIN_ID = 8453;

        const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
        const protocol = new ethers.Contract(PROTOCOL_V2_4, STATS_ABI, provider);

        const stats = await protocol.getProtocolStats();
        const totalBurned = stats.thryxBurned;
        const totalGraduationTreasuryCollected = stats.gradTreasuryCollected;

        return ok({
          success: true,
          protocol: PROTOCOL_V2_4,
          version: 'v2.4',
          stats: {
            totalThryxBurned: ethers.formatEther(totalBurned),
            totalGraduationTreasuryCollected: ethers.formatEther(totalGraduationTreasuryCollected),
          },
          description: {
            totalThryxBurned: 'Total THRYX permanently burned via the 20% fee burn mechanism',
            totalGraduationTreasuryCollected: 'Total THRYX collected by protocol treasury from 0.5% graduation cut',
          },
        });
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_safety_score — Rate token safety 0-100
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_safety_score',
    'Calculate a safety score (0-100, letter grade) for any ThryxProtocol token. Checks creator vesting, liquidity depth, holder distribution, trading activity, creator behavior, referral status, and token age. Can score a single token or all deployed tokens. For external (non-THRYX) tokens, use thryx_rug_check instead.',
    {
      token: z.string().optional().describe('Token contract address (0x...). Omit and set all=true to scan all deployed tokens.'),
      all: z.boolean().default(false).describe('Score ALL deployed tokens across v2.4 and legacy versions'),
    },
    async ({ token, all }) => {
      try {
        const args = ['--json'];
        if (all) {
          args.unshift('--all');
        } else if (token) {
          args.unshift(token);
        } else {
          return err('Provide a token address or set all=true to scan all tokens.');
        }

        // Safety score can take a while when scanning all tokens
        const timeout = all ? 300_000 : 120_000;
        const result = await runScript('safety-score.js', args, timeout);
        const json = parseJsonOutput(result.stdout);

        if (json) {
          return ok(json);
        }

        if (result.exitCode !== 0) {
          return err('Safety score failed', result.stderr || result.stdout);
        }

        return ok(result.stdout || 'Safety score completed (no JSON output)');
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_rug_check — Check ANY Base token for rug signals
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_rug_check',
    'Check ANY ERC20 token on Base for rug-pull signals. Analyzes contract verification, dangerous functions (mint/pause/blacklist/upgrade), ownership, liquidity, honeypot indicators, tax/fees, and owner balance. Works on any token — not just ThryxProtocol tokens. Returns overall risk level: LOW, MEDIUM, HIGH, or CRITICAL.',
    {
      token: z.string().describe('Token contract address to check (0x...)'),
    },
    async ({ token }) => {
      try {
        const args = [token, '--json'];
        const result = await runScript('rug-check.js', args);
        const json = parseJsonOutput(result.stdout);

        if (json) {
          return ok(json);
        }

        if (result.exitCode !== 0) {
          return err('Rug check failed', result.stderr || result.stdout);
        }

        return ok(result.stdout || 'Rug check completed (no JSON output)');
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_meta_launch — Gasless token launch via metaLaunch()
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_meta_launch',
    'Get signing data for a gasless token launch via metaLaunch(). The user signs a message off-chain and the relay at https://thryx-relay.thryx.workers.dev submits the transaction and pays gas. Zero ETH needed to launch. Returns the message to sign and the relay endpoint to submit to.',
    {
      name: z.string().describe('Token name (e.g. "Autonomous Agent Token")'),
      symbol: z.string().describe('Token ticker symbol (e.g. "AAT")'),
      wallet: z.string().default('main').describe('Wallet label or address (the creator/signer)'),
    },
    async ({ name, symbol, wallet: walletArg }) => {
      try {
        const PROTOCOL = '0x2F77b40c124645d25782CfBdfB1f54C1d76f2cCe';
        const RELAY_URL = 'https://thryx-relay.thryx.workers.dev';
        const RPC_URL = 'https://mainnet.base.org';
        const CHAIN_ID = 8453;

        const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
        let signerAddress;

        if (walletArg.startsWith('0x') && walletArg.length === 42) {
          signerAddress = walletArg;
        } else {
          try {
            const { readFileSync } = await import('fs');
            const walletsPath = resolve(PROJECT_ROOT, 'wallets.json');
            const wallets = JSON.parse(readFileSync(walletsPath, 'utf8'));
            const match = wallets.find(w => (w.label || '').toLowerCase().includes(walletArg.toLowerCase()));
            if (match) {
              signerAddress = match.address;
            }
          } catch {
            // wallets.json not found
          }

          if (!signerAddress) {
            return err(`Wallet "${walletArg}" not found. Pass a 0x address directly, or ensure wallets.json exists.`);
          }
        }

        // Get the current nonce for the signer from the protocol
        let nonce = 0;
        try {
          const nonceAbi = ['function metaLaunchNonces(address) view returns (uint256)'];
          const protocol = new ethers.Contract(PROTOCOL, nonceAbi, provider);
          nonce = Number(await protocol.metaLaunchNonces(signerAddress));
        } catch {
          // If nonce function doesn't exist yet, default to 0
        }

        // Compute the EIP-712 domain and message for metaLaunch signing
        const domain = {
          name: 'ThryxProtocol',
          version: '1',
          chainId: CHAIN_ID,
          verifyingContract: PROTOCOL,
        };

        const types = {
          MetaLaunch: [
            { name: 'name', type: 'string' },
            { name: 'symbol', type: 'string' },
            { name: 'user', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        };

        const deadline = Math.floor(Date.now() / 1000) + 600; // 10 minutes

        const message = {
          name,
          symbol,
          user: signerAddress,
          nonce,
          deadline,
        };

        return okEnriched({
          success: true,
          action: 'metaLaunch',
          description: 'Sign this EIP-712 typed data with your wallet, then POST the signature to the relay endpoint.',
          signerAddress,
          domain,
          types,
          message,
          relayEndpoint: `${RELAY_URL}/relay/launch`,
          relayPayload: {
            name,
            symbol,
            user: signerAddress,
            deadline: deadline.toString(),
            signature: '<SIGN_AND_INSERT_HERE>',
          },
          instructions: [
            'Step 1: Sign the EIP-712 typed data above using ethers.js signTypedData(domain, types, message) or your wallet provider',
            'Step 2: POST to the relay endpoint with the relayPayload (replace signature placeholder with actual signature)',
            'Step 3: The relay submits the metaLaunch() transaction and pays gas on your behalf',
            'Step 4: You receive the token address in the relay response — your token is live!',
          ],
        }, {
          nextActions: [
            'Sign the typed data with your wallet and submit to the relay',
            'After launch, use thryx_info with the returned token address to check the bonding curve',
          ],
          hint: 'Gasless launch — the relay pays gas. You just sign a message.',
        });
      } catch (e) {
        return err(e.message);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════
  // thryx_paymaster_stats — Check paymaster balance and capacity
  // ═══════════════════════════════════════════════════════════════════

  server.tool(
    'thryx_paymaster_stats',
    'Check the ThryxProtocol paymaster contract balance and gas sponsorship capacity. The paymaster holds ETH to sponsor gas for new users (gasless launches and trades). Shows ETH balance, THRYX balance, and estimated number of sponsored transactions remaining.',
    {},
    async () => {
      try {
        const PROTOCOL = '0x2F77b40c124645d25782CfBdfB1f54C1d76f2cCe';
        const THRYX = '0xc07E889e1816De2708BF718683e52150C20F3BA3';
        const RPC_URL = 'https://mainnet.base.org';
        const CHAIN_ID = 8453;
        const BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

        // Read paymaster address from protocol
        const PAYMASTER_ABI = ['function paymaster() view returns (address)'];

        const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });

        let paymasterAddress;
        try {
          const protocol = new ethers.Contract(PROTOCOL, PAYMASTER_ABI, provider);
          paymasterAddress = await protocol.paymaster();
        } catch {
          // If paymaster() doesn't exist on-chain yet, use the protocol itself as a fallback
          paymasterAddress = PROTOCOL;
        }

        const [ethBalance, thryxBalance] = await Promise.all([
          provider.getBalance(paymasterAddress),
          new ethers.Contract(THRYX, BALANCE_ABI, provider).balanceOf(paymasterAddress),
        ]);

        // Estimate capacity: average launch costs ~920K gas, ~0.006 gwei on Base
        // Each tx costs approx 0.000006 ETH (6e-6 ETH) at 0.006 gwei
        const estGasPerTx = 0.000006; // ETH per launch tx at typical Base gas prices
        const ethBal = parseFloat(ethers.formatEther(ethBalance));
        const estimatedLaunchesRemaining = Math.floor(ethBal / estGasPerTx);

        return ok({
          success: true,
          paymaster: paymasterAddress,
          protocol: PROTOCOL,
          balances: {
            ETH: ethers.formatEther(ethBalance),
            THRYX: ethers.formatEther(thryxBalance),
          },
          capacity: {
            estimatedLaunchesRemaining,
            estimatedSwapsRemaining: Math.floor(ethBal / (estGasPerTx * 0.3)), // swaps are ~30% of launch gas
            note: 'Estimates based on typical Base gas prices (~0.006 gwei). Actual capacity may vary.',
          },
          description: 'The paymaster sponsors gas for gasless metaLaunch() and new user transactions. Funded by protocol revenue.',
          relay: 'https://thryx-relay.thryx.workers.dev',
        });
      } catch (e) {
        return err(e.message);
      }
    }
  );
}

/**
 * HTTP Transport for THRYX MCP Server
 * Enables remote access via Streamable HTTP (MCP spec compliant).
 * Can be deployed to Cloudflare Workers, Railway, or any Node.js host.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'http';

// ── Server Card (MCP spec) ──────────────────────────────────────────
// Smithery and other MCP registries fetch this to discover tools
// without running the server. Follows the MCP server-card.json spec.

const SERVER_CARD = {
  serverInfo: {
    name: 'thryx-protocol',
    version: '1.2.0',
    description: 'ThryxProtocol v2.4 Diamond — The AI Agent Launchpad on Base. Launch tokens, buy/sell with ETH, gasless metaLaunch, paymaster-sponsored gas, safety scores, rug checks.',
  },
  tools: [
    {
      name: 'thryx_launch',
      description: 'Launch a new token on ThryxProtocol v2.4 Diamond (Base mainnet). Creates a bonding curve paired with THRYX. Supply: 1B tokens (80% curve, 15% graduation LP, 5% creator vested 90 days linear). Costs only gas (~$0.01). Token is tradeable immediately.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Token name (e.g. "Autonomous Agent Token")' },
          symbol: { type: 'string', description: 'Token ticker symbol (e.g. "AAT")' },
          wallet: { type: 'string', default: 'main', description: 'Wallet label or address to deploy from' },
        },
        required: ['name', 'symbol'],
      },
    },
    {
      name: 'thryx_buy',
      description: 'Buy a token with ETH or THRYX via ThryxProtocol v2.4 Diamond. 0.5% fee per trade (70% creator, 30% protocol). 10% slippage protection included.',
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token contract address to buy (0x...)' },
          amount: { type: 'string', description: 'Amount of input currency (e.g. "0.001" for 0.001 ETH)' },
          with: { type: 'string', enum: ['thryx', 'eth'], default: 'eth', description: 'Pay with ETH (default) or THRYX' },
          wallet: { type: 'string', default: 'main', description: 'Wallet label or address' },
        },
        required: ['token', 'amount'],
      },
    },
    {
      name: 'thryx_sell',
      description: 'Sell a token for ETH via universal routing: ThryxProtocol v2.4 Diamond → Legacy Factory → Odos → Kyberswap. Partial-sell fallback included. Use "all" to sell entire balance.',
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token contract address to sell (0x...)' },
          amount: { type: 'string', default: 'all', description: 'Amount to sell or "all" for full balance' },
          wallet: { type: 'string', default: 'main', description: 'Wallet label or address' },
        },
        required: ['token'],
      },
    },
    {
      name: 'thryx_claim',
      description: 'Claim accumulated fees from a token. Auto-detects ThryxProtocol v2.4 Diamond or legacy factory. Must be called by the deployer wallet.',
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token contract address to claim fees for (0x...)' },
          wallet: { type: 'string', default: 'main', description: 'Wallet label or address (must be deployer)' },
          protocolFees: { type: 'boolean', default: false, description: 'Claim protocol fees instead of creator fees (owner only)' },
        },
        required: ['token'],
      },
    },
    {
      name: 'thryx_info',
      description: 'Get detailed info about a token (bonding curve state, price, graduation progress, fees) or protocol-wide overview if no token specified.',
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token contract address (0x...). Omit for protocol overview.' },
        },
      },
    },
    {
      name: 'thryx_portfolio',
      description: 'Scan all wallets for token holdings, ETH balances, and USD values. Discovers tokens via Blockscout, reads balances via Multicall3, prices via DexScreener.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'thryx_balance',
      description: 'Check ETH and THRYX balances for a wallet. Quick balance check without full portfolio scan.',
      inputSchema: {
        type: 'object',
        properties: {
          wallet: { type: 'string', default: 'main', description: 'Wallet label or 0x address' },
        },
      },
    },
    {
      name: 'thryx_about',
      description: 'Get information about ThryxProtocol — what it is, how it works, key addresses, and available tools.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'thryx_set_referrer',
      description: 'Set a referrer address for a token. The referrer earns 5% of the protocol fee share. Must be called by the token creator.',
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token contract address (0x...)' },
          referrer: { type: 'string', description: 'Referrer wallet address (0x...)' },
          wallet: { type: 'string', default: 'main', description: 'Wallet label (must be token creator)' },
        },
        required: ['token', 'referrer'],
      },
    },
    {
      name: 'thryx_claim_referral',
      description: 'Claim accumulated referral fees from ThryxProtocol v2.4 Diamond. Returns THRYX to the caller wallet.',
      inputSchema: {
        type: 'object',
        properties: {
          wallet: { type: 'string', default: 'main', description: 'Wallet label (must be a referrer with unclaimed fees)' },
        },
      },
    },
    {
      name: 'thryx_stats_v2',
      description: 'Get ThryxProtocol v2.4 Diamond extended stats: total THRYX burned, graduation treasury collected. Read-only.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'thryx_safety_score',
      description: 'Calculate a safety score (0-100, letter grade) for any ThryxProtocol token. Checks vesting, liquidity, holder distribution, activity, creator behavior.',
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token contract address (0x...). Omit and set all=true to scan all.' },
          all: { type: 'boolean', default: false, description: 'Score ALL deployed tokens' },
        },
      },
    },
    {
      name: 'thryx_rug_check',
      description: 'Check ANY ERC20 token on Base for rug-pull signals. Analyzes verification, dangerous functions, ownership, liquidity, honeypot indicators. Returns risk level: LOW, MEDIUM, HIGH, or CRITICAL.',
      inputSchema: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'Token contract address to check (0x...)' },
        },
        required: ['token'],
      },
    },
    {
      name: 'thryx_meta_launch',
      description: 'Get signing data for a gasless token launch via metaLaunch(). User signs EIP-712 off-chain, relay submits tx and pays gas. Zero ETH needed.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Token name' },
          symbol: { type: 'string', description: 'Token ticker symbol' },
          wallet: { type: 'string', default: 'main', description: 'Wallet label or address (the signer)' },
        },
        required: ['name', 'symbol'],
      },
    },
    {
      name: 'thryx_paymaster_stats',
      description: 'Check the paymaster contract balance and gas sponsorship capacity. Shows ETH/THRYX balance and estimated sponsored transactions remaining.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
  resources: [],
  prompts: [],
};

export async function startHttpServer(mcpServer, port = 3100) {
  const httpServer = createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // MCP Server Card — allows Smithery and registries to discover tools without scanning
    if (req.method === 'GET' && (req.url === '/.well-known/mcp/server-card.json' || req.url === '/.well-known/mcp.json')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(SERVER_CARD, null, 2));
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: 'thryx-protocol-mcp',
        version: '1.2.0',
        network: 'Base mainnet (8453)',
        serverCard: '/.well-known/mcp/server-card.json',
      }));
      return;
    }

    // MCP endpoint
    if (req.url === '/mcp' || req.url === '/') {
      try {
        // Collect request body
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString();

        // Create a fresh transport per request (stateless mode)
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // stateless
        });

        // Connect server to transport
        await mcpServer.connect(transport);

        // Create a mock request/response compatible with the transport
        const parsedBody = JSON.parse(body);

        // Handle the request through the transport
        await transport.handleRequest(
          { method: req.method, headers: req.headers, body: parsedBody },
          res,
          parsedBody
        );
      } catch (e) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol or /health for status.' }));
  });

  httpServer.listen(port, () => {
    console.error(`THRYX MCP Server (HTTP) listening on http://localhost:${port}`);
    console.error(`  MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`  Health check: http://localhost:${port}/health`);
    console.error(`  Server card:  http://localhost:${port}/.well-known/mcp/server-card.json`);
  });

  return httpServer;
}

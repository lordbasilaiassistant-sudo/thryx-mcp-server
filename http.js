/**
 * HTTP Transport for THRYX MCP Server
 * Enables remote access via Streamable HTTP (MCP spec compliant).
 * Can be deployed to Cloudflare Workers, Railway, or any Node.js host.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'http';

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

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        server: 'thryx-protocol-mcp',
        version: '1.0.0',
        network: 'Base mainnet (8453)',
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
  });

  return httpServer;
}

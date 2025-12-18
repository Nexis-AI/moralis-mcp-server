/**
 * StreamableHTTP server setup for HTTP-based MCP communication using Hono
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { toReqRes, toFetchResponse } from 'fetch-to-node';
import { Config } from './config.js';

/**
 * Sets up a web server for the MCP server using StreamableHTTP transport
 *
 * @param server The MCP Server instance
 * @param port The port to listen on (default: 3000)
 * @returns The Hono app instance
 */
export async function setupStreamableHttpServer(server: Server, port = 3000) {
  // Create Hono app
  const app = new Hono();
  // Bind to all interfaces by default (required for hosted environments).
  // Do NOT default to `HOSTNAME` because container runtimes often set it to an
  // internal name that resolves to loopback, making the service unreachable.
  const hostname = process.env.HOST || '0.0.0.0';

  // Enable CORS
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-API-Key',
        'Mcp-Session-Id',
        'Last-Event-ID',
      ],
      exposeHeaders: ['Mcp-Session-Id'],
      maxAge: 600,
    }),
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);

  // Root route (useful for platform health checks that probe "/")
  app.get('/', (c) => {
    return c.json({
      status: 'OK',
      server: Config.SERVER_NAME,
      version: Config.SERVER_VERSION,
      endpoints: { health: '/health', mcp: '/mcp' },
    });
  });

  // Add a simple health check endpoint
  app.get('/health', (c) => {
    return c.json({
      status: 'OK',
      server: Config.SERVER_NAME,
      version: Config.SERVER_VERSION,
    });
  });

  const handleMcpRequest = async (c: any) => {
    try {
      // Convert Fetch Request to Node.js req/res
      const { req, res } = toReqRes(c.req.raw);

      // Bridge disconnect/finish signals into a synthetic `close` event.
      // The MCP StreamableHTTP transport uses `res.on('close')` for cleanup,
      // but `fetch-to-node` responses are in-memory and don't always emit `close`
      // when the underlying client disconnects.
      let closeEmitted = false;
      const emitCloseOnce = () => {
        if (closeEmitted) return;
        closeEmitted = true;
        try {
          (res as any).emit?.('close');
        } catch {
          // ignore
        }
      };

      (res as any).on?.('finish', emitCloseOnce);

      const signal: AbortSignal | undefined = c.req?.raw?.signal;
      if (signal) {
        const onAbort = () => {
          emitCloseOnce();
          try {
            (res as any).end?.();
          } catch {
            // ignore
          }
        };

        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      // Be permissive with Accept headers (some clients send */*),
      // while still allowing the SDK transport to enforce MCP requirements.
      const acceptHeader = (req as any).headers?.accept;
      if (req.method === 'GET') {
        if (!acceptHeader || acceptHeader === '*/*') {
          (req as any).headers.accept = 'text/event-stream';
        }
      } else if (req.method === 'POST') {
        if (!acceptHeader || acceptHeader === '*/*') {
          (req as any).headers.accept = 'application/json, text/event-stream';
        } else {
          const lower = String(acceptHeader).toLowerCase();
          if (!lower.includes('application/json') || !lower.includes('text/event-stream')) {
            const parts = String(acceptHeader)
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean);
            if (!lower.includes('application/json')) parts.push('application/json');
            if (!lower.includes('text/event-stream')) parts.push('text/event-stream');
            (req as any).headers.accept = parts.join(', ');
          }
        }
      }

      // Pass X-API-Key through MCP authInfo (available as c.authInfo?.token in handlers)
      const apiKey = c.req.header('X-API-Key');
      if (apiKey) {
        (req as any).auth = { token: apiKey };
      }

      // Let the MCP transport parse/validate the request (body, headers, method)
      await transport.handleRequest(req as any, res);

      // Convert Node.js response back to Fetch Response
      return toFetchResponse(res);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      return c.text('Internal server error.', 500);
    }
  };

  // Main MCP endpoint (Streamable HTTP spec supports GET, POST, DELETE)
  app.get('/mcp', (c) => handleMcpRequest(c));
  app.post('/mcp', (c) => handleMcpRequest(c));
  app.delete('/mcp', (c) => handleMcpRequest(c));
  // Also accept trailing slash for compatibility with some clients/proxies.
  app.get('/mcp/', (c) => handleMcpRequest(c));
  app.post('/mcp/', (c) => handleMcpRequest(c));
  app.delete('/mcp/', (c) => handleMcpRequest(c));

  // Static files for the web client (if any)
  app.get('/*', async (c) => {
    const filePath = c.req.path === '/' ? '/index.html' : c.req.path;
    try {
      // Use Node.js fs to serve static files
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');

      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const publicPath = path.join(__dirname, '..', '..', 'public');
      const fullPath = path.join(publicPath, filePath);

      // Simple security check to prevent directory traversal
      if (!fullPath.startsWith(publicPath)) {
        return c.text('Forbidden', 403);
      }

      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          const content = fs.readFileSync(fullPath);

          // Set content type based on file extension
          const ext = path.extname(fullPath).toLowerCase();
          let contentType = 'text/plain';

          switch (ext) {
            case '.html':
              contentType = 'text/html';
              break;
            case '.css':
              contentType = 'text/css';
              break;
            case '.js':
              contentType = 'text/javascript';
              break;
            case '.json':
              contentType = 'application/json';
              break;
            case '.png':
              contentType = 'image/png';
              break;
            case '.jpg':
              contentType = 'image/jpeg';
              break;
            case '.svg':
              contentType = 'image/svg+xml';
              break;
          }

          return new Response(content, {
            headers: { 'Content-Type': contentType },
          });
        }
      } catch (err) {
        // File not found or other error
        return c.text('Not Found', 404);
      }
    } catch (err) {
      console.error('Error serving static file:', err);
      return c.text('Internal Server Error', 500);
    }

    return c.text('Not Found', 404);
  });

  // Start the server
  const httpServer = serve(
    {
      fetch: app.fetch,
      port,
      hostname,
    },
    (info) => {
      console.log(
        `MCP StreamableHTTP Server running at http://localhost:${info.port}`,
      );
      console.log(`- MCP Endpoint: http://localhost:${info.port}/mcp`);
      console.log(`- Health Check: http://localhost:${info.port}/health`);
    },
  );
  httpServer.on('error', (error) => {
    console.error('HTTP server error:', error);
    process.exit(1);
  });

  return app;
}

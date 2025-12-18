#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Config } from './config.js';
import { serverSetup } from './server.js';
import { setupWebServer } from './web-server.js';
import { setupStreamableHttpServer } from './streamable-http.js';

enum TransportType {
  STDIO = 'stdio',
  WEB = 'web',
  STREAMABLE_HTTP = 'streamable-http',
}

const DEFAULT_PORT = 3000;

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number.parseInt(value, 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return undefined;
  return port;
}

function isHostedEnvironment(): boolean {
  return Boolean(
    process.env.PORT ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_ENVIRONMENT_ID,
  );
}

function isValidTransport(value: string): value is TransportType {
  return Object.values(TransportType).includes(value as TransportType);
}

function parseCliArgs(argv: string[]): { transport?: TransportType; port?: number } {
  const result: { transport?: TransportType; port?: number } = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--transport') {
      const next = argv[i + 1];
      if (!next) {
        console.error(
          'Missing value for --transport. Use one of: stdio, web, streamable-http.',
        );
        process.exit(1);
      }
      if (!isValidTransport(next)) {
        console.error(
          `Invalid --transport value '${next}'. Use one of: stdio, web, streamable-http.`,
        );
        process.exit(1);
      }
      result.transport = next;
      i += 1;
      continue;
    }

    if (arg === '--port') {
      const next = argv[i + 1];
      const port = parsePort(next);
      if (!next || !port) {
        console.error('Invalid --port value. Use an integer between 1 and 65535.');
        process.exit(1);
      }
      result.port = port;
      i += 1;
      continue;
    }

    console.error(
      `Invalid argument '${arg}'. Supported args: --transport <stdio|web|streamable-http>, --port <number>.`,
    );
    process.exit(1);
  }

  return result;
}

async function startStdioServer() {
  // Set up stdio transport
  try {
    const transport = new StdioServerTransport();
    (await serverSetup()).connect(transport);
    console.error(
      `${Config.SERVER_NAME} Server (v${Config.SERVER_VERSION}) running on stdio`,
    );
  } catch (error) {
    console.error('Error during server startup:', error);
    process.exit(1);
  }
}

async function startWebServer() {
  // Set up Web Server transport
  try {
    const port = parsePort(process.env.PORT) ?? DEFAULT_PORT;
    await setupWebServer(await serverSetup(), port);
  } catch (error) {
    console.error('Error setting up web server:', error);
    process.exit(1);
  }
}

async function startStreamableHttpServer() {
  // Set up StreamableHTTP transport
  try {
    const port = parsePort(process.env.PORT) ?? DEFAULT_PORT;
    await setupStreamableHttpServer(await serverSetup(), port);
  } catch (error) {
    console.error('Error setting up StreamableHTTP server:', error);
    process.exit(1);
  }
}

/**
 * Main function to start the server
 */
async function main(transport: string) {
  switch (transport) {
    case TransportType.STDIO:
      await startStdioServer();
      break;
    case TransportType.WEB:
      await startWebServer();
      break;
    case TransportType.STREAMABLE_HTTP:
      await startStreamableHttpServer();
      break;
    default:
      console.error(
        `Unknown transport '${transport}'. Use one of: stdio, web, streamable-http.`,
      );
      process.exit(1);
  }
}

/**
 * Cleanup function for graceful shutdown
 */
async function cleanup() {
  console.error('Shutting down MCP server...');
  process.exit(0);
}

// Register signal handlers
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Accept optional CLI args: --transport, --port
const cliArgs = parseCliArgs(process.argv.slice(2));
if (cliArgs.port) {
  process.env.PORT = String(cliArgs.port);
}

const defaultTransport: TransportType =
  process.env.MCP_TRANSPORT && isValidTransport(process.env.MCP_TRANSPORT)
    ? (process.env.MCP_TRANSPORT as TransportType)
    : isHostedEnvironment()
      ? TransportType.STREAMABLE_HTTP
      : TransportType.STDIO;

const transport = cliArgs.transport ?? defaultTransport;

// Start the server
main(transport).catch((error) => {
  console.error('Fatal error in main execution:', error);
  process.exit(1);
});

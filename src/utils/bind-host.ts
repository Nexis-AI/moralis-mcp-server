import { isIP } from 'node:net';

const DEFAULT_BIND_HOST = '0.0.0.0';

function isBindableHost(value: string): boolean {
  if (value === 'localhost') return true;
  return isIP(value) !== 0;
}

/**
 * Returns a safe hostname to bind an HTTP server to.
 *
 * Why: platform env vars like HOST can contain a public domain (e.g. example.com),
 * which is not a local interface and will crash `server.listen()` with EADDRNOTAVAIL.
 */
export function resolveBindHost(): string {
  const candidates = [
    process.env.BIND_HOST,
    process.env.MCP_BIND_HOST,
    process.env.LISTEN_HOST,
    process.env.HOST,
  ].filter(Boolean) as string[];

  const configured = candidates[0];
  if (!configured) return DEFAULT_BIND_HOST;

  if (isBindableHost(configured)) return configured;

  console.error(
    `Ignoring bind host '${configured}' (not an IP/local host). Falling back to ${DEFAULT_BIND_HOST}.`,
  );
  return DEFAULT_BIND_HOST;
}


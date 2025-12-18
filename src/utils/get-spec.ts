import axios from 'axios';
import type { OpenAPIV3 } from 'openapi-types';

export async function getSpec(url: string) {
  const timeoutMsRaw = process.env.SPEC_FETCH_TIMEOUT_MS;
  const retriesRaw = process.env.SPEC_FETCH_RETRIES;

  const timeoutMs =
    (timeoutMsRaw ? Number.parseInt(timeoutMsRaw, 10) : Number.NaN) || 15_000;
  const retries =
    (retriesRaw ? Number.parseInt(retriesRaw, 10) : Number.NaN) || 2;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const { data } = await axios.get<OpenAPIV3.Document>(url, {
        timeout: timeoutMs,
      });
      return data;
    } catch (error: unknown) {
      lastError = error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      const shouldRetry =
        attempt < retries && (status === undefined || status >= 500);

      if (!shouldRetry) break;

      const backoffMs = 250 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  const details = axios.isAxiosError(lastError)
    ? [
        lastError.code ? `code=${lastError.code}` : undefined,
        lastError.response?.status ? `status=${lastError.response.status}` : undefined,
        lastError.response?.statusText
          ? `statusText=${lastError.response.statusText}`
          : undefined,
      ]
        .filter(Boolean)
        .join(' ')
    : lastError instanceof Error
      ? lastError.message
      : String(lastError);

  throw new Error(`Failed to fetch OpenAPI spec from ${url}. ${details}`);
}

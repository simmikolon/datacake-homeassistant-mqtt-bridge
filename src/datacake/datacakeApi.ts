import { childLogger } from "../utils/logger";
import type { AllDevicesResponse, DevicesFilteredResult } from "./types";

const log = childLogger("datacake.api");

const ALL_DEVICES_QUERY = /* GraphQL */ `
  query AllDevices($workspaceId: String!, $page: Int!, $pageSize: Int!) {
    workspace(id: $workspaceId) {
      devicesFiltered(page: $page, pageSize: $pageSize, all: true) {
        total
        devices {
          id
          verboseName
          online
          lastHeard
          product {
            slug
            measurementFields(active: true) {
              fieldName
              fieldType
              semantic
            }
          }
        }
      }
    }
  }
`;

export type DatacakeApiOptions = {
  endpoint: string;
  token: string;
  workspaceId: string;
};

export class DatacakeApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "DatacakeApiError";
  }
}

async function postGraphql<T>(
  opts: DatacakeApiOptions,
  query: string,
  variables: Record<string, unknown>,
  timeoutMs = 15000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(opts.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${opts.token}`,
        Accept: "application/json"
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new DatacakeApiError(
        `GraphQL HTTP ${res.status}: ${res.statusText}`,
        res.status,
        text
      );
    }
    return (await res.json()) as T;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new DatacakeApiError(`GraphQL request timed out after ${timeoutMs}ms`);
    }
    if (err instanceof DatacakeApiError) throw err;
    throw new DatacakeApiError((err as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(
  op: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 400
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const delay = baseDelayMs * 2 ** i;
      log.warn({ err, attempt: i + 1, nextDelayMs: delay }, "GraphQL request failed, retrying");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchDevicesPage(
  opts: DatacakeApiOptions,
  page: number,
  pageSize: number
): Promise<DevicesFilteredResult> {
  const response = await withRetry(() =>
    postGraphql<AllDevicesResponse>(opts, ALL_DEVICES_QUERY, {
      workspaceId: opts.workspaceId,
      page,
      pageSize
    })
  );

  if (response.errors && response.errors.length) {
    const msg = response.errors.map((e) => e.message).join("; ");
    throw new DatacakeApiError(`GraphQL errors: ${msg}`);
  }

  const filtered = response.data?.workspace?.devicesFiltered;
  if (!filtered) {
    throw new DatacakeApiError("GraphQL response missing workspace.devicesFiltered");
  }
  return {
    total: filtered.total ?? 0,
    devices: Array.isArray(filtered.devices) ? filtered.devices : []
  };
}

// Lightweight connectivity probe used by the /settings Test buttons. Returns
// the total number of devices discovered or throws a `DatacakeApiError`.
export async function pingWorkspace(opts: DatacakeApiOptions): Promise<{ total: number }> {
  const first = await fetchDevicesPage(opts, 0, 1);
  return { total: first.total };
}

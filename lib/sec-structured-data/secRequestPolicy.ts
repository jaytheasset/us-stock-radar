export type SecRequestPolicyOptions = {
  minimumIntervalMs?: number;
  maximumAttempts?: number;
  baseBackoffMs?: number;
  maximumBackoffMs?: number;
  fetchImplementation?: typeof fetch;
  nowMs?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class SecRequestError extends Error {
  readonly code = "NETWORK_FAILURE" as const;
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "SecRequestError";
    this.cause = cause;
  }
}

export class SecRequestPolicy {
  readonly userAgent: string;
  private readonly minimumIntervalMs: number;
  private readonly maximumAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maximumBackoffMs: number;
  private readonly fetchImplementation: typeof fetch;
  private readonly nowMs: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private nextRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(userAgent: string, options: SecRequestPolicyOptions = {}) {
    if (!userAgent.trim() || !(/@/.test(userAgent) || /https?:\/\//i.test(userAgent))) {
      throw new Error("SEC user agent must identify an organization and contact channel");
    }
    this.minimumIntervalMs = options.minimumIntervalMs ?? 125;
    this.maximumAttempts = options.maximumAttempts ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 500;
    this.maximumBackoffMs = options.maximumBackoffMs ?? 4_000;
    if (this.minimumIntervalMs < 100) throw new Error("SEC request interval must be at least 100ms");
    if (!Number.isInteger(this.maximumAttempts) || this.maximumAttempts < 1 || this.maximumAttempts > 5) {
      throw new Error("SEC maximum attempts must be an integer from 1 to 5");
    }
    if (this.baseBackoffMs < 0 || this.maximumBackoffMs < this.baseBackoffMs) {
      throw new Error("SEC retry backoff is invalid");
    }
    this.userAgent = userAgent;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.nowMs = options.nowMs ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const execute = this.queue.then(() => this.fetchWithRetry(url, init));
    this.queue = execute.then(() => undefined, () => undefined);
    return execute;
  }

  private async fetchWithRetry(url: string, init: RequestInit) {
    let lastNetworkError: unknown;
    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      await this.waitForRequestSlot();
      let response: Response;
      try {
        response = await this.fetchImplementation(url, {
          ...init,
          headers: { ...headersRecord(init.headers), "User-Agent": this.userAgent },
        });
      } catch (error) {
        lastNetworkError = error;
        if (attempt === this.maximumAttempts) break;
        await this.sleep(this.retryDelayMs(attempt, null));
        continue;
      }
      if (!isRetryableStatus(response.status) || attempt === this.maximumAttempts) return response;
      await response.body?.cancel().catch(() => undefined);
      await this.sleep(this.retryDelayMs(attempt, response.headers.get("retry-after")));
    }
    throw new SecRequestError(`SEC network request failed after ${this.maximumAttempts} attempts`, lastNetworkError);
  }

  private async waitForRequestSlot() {
    const waitMs = Math.max(0, this.nextRequestAt - this.nowMs());
    if (waitMs > 0) await this.sleep(waitMs);
    this.nextRequestAt = this.nowMs() + this.minimumIntervalMs;
  }

  private retryDelayMs(attempt: number, retryAfter: string | null) {
    const retryAfterMs = parseRetryAfterMs(retryAfter, this.nowMs());
    if (retryAfterMs !== null) return Math.min(retryAfterMs, 30_000);
    return Math.min(this.baseBackoffMs * (2 ** (attempt - 1)), this.maximumBackoffMs);
  }
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function parseRetryAfterMs(value: string | null, nowMs: number) {
  if (!value) return null;
  if (/^[0-9]+$/.test(value.trim())) return Number(value.trim()) * 1_000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - nowMs);
}

function headersRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}

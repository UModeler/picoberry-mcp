/**
 * Thin HTTP client for the PicoBerry public /v1 API.
 *
 * Unwraps the `{ success, data, error }` envelope and raises actionable errors
 * so the calling agent can self-correct (e.g. an unknown engine comes back with
 * the list of valid engine names in `error.message`).
 */

export interface PbEnvelope<T> {
  success: boolean;
  data?: T;
  totalCount?: number;
  error?: { code?: string; message?: string; httpStatus?: number };
}

export class PicoBerryError extends Error {
  code?: string;
  httpStatus?: number;
  constructor(message: string, code?: string, httpStatus?: number) {
    super(message);
    this.name = "PicoBerryError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface RequestOptions {
  json?: unknown;
  /** multipart body (fetch sets the Content-Type + boundary automatically). */
  form?: FormData;
  query?: Record<string, string | number | boolean | undefined>;
}

export class PicoBerryClient {
  constructor(
    private readonly apiKey: string,
    readonly baseUrl: string,
  ) {}

  async request<T = unknown>(
    method: string,
    path: string,
    opts: RequestOptions = {},
  ): Promise<{ data: T; totalCount?: number }> {
    const url = new URL(path, this.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
    };
    let body: string | FormData | undefined;
    if (opts.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form;
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (e) {
      throw new PicoBerryError(
        `Network error calling ${method} ${path}: ${(e as Error).message}`,
      );
    }

    const text = await res.text();
    let env: PbEnvelope<T> | undefined;
    if (text) {
      try {
        env = JSON.parse(text) as PbEnvelope<T>;
      } catch {
        // Non-JSON response (e.g. an upstream proxy error page) — handled below.
      }
    }

    if (!res.ok || (env && env.success === false)) {
      const message =
        env?.error?.message ??
        (text && !env
          ? `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`
          : `HTTP ${res.status} ${res.statusText}`);
      throw new PicoBerryError(
        message,
        env?.error?.code,
        env?.error?.httpStatus ?? res.status,
      );
    }

    if (!env) {
      throw new PicoBerryError(
        `Empty or invalid JSON response from ${method} ${path}`,
      );
    }
    return { data: env.data as T, totalCount: env.totalCount };
  }
}

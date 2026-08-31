export interface HttpClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeout?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
  retryable?: boolean;
  correlationId?: string;
  options?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
  requestId?: string;
}

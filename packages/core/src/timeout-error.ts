/** Error raised when an HTTP request exceeds its configured timeout. */
export class AstroidTimeoutError extends Error {
  readonly code = 'REQUEST_TIMEOUT';
  readonly timeoutMs: number;
  readonly isRetryable = true;

  constructor(timeoutMs: number) {
    super(`Astroid request timed out after ${timeoutMs}ms.`);
    this.name = 'AstroidTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface ExponentialBackoffOptions {
  /** Delay for the first attempt (attempt = 1). */
  readonly baseMs: number;
  /** Upper bound applied before jitter. */
  readonly capMs: number;
  /**
   * When true, add a decorrelating jitter of `floor(random * max(1, capped/4))`
   * on top of the capped delay. Leave OFF for delivery retries so tests stay
   * deterministic; turn ON for reconnect scheduling to avoid thundering herds.
   */
  readonly jitter?: boolean;
}

/**
 * Shared exponential-backoff timing for the outbox worker and the FreeSWITCH
 * event worker, so retry/reconnect delays stay consistent and testable instead
 * of being re-derived (slightly differently) at each call site.
 *
 * `attempt` is 1-based: attempt=1 → baseMs, attempt=2 → 2*baseMs, … each capped
 * at capMs. Callers whose internal counters are 0-based (e.g. a reconnect
 * counter) pass `counter + 1`.
 */
export function exponentialBackoffMs(
  attempt: number,
  options: ExponentialBackoffOptions,
): number {
  const safeAttempt =
    Number.isFinite(attempt) && attempt > 1 ? Math.floor(attempt) : 1;
  const exponent = safeAttempt - 1;
  // baseMs * 2**exponent can overflow to Infinity for large attempts; Math.min
  // with capMs collapses that back to the cap, so no special-casing is needed.
  const capped = Math.max(0, Math.min(options.capMs, options.baseMs * 2 ** exponent));
  if (!options.jitter) return capped;
  return capped + Math.floor(Math.random() * Math.max(1, capped / 4));
}

/**
 * @papergiant/feedback/limit — Limiter, memoryLimiter(), rpcLimiter()
 * (task P4). The companion `sql/postgres-limiter.sql` ships alongside this
 * entry in the published tarball; `rpcLimiter()` is the adapter a host uses
 * to call that SQL's `feedback_rate_take` function (design §5 "Limits").
 *
 * Zero runtime dependencies; nothing here touches the DOM, network or
 * filesystem at import time.
 */

/**
 * What `Limiter.take()` resolves to: `'ok'` if the caller may proceed,
 * `'limited'` if not. A *rejected* promise is a separate, fail-closed
 * refusal (see `Limiter` below) — it is not a third member of this union.
 */
export type LimiterOutcome = 'ok' | 'limited';

/**
 * A rate limiter keyed by an opaque subject (a person reference, never
 * reporter text). A rejected promise means the handler must refuse the
 * request — limiters fail closed, never open.
 */
export interface Limiter {
  take(subject: string): Promise<LimiterOutcome>;
}

/**
 * Thrown when a limiter must refuse rather than answer `'ok'`/`'limited'` —
 * an invalid subject, or, for `rpcLimiter()`, a call that throws, rejects
 * or resolves to anything other than a strict `true`/`false`. The
 * `Limiter` contract's "a throw means refuse" rule made concrete.
 */
export class LimiterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LimiterError';
  }
}

/**
 * The longest subject `memoryLimiter()` and `sql/postgres-limiter.sql`
 * both accept. Kept in sync by hand — the SQL file's `feedback_rate_take`
 * rejects the same bound, so a subject either limiter refuses is refused
 * the same way everywhere a host might wire this package up.
 */
const MAX_SUBJECT_LENGTH = 256;

/** One sliding window: at most `limit` events per `windowMs` milliseconds. */
export interface LimitWindow {
  readonly limit: number;
  readonly windowMs: number;
}

export interface MemoryLimiterOptions {
  /** Per-subject window. Default: 5 per 10 minutes (design §5 default). */
  perSubject?: LimitWindow;
  /** Whole-process window, shared by every subject. Default: 100 per hour. */
  perApp?: LimitWindow;
  /**
   * The most distinct subjects tracked at once. Once reached, a genuinely
   * new subject is refused (see the `MemoryLimiter` doc comment below)
   * rather than evicting a subject that still has live entries.
   */
  maxSubjects?: number;
  /** Injectable clock, for tests. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Declares this process as the only instance of the host that will ever
   * run (see `singleInstance` below). Defaults to `false`.
   */
  singleInstance?: boolean;
}

/**
 * `memoryLimiter()`'s return type. `kind` and `singleInstance` are exposed
 * read-only so `doctor` (task P11) can inspect a configured limiter and
 * warn when an in-process limiter — which cannot coordinate across
 * instances or survive a restart — is wired up for a production host that
 * has not declared itself `singleInstance`.
 */
export interface MemoryLimiter extends Limiter {
  readonly kind: 'memory';
  readonly singleInstance: boolean;
}

const DEFAULT_PER_SUBJECT: LimitWindow = { limit: 5, windowMs: 600_000 };
const DEFAULT_PER_APP: LimitWindow = { limit: 100, windowMs: 3_600_000 };
const DEFAULT_MAX_SUBJECTS = 10_000;

/**
 * An in-process sliding-window limiter for development, tests and hosts
 * that are genuinely single-instance (design §5). It is not shared across
 * processes and its state is lost on restart — `rpcLimiter()` backed by
 * `sql/postgres-limiter.sql` is what production multi-instance hosts use.
 *
 * **Synchronous counting.** Every call's counting and recording happens
 * before the returned promise's first (and only) await point: `take()` is
 * declared `async` but contains no `await`, so its whole body — pruning,
 * the capacity check, both window checks and recording — runs to
 * completion in a single microtask-free pass before control ever returns
 * to the event loop. Firing several `take()` calls back to back without
 * awaiting in between therefore cannot overshoot either window, because
 * JavaScript never interleaves their bodies.
 *
 * **Bounded state.** Each subject's timestamps are pruned to its window on
 * every access to that subject, and a subject whose window empties out is
 * deleted from the map immediately (not left as a stale empty entry) — an
 * expired subject's slot is reusable by the very next call for a new
 * subject once the map is at capacity. When a genuinely new subject
 * arrives and the map already holds `maxSubjects` distinct subjects, a
 * full sweep prunes every subject's window and drops any that are now
 * empty; if that frees no room, `take()` **returns `'limited'`** for the
 * new subject rather than evicting a subject that still has live entries.
 *
 * **Decision recorded (not fully specified by the design or build plan):**
 * capacity exhaustion for a new subject resolves to `'limited'` rather
 * than throwing a `LimiterCapacityError`. Both are conforming under the
 * `Limiter` contract's fail-closed rule (a throw also refuses), but a
 * resolved `'limited'` keeps capacity exhaustion on the same path the
 * handler already has for an ordinary rate-limit refusal, rather than
 * requiring every host to additionally catch a limiter-specific error
 * class just to treat it the same way.
 *
 * **Subject validation matches `sql/postgres-limiter.sql`.** An empty
 * subject, or one longer than 256 characters, throws `LimiterError`
 * rather than being counted — the same bound `feedback_rate_take` enforces
 * (design §5), so a host swapping between `memoryLimiter()` (development)
 * and `rpcLimiter()` (production) sees the same subjects refused either
 * way.
 */
export function memoryLimiter(options: MemoryLimiterOptions = {}): MemoryLimiter {
  const perSubject = options.perSubject ?? DEFAULT_PER_SUBJECT;
  const perApp = options.perApp ?? DEFAULT_PER_APP;
  const maxSubjects = options.maxSubjects ?? DEFAULT_MAX_SUBJECTS;
  const now = options.now ?? Date.now;
  const singleInstance = options.singleInstance ?? false;

  const subjects = new Map<string, number[]>();
  let appEvents: number[] = [];

  /** Drops app-wide events outside the app window. Mutates `appEvents`. */
  function pruneApp(cutoff: number): void {
    if (appEvents.length === 0) return;
    if (appEvents.every((t) => t >= cutoff)) return;
    appEvents = appEvents.filter((t) => t >= cutoff);
  }

  /**
   * Drops a subject's events outside its window, deleting the subject
   * entirely once none remain. Returns the surviving timestamps, or
   * `undefined` when the subject is now absent.
   */
  function pruneSubject(subject: string, cutoff: number): number[] | undefined {
    const timestamps = subjects.get(subject);
    if (!timestamps) return undefined;
    const kept = timestamps.filter((t) => t >= cutoff);
    if (kept.length === 0) {
      subjects.delete(subject);
      return undefined;
    }
    if (kept.length !== timestamps.length) {
      subjects.set(subject, kept);
    }
    return kept;
  }

  /** Prunes every tracked subject, freeing the slot of any now empty. */
  function sweepAll(cutoff: number): void {
    for (const [key, timestamps] of subjects) {
      const kept = timestamps.filter((t) => t >= cutoff);
      if (kept.length === 0) {
        subjects.delete(key);
      } else if (kept.length !== timestamps.length) {
        subjects.set(key, kept);
      }
    }
  }

  return {
    kind: 'memory',
    singleInstance,

    async take(subject) {
      if (subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) {
        throw new LimiterError(
          `memoryLimiter: subject must be between 1 and ${MAX_SUBJECT_LENGTH} characters`,
        );
      }

      const at = now();
      const subjectCutoff = at - perSubject.windowMs;
      const appCutoff = at - perApp.windowMs;

      pruneApp(appCutoff);
      const existing = pruneSubject(subject, subjectCutoff);
      const isNewSubject = existing === undefined;

      if (isNewSubject && subjects.size >= maxSubjects) {
        sweepAll(subjectCutoff);
        if (subjects.size >= maxSubjects) {
          // Capacity exhausted and every tracked subject still has live
          // entries: refuse the new subject without recording anything or
          // evicting anyone (see the decision note above).
          return 'limited';
        }
      }

      const subjectCount = existing?.length ?? 0;
      const appCount = appEvents.length;

      if (subjectCount >= perSubject.limit || appCount >= perApp.limit) {
        return 'limited';
      }

      const timestamps = subjects.get(subject);
      if (timestamps) {
        timestamps.push(at);
      } else {
        subjects.set(subject, [at]);
      }
      appEvents.push(at);

      return 'ok';
    },
  };
}

/** `rpcLimiter()`'s return type. */
export interface RpcLimiter extends Limiter {
  readonly kind: 'rpc';
}

/**
 * Adapts any `(subject) => Promise<unknown>` call that resolves `true` or
 * `false` — such as a Postgres `rpc()` call to `feedback_rate_take` from
 * `sql/postgres-limiter.sql` — into a `Limiter`. Fails closed: a rejected
 * call, or a resolved value that is not exactly `true` or `false`, throws
 * `LimiterError` rather than being treated as `'ok'`.
 *
 * **Supabase's `rpc()` does not itself reject or resolve a bare value** —
 * it resolves `{ data, error }`, with a real request failure landing in
 * `error` rather than as a rejection. Passed straight through, that object
 * is "anything else" to `rpcLimiter()` and would always throw, even on
 * success. Unwrap it in the call you pass in:
 *
 * ```ts
 * rpcLimiter(async (subject) => {
 *   const { data, error } = await client.rpc('feedback_rate_take', { p_subject: subject });
 *   if (error) throw error;
 *   return data;
 * });
 * ```
 */
export function rpcLimiter(call: (subject: string) => Promise<unknown>): RpcLimiter {
  return {
    kind: 'rpc',

    async take(subject) {
      let result: unknown;
      try {
        result = await call(subject);
      } catch (cause) {
        throw new LimiterError('rpcLimiter: the call threw or rejected', { cause });
      }

      if (result === true) return 'ok';
      if (result === false) return 'limited';

      throw new LimiterError(
        `rpcLimiter: the call resolved to a non-boolean value (typeof ${typeof result})`,
      );
    },
  };
}

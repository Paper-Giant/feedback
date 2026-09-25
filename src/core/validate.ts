import { KINDS, LIMITS } from './constants.js';
import type {
  FeedbackClient,
  FeedbackKind,
  ValidatedFeedbackPayload,
} from './types.js';

/**
 * Machine-checkable reasons `validatePayload` can refuse a field. Kept
 * small and stable so a host (or a test) can branch on it without parsing
 * prose.
 */
export type ValidationErrorCode =
  | 'invalid_type'
  | 'unknown_field'
  | 'missing'
  | 'invalid_enum'
  | 'invalid_format'
  | 'too_short'
  | 'too_long'
  | 'control_characters'
  | 'not_allowed';

export interface ValidationError {
  field: string;
  code: ValidationErrorCode;
}

export type ValidationResult =
  | { ok: true; value: ValidatedFeedbackPayload }
  | { ok: false; errors: ValidationError[] };

/**
 * The two pieces of host state `validatePayload` needs and that never come
 * from the browser: the host's configured area keys (design §4 — a
 * payload `area` that isn't one of these normalises to `'unknown'`,
 * silently, never as an error) and whether *this* identity is allowed to
 * supply the staff-only `reference` field (design §5 — `identity`
 * decides this; the browser cannot).
 */
export interface ValidatePayloadOptions {
  areas: Record<string, string | null>;
  allowReference: boolean;
}

const TOP_LEVEL_FIELDS = new Set([
  'schema',
  'report_id',
  'kind',
  'what_happened',
  'expected',
  'reference',
  'diagnostic',
  'area',
  'client',
]);

const CLIENT_STRING_FIELDS = ['release', 'browser', 'viewport', 'locale', 'timezone'] as const;
const CLIENT_FIELDS = new Set<string>([...CLIENT_STRING_FIELDS, 'commit']);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DIAGNOSTIC_PATTERN = /^[a-z0-9-]+:[A-Za-z0-9._-]{1,200}$/;

// Every C0 control except TAB (U+0009) and LF (U+000A), plus DEL and the
// C1 controls (U+007F-U+009F), plus U+2028 LINE SEPARATOR and U+2029
// PARAGRAPH SEPARATOR — both are line terminators under some definitions
// (e.g. ECMAScript's), so a validated string must never be able to start
// a line under any of them. CR (U+000D) is deliberately *not* exempted:
// the design allows only `\n` and `\t` in prose fields.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029]/;

// `reference` is additionally required to be single-line: unlike the
// prose fields, it may not contain `\n` or `\t` either.
const LINE_BREAK_CHARACTERS = /[\n\t]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Counts Unicode code points, not UTF-16 code units, so an astral
 * character (e.g. most emoji) counts once against a cap rather than twice. */
function charLength(text: string): number {
  return Array.from(text).length;
}

function present(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;
}

// `String.prototype.isWellFormed` (ES2024) landed partway through the
// Node 20 line; this package only requires Node >= 20, so it is fed
// through a capability check with a manual-scan fallback rather than
// assumed present. A "not well-formed" string is one containing a lone
// UTF-16 surrogate — half of a surrogate pair with no partner — which
// cannot round-trip through UTF-8 (as every downstream hop here,
// including the GitHub API request body, requires).
type MaybeWellFormedString = string & { isWellFormed?: () => boolean };

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isWellFormedString(value: string): boolean {
  const withCheck = value as MaybeWellFormedString;
  if (typeof withCheck.isWellFormed === 'function') {
    return withCheck.isWellFormed();
  }
  return !LONE_SURROGATE.test(value);
}

/**
 * Validates and normalises a browser-supplied `feedback/v1` payload
 * (design §4; build plan P2).
 *
 * - Unknown top-level or `client` keys are rejected outright — this is how
 *   a browser is kept from ever supplying a server-derived field (`title`,
 *   `source_hint`, `reported_build_skew`, `hints_at`, `receiving_commit`):
 *   none of those is a recognised key, so each one fails as
 *   `unknown_field`.
 * - Every string field must be well-formed Unicode (no lone surrogates),
 *   is then NFC-normalised before its length is measured against its cap,
 *   and is checked for disallowed control characters (anything in the
 *   Unicode `Cc` general category other than `\n`/`\t`, plus U+2028/U+2029).
 * - `area` is the one field that never produces a validation error: a
 *   missing, wrong-typed, or unrecognised value all normalise silently to
 *   `'unknown'`.
 * - All errors are accumulated and returned together rather than
 *   short-circuiting on the first one.
 */
export function validatePayload(json: unknown, opts: ValidatePayloadOptions): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isPlainObject(json)) {
    return { ok: false, errors: [{ field: 'payload', code: 'invalid_type' }] };
  }

  for (const key of Object.keys(json)) {
    if (!TOP_LEVEL_FIELDS.has(key)) {
      errors.push({ field: key, code: 'unknown_field' });
    }
  }

  // schema
  if (json.schema !== 'feedback/v1') {
    errors.push({
      field: 'schema',
      code: json.schema === undefined ? 'missing' : 'invalid_format',
    });
  }

  // report_id — a UUID; accepted case-insensitively and normalised to
  // lowercase, since RFC 4122 treats a UUID's textual case as
  // insignificant and `crypto.randomUUID()` already emits lowercase.
  let reportId: string | undefined;
  if (typeof json.report_id !== 'string') {
    errors.push({
      field: 'report_id',
      code: json.report_id === undefined ? 'missing' : 'invalid_type',
    });
  } else if (!UUID_PATTERN.test(json.report_id)) {
    errors.push({ field: 'report_id', code: 'invalid_format' });
  } else {
    reportId = json.report_id.toLowerCase();
  }

  // kind
  let kind: FeedbackKind | undefined;
  if (typeof json.kind !== 'string') {
    errors.push({ field: 'kind', code: json.kind === undefined ? 'missing' : 'invalid_type' });
  } else if (!KINDS.includes(json.kind as FeedbackKind)) {
    errors.push({ field: 'kind', code: 'invalid_enum' });
  } else {
    kind = json.kind as FeedbackKind;
  }

  // what_happened — required, 1..LIMITS.what_happened; whitespace-only
  // counts as empty (too_short), since it carries no actual report.
  let whatHappened: string | undefined;
  if (typeof json.what_happened !== 'string') {
    errors.push({
      field: 'what_happened',
      code: json.what_happened === undefined ? 'missing' : 'invalid_type',
    });
  } else if (!isWellFormedString(json.what_happened)) {
    errors.push({ field: 'what_happened', code: 'invalid_format' });
  } else {
    const normalised = json.what_happened.normalize('NFC');
    if (CONTROL_CHARACTERS.test(normalised)) {
      errors.push({ field: 'what_happened', code: 'control_characters' });
    } else if (normalised.trim().length === 0) {
      errors.push({ field: 'what_happened', code: 'too_short' });
    } else if (charLength(normalised) > LIMITS.what_happened) {
      errors.push({ field: 'what_happened', code: 'too_long' });
    } else {
      whatHappened = normalised;
    }
  }

  // expected — bugs only, <= LIMITS.expected. Empty or whitespace-only is
  // treated as though the field were never sent at all: no error, no
  // value, no kind gate — a host's form may always include the field and
  // simply leave it blank.
  let expected: string | undefined;
  if (present(json, 'expected')) {
    if (typeof json.expected !== 'string') {
      errors.push({ field: 'expected', code: 'invalid_type' });
    } else if (!isWellFormedString(json.expected)) {
      errors.push({ field: 'expected', code: 'invalid_format' });
    } else {
      const normalised = json.expected.normalize('NFC');
      if (normalised.trim().length === 0) {
        // Treated as absent; nothing to validate or record.
      } else if (CONTROL_CHARACTERS.test(normalised)) {
        errors.push({ field: 'expected', code: 'control_characters' });
      } else if (charLength(normalised) > LIMITS.expected) {
        errors.push({ field: 'expected', code: 'too_long' });
      } else {
        expected = normalised;
        // Only meaningful once `kind` itself is known to be valid; an
        // invalid kind already carries its own error above.
        if (kind !== undefined && kind !== 'bug') {
          errors.push({ field: 'expected', code: 'not_allowed' });
          expected = undefined;
        }
      }
    }
  }

  // reference — staff-only, <= LIMITS.reference, single-line.
  let reference: string | undefined;
  if (present(json, 'reference')) {
    if (typeof json.reference !== 'string') {
      errors.push({ field: 'reference', code: 'invalid_type' });
    } else if (!isWellFormedString(json.reference)) {
      errors.push({ field: 'reference', code: 'invalid_format' });
    } else {
      const normalised = json.reference.normalize('NFC');
      if (CONTROL_CHARACTERS.test(normalised) || LINE_BREAK_CHARACTERS.test(normalised)) {
        errors.push({ field: 'reference', code: 'control_characters' });
      } else if (charLength(normalised) > LIMITS.reference) {
        errors.push({ field: 'reference', code: 'too_long' });
      } else if (!opts.allowReference) {
        errors.push({ field: 'reference', code: 'not_allowed' });
      } else {
        reference = normalised;
      }
    }
  }

  // diagnostic — <= LIMITS.diagnostic, and matching the namespaced-key
  // pattern (whose charset already excludes control characters and
  // surrogates, so no separate well-formed/control-character check is
  // needed here).
  let diagnostic: string | undefined;
  if (present(json, 'diagnostic')) {
    if (typeof json.diagnostic !== 'string') {
      errors.push({ field: 'diagnostic', code: 'invalid_type' });
    } else {
      const normalised = json.diagnostic.normalize('NFC');
      if (charLength(normalised) > LIMITS.diagnostic) {
        errors.push({ field: 'diagnostic', code: 'too_long' });
      } else if (!DIAGNOSTIC_PATTERN.test(normalised)) {
        errors.push({ field: 'diagnostic', code: 'invalid_format' });
      } else {
        diagnostic = normalised;
      }
    }
  }

  // area — never an error; anything unrecognised becomes 'unknown'. Note
  // that `'unknown'` is reserved (see FeedbackHostConfig.areas):
  // renderTicket never emits a source hint for it regardless of what a
  // (misconfigured) host's areas map says.
  const area =
    typeof json.area === 'string' && Object.prototype.hasOwnProperty.call(opts.areas, json.area)
      ? json.area
      : 'unknown';

  // client
  const client: FeedbackClient = {};
  if (present(json, 'client')) {
    if (!isPlainObject(json.client)) {
      errors.push({ field: 'client', code: 'invalid_type' });
    } else {
      const rawClient = json.client;
      for (const key of Object.keys(rawClient)) {
        if (!CLIENT_FIELDS.has(key)) {
          errors.push({ field: `client.${key}`, code: 'unknown_field' });
        }
      }

      for (const field of CLIENT_STRING_FIELDS) {
        if (!present(rawClient, field)) continue;
        const raw = rawClient[field];
        if (typeof raw !== 'string') {
          errors.push({ field: `client.${field}`, code: 'invalid_type' });
          continue;
        }
        if (!isWellFormedString(raw)) {
          errors.push({ field: `client.${field}`, code: 'invalid_format' });
          continue;
        }
        const normalised = raw.normalize('NFC');
        if (CONTROL_CHARACTERS.test(normalised)) {
          errors.push({ field: `client.${field}`, code: 'control_characters' });
        } else if (charLength(normalised) > LIMITS.client) {
          errors.push({ field: `client.${field}`, code: 'too_long' });
        } else {
          client[field] = normalised;
        }
      }

      if (present(rawClient, 'commit')) {
        const raw = rawClient.commit;
        if (typeof raw !== 'string') {
          errors.push({ field: 'client.commit', code: 'invalid_type' });
        } else if (!COMMIT_PATTERN.test(raw)) {
          errors.push({ field: 'client.commit', code: 'invalid_format' });
        } else {
          client.commit = raw;
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Every field a value's absence would have errored on above is now
  // known to be set; the casts below just tell TypeScript what the
  // control flow already guarantees.
  const value: ValidatedFeedbackPayload = {
    schema: 'feedback/v1',
    report_id: reportId as string,
    kind: kind as FeedbackKind,
    what_happened: whatHappened as string,
    area,
    client,
  };
  if (expected !== undefined) value.expected = expected;
  if (reference !== undefined) value.reference = reference;
  if (diagnostic !== undefined) value.diagnostic = diagnostic;

  return { ok: true, value };
}

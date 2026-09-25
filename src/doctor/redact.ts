/**
 * @papergiant/feedback — `doctor`'s shared value-redaction helper
 * (task P11; Gate R finding 1).
 *
 * `describeArg()` is the one place that decides whether a piece of
 * user-supplied text is safe to echo back in a message doctor prints —
 * a usage error (`src/doctor/config.ts`, `src/bin/doctor.ts`), a check's
 * PASS/FAIL/WARN reason (`src/doctor/checks.ts`, `src/doctor/github-api.ts`),
 * or the top-level "something went wrong" handler
 * (`src/bin/doctor.ts`'s `.catch()`). Every one of those call sites
 * carries a value that ultimately traces back to something a person (or
 * an attacker) supplied — an argv token, an env var, a value read from
 * a `--dotenv-file`, a GitHub label or repository name — so all of them
 * route through this one function rather than each deciding on its own
 * whether a particular string "looks safe enough" to print.
 *
 * `doctor "$(cat key.pem)"` (a private key pasted as a stray positional
 * argument — it starts with `-----BEGIN`, so it looks flag-shaped to the
 * parser) and `doctor --origins "$(base64 -i key.pem)"` (key material
 * handed to a flag that has nothing to do with keys) are the two shapes
 * of mistake this exists to catch: a value that was never meant to be a
 * secret carrier reaching a "here's what you gave me" message anyway.
 * Gate R's finding was that only argv-parsing errors went through this
 * discipline — an unknown top-level *command* and an invalid *origin*
 * both still printed their raw value. This module exists so every
 * remaining call site (and any future one) uses the identical rule
 * rather than a hand-rolled copy of it.
 */

/** The longest raw value this module ever echoes back verbatim. A value
 * is echoed only when it's short and doesn't look like it could be a
 * PEM block or a multi-line secret; otherwise it's identified by its
 * position (when the caller has one — an argv token has a natural
 * 1-indexed position; a config value like an intake repository or a
 * label does not, and passes `position` as `undefined`) and its length
 * only, never its content. */
const MAX_ECHOED_ARG_LENGTH = 32;

export function describeArg(token: string, position?: number): string {
  const safe =
    token.length <= MAX_ECHOED_ARG_LENGTH &&
    !token.includes('\n') &&
    !token.includes('\r') &&
    !token.includes('-----');
  if (safe) return `'${token}'`;
  const notEchoed = `${token.length} characters, not echoed — it may be key material`;
  return position !== undefined ? `at position ${position} (${notEchoed})` : `(${notEchoed})`;
}

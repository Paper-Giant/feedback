/**
 * `neutralise(text)` defuses the Markdown/GitHub constructs reporter text
 * could otherwise trigger once it lands in an issue body, without changing
 * what the text visibly reads as. Design §4: "The design does not rely on
 * GitHub declining to link or notify inside fences" — so this runs whether
 * or not the text is later fenced, and (ticket.ts) whether the text sits in
 * a plain fence or inside a fenced ```json block.
 *
 * Every invisible/formatting code point this function strips is written
 * below, and in source, as a `\u{...}` escape — never pasted as a literal
 * character — so a diff of this file can never hide one the way the text
 * it defends against tries to.
 *
 * The scheme, applied in this order:
 *
 * 1. **Strip invisible, bidi and formatting characters.** Removed outright:
 *    - U+00AD SOFT HYPHEN;
 *    - U+061C ARABIC LETTER MARK;
 *    - U+180E MONGOLIAN VOWEL SEPARATOR;
 *    - U+200B–U+200F: ZERO WIDTH SPACE, ZERO WIDTH NON-JOINER, ZERO WIDTH
 *      JOINER, LEFT-TO-RIGHT MARK, RIGHT-TO-LEFT MARK;
 *    - U+202A–U+202E: the bidi embedding/override controls;
 *    - U+2060 WORD JOINER (any pre-existing one — this function inserts its
 *      own further down, so any WORD JOINER left afterwards is one this
 *      function added, never one the reporter supplied);
 *    - U+2061–U+2064: invisible math operators (function application,
 *      times, separator, plus);
 *    - U+2066–U+2069: the bidi isolate controls;
 *    - U+FEFF ZERO WIDTH NO-BREAK SPACE / byte-order mark;
 *    - U+E0000–U+E007F: the Unicode "tag" characters (the ASCII-smuggling
 *      block — invisible-looking code points that can carry an arbitrary
 *      hidden ASCII payload).
 * 2. **URL separators.** Every literal `://` becomes `[:]//` — e.g.
 *    `https://evil.example/x` reads as `https[:]//evil.example/x`. This
 *    breaks automatic link recognition while staying trivially readable
 *    by eye. (Bare-domain dots are left alone.)
 * 3. **Scheme-less `www.` autolinks.** GitHub Flavored Markdown also
 *    autolinks a bare `www.` address with no scheme; `www.` (case
 *    insensitive) becomes `www[.]`.
 * 4. **`GH-123`-style cross-repo references.** A WORD JOINER is inserted
 *    right after the hyphen, before the digits: `GH-123` becomes
 *    `GH-<WORD JOINER>123`.
 * 5. **`@mentions`.** A WORD JOINER is inserted immediately after `@` when
 *    followed by a mention-shaped character: `@user` becomes
 *    `@<WORD JOINER>user`.
 * 6. **Issue references (`#123`, and the `#123` half of `owner/repo#123`).**
 *    A WORD JOINER is inserted immediately after `#` when followed by a
 *    digit.
 *
 * U+2060 WORD JOINER was chosen over a visible bracket for @/#/GH- because
 * it renders as nothing to a reader — the ticket still reads exactly as
 * the reporter typed it — while breaking the adjacency GitHub’s mention
 * and reference parsers require.
 */

const WORD_JOINER = '\u{2060}';

const INVISIBLE_CHARACTERS =
  /[\u{AD}\u{61C}\u{180E}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}\u{2061}-\u{2064}\u{2066}-\u{2069}\u{FEFF}\u{E0000}-\u{E007F}]/gu;

const URL_SEPARATOR = /:\/\//g;
const WWW_AUTOLINK = /www\./gi;
const GH_REFERENCE = /GH-(?=\d)/gi;
const MENTION = /@(?=[A-Za-z0-9])/g;
const ISSUE_REFERENCE = /#(?=\d)/g;

export function neutralise(text: string): string {
  let out = text.replace(INVISIBLE_CHARACTERS, '');
  out = out.replace(URL_SEPARATOR, '[:]//');
  out = out.replace(WWW_AUTOLINK, (match) => `${match.slice(0, -1)}[.]`);
  out = out.replace(GH_REFERENCE, (match) => `${match}${WORD_JOINER}`);
  out = out.replace(MENTION, `@${WORD_JOINER}`);
  out = out.replace(ISSUE_REFERENCE, `#${WORD_JOINER}`);
  return out;
}

/**
 * @papergiant/feedback — `doctor` `--env-file` parser (task P11).
 *
 * Parses a dotenv-style file **as data**: `NAME=value` lines, single- and
 * double-quoted values, blank lines and full-line `#` comments. It is a
 * plain text parser only — it never shells out, never calls `eval`, and
 * never executes anything the file contains, so a value that happens to
 * look like a shell command (`FOO=$(rm -rf /)`) is stored as that literal
 * string, not run.
 *
 * Deliberately small rather than dotenv-compatible: an unquoted value is
 * the rest of the line, trimmed, with no inline-comment stripping (a `#`
 * inside an unquoted URL or base64 value must not be treated as a
 * comment); a quoted value runs to its matching closing quote, and
 * anything after that closing quote on the same line is ignored, matching
 * common dotenv behaviour. A line that isn't `[export ]NAME=value` or a
 * comment/blank line is ignored rather than rejected, so a stray line in
 * an otherwise-normal `.env` file doesn't abort the whole read.
 */

const ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function isCommentOrBlank(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith('#');
}

/** Unescapes the backslash escapes dotenv-style double-quoted values use. */
function unescapeDoubleQuoted(body: string): string {
  return body.replace(/\\(.)/g, (_match, char: string) => {
    switch (char) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '"':
        return '"';
      case '\\':
        return '\\';
      default:
        return char;
    }
  });
}

/**
 * Reads a quoted value starting at `rest[0]` (`"` or `'`). Returns the
 * unescaped (double-quoted) or literal (single-quoted) value, scanning
 * for the matching unescaped closing quote. Returns `null` if the quote
 * is never closed on this line — an unterminated line is treated the
 * same as a non-matching line: ignored, not thrown.
 */
function readQuotedValue(rest: string): string | null {
  const quote = rest[0];
  let end = -1;
  for (let i = 1; i < rest.length; i++) {
    if (rest[i] === '\\' && quote === '"') {
      i++; // skip the escaped character
      continue;
    }
    if (rest[i] === quote) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  const body = rest.slice(1, end);
  return quote === '"' ? unescapeDoubleQuoted(body) : body;
}

/**
 * Parses `content` into a flat `NAME -> value` map. Later assignments of
 * the same name overwrite earlier ones (last one in the file wins), the
 * same as sourcing a shell file top to bottom would — except nothing here
 * is ever executed.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  // Split on \n or \r\n; a lone \r (old Mac line endings) is not treated
  // as a line break, which is an acceptable narrowing for a modern .env file.
  const lines = content.split(/\r\n|\n/);

  for (const rawLine of lines) {
    if (isCommentOrBlank(rawLine)) continue;

    const match = ASSIGNMENT.exec(rawLine.trim());
    if (!match) continue;

    const [, name, rawValue] = match;
    const trimmedValue = rawValue.trim();

    if (trimmedValue.startsWith('"') || trimmedValue.startsWith("'")) {
      const quoted = readQuotedValue(trimmedValue);
      if (quoted !== null) {
        values[name] = quoted;
        continue;
      }
      // Unterminated quote: fall through and treat the rest of the line
      // as an ordinary unquoted value rather than dropping it silently.
    }

    values[name] = trimmedValue;
  }

  return values;
}

/**
 * `fence(text)` wraps `text` in a Markdown fenced code block using tildes,
 * choosing a fence length **strictly longer** than the longest run of
 * either `~` or `` ` `` found anywhere in `text` (minimum 3), with the
 * info string `text`.
 *
 * Why: a Markdown fence only closes on a line holding at least as many of
 * the fence character as the opener. By measuring the longest run of
 * *either* fence character the reporter's text contains and going one
 * longer, the reporter's own text can never contain a sequence that closes
 * our fence early — regardless of whether they used tildes, backticks, or
 * both — so it cannot "escape" the block into surrounding Markdown.
 */
export function fence(text: string): string {
  const longestRun = (source: string, ch: string): number => {
    let longest = 0;
    let current = 0;
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === ch) {
        current += 1;
        if (current > longest) longest = current;
      } else {
        current = 0;
      }
    }
    return longest;
  };

  const longest = Math.max(longestRun(text, '~'), longestRun(text, '`'));
  const fenceLength = Math.max(longest + 1, 3);
  const bar = '~'.repeat(fenceLength);

  return `${bar}text\n${text}\n${bar}`;
}

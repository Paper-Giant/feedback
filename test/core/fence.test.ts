import { describe, expect, it } from 'vitest';
import { fence } from '../../dist/core/index.js';

describe('fence()', () => {
  it('uses the minimum 3-tilde fence when the text has no ~ or ` runs', () => {
    expect(fence('hello world')).toBe('~~~text\nhello world\n~~~');
  });

  it('uses a 3-tilde fence for text containing only single ~ and ` characters', () => {
    expect(fence('a ~ b ` c')).toBe('~~~text\na ~ b ` c\n~~~');
  });

  it('lengthens the fence past the longest run of tildes in the text', () => {
    // longest run of ~ is 3 -> fence must be 4
    expect(fence('before ~~~ after')).toBe('~~~~text\nbefore ~~~ after\n~~~~');
  });

  it('lengthens the fence past the longest run of backticks in the text', () => {
    // longest run of ` is 5 (a fenced ```` ```` block) -> fence must be 6
    const text = 'code: ````` block';
    expect(fence(text)).toBe(`~~~~~~text\n${text}\n~~~~~~`);
  });

  it('takes the longer of the two runs when both ~ and ` runs are present', () => {
    const text = '~~~~ and ``'; // longest ~ run = 4, longest ` run = 2
    expect(fence(text)).toBe('~~~~~text\n~~~~ and ``\n~~~~~');
  });

  it('is strictly longer than the run, never merely equal to it', () => {
    const text = '~~~~~~~~~~'; // 10 tildes
    const fenced = fence(text);
    const opener = fenced.split('\n')[0];
    expect(opener).toBe('~'.repeat(11) + 'text');
  });

  it('always carries the info string "text" directly after the opening fence', () => {
    const fenced = fence('anything');
    expect(fenced.startsWith('~~~text\n')).toBe(true);
  });

  it('never lets the wrapped text contain a line that could close the fence early', () => {
    const samples = [
      'a'.repeat(50),
      '~'.repeat(2),
      '~'.repeat(7),
      '`'.repeat(4),
      '~`~`~`~`',
      'line one\n~~~\nline two',
      'line one\n``````\nline two',
      '',
    ];
    for (const text of samples) {
      const fenced = fence(text);
      const lines = fenced.split('\n');
      const opener = lines[0];
      const closer = lines[lines.length - 1];
      const fenceLength = opener.length - 'text'.length;
      // Every interior line, if it consists solely of tildes, must be
      // shorter than the fence — otherwise it could act as a closer.
      const interior = lines.slice(1, -1);
      for (const line of interior) {
        if (/^~+$/.test(line)) {
          expect(line.length).toBeLessThan(fenceLength);
        }
      }
      expect(closer).toBe('~'.repeat(fenceLength));
    }
  });
});

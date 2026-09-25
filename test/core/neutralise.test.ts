import { describe, expect, it } from 'vitest';
import { neutralise } from '../../dist/core/index.js';

const WJ = '\u2060'; // WORD JOINER

describe('neutralise()', () => {
  it('defuses an @mention by inserting a word joiner after "@"', () => {
    expect(neutralise('ping @user please')).toBe(`ping @${WJ}user please`);
  });

  it('defuses a bare issue reference like "#12" by inserting a word joiner after "#"', () => {
    expect(neutralise('see #12 for context')).toBe(`see #${WJ}12 for context`);
  });

  it('defuses "GH-12" cross-repo references by inserting a word joiner after the hyphen', () => {
    expect(neutralise('tracked as GH-12')).toBe(`tracked as GH-${WJ}12`);
  });

  it('defuses "GH-12" case-insensitively', () => {
    expect(neutralise('tracked as gh-12')).toBe(`tracked as gh-${WJ}12`);
  });

  it('defuses "owner/repo#12" via the same "#<digit>" rule', () => {
    expect(neutralise('see owner/repo#12')).toBe(`see owner/repo#${WJ}12`);
  });

  it('brackets "://" in a URL, leaving the rest of the string readable', () => {
    expect(neutralise('go to https://evil.example/x')).toBe('go to https[:]//evil.example/x');
  });

  it('does not touch dots in a bare domain (no scheme present)', () => {
    expect(neutralise('visit evil.example/x')).toBe('visit evil.example/x');
  });

  it('defuses a scheme-less "www." autolink, the way GitHub Flavored Markdown recognises it', () => {
    expect(neutralise('visit www.evil.example/x')).toBe('visit www[.]evil.example/x');
  });

  it('defuses "www." case-insensitively', () => {
    expect(neutralise('visit WWW.evil.example/x')).toBe('visit WWW[.]evil.example/x');
  });

  it('leaves a bare domain with no "www." prefix untouched, only bracketing the ones that start with it', () => {
    const text = 'compare evil.example/x against www.evil.example/x';
    expect(neutralise(text)).toBe('compare evil.example/x against www[.]evil.example/x');
  });

  it('strips zero-width space, ZWNJ, ZWJ, word joiner and BOM characters', () => {
    const dirty = `a\u200bb\u200cc\u200dd\u2060e\ufefff`;
    expect(neutralise(dirty)).toBe('abcdef');
  });

  it('strips bidi override controls (U+202A–U+202E)', () => {
    const dirty = 'a\u202ab\u202bc\u202cd\u202de\u202ef';
    expect(neutralise(dirty)).toBe('abcdef');
  });

  it('strips bidi isolate controls (U+2066–U+2069)', () => {
    const dirty = 'a\u2066b\u2067c\u2068d\u2069e';
    expect(neutralise(dirty)).toBe('abcde');
  });

  it('strips U+200E LEFT-TO-RIGHT MARK and U+200F RIGHT-TO-LEFT MARK', () => {
    const dirty = `a${String.fromCodePoint(0x200e)}b${String.fromCodePoint(0x200f)}c`;
    expect(neutralise(dirty)).toBe('abc');
  });

  it('strips U+061C ARABIC LETTER MARK', () => {
    const dirty = `a${String.fromCodePoint(0x061c)}b`;
    expect(neutralise(dirty)).toBe('ab');
  });

  it('strips U+00AD SOFT HYPHEN', () => {
    const dirty = `a${String.fromCodePoint(0x00ad)}b`;
    expect(neutralise(dirty)).toBe('ab');
  });

  it('strips U+180E MONGOLIAN VOWEL SEPARATOR', () => {
    const dirty = `a${String.fromCodePoint(0x180e)}b`;
    expect(neutralise(dirty)).toBe('ab');
  });

  it('strips the invisible math operators U+2061–U+2064', () => {
    const dirty = [0x2061, 0x2062, 0x2063, 0x2064]
      .map((cp) => String.fromCodePoint(cp))
      .join('');
    expect(neutralise(`a${dirty}b`)).toBe('ab');
  });

  it('strips a run of Unicode tag characters (U+E0000–U+E007F, the ASCII-smuggling block)', () => {
    // A run of "tag" code points that spell out hidden ASCII via
    // U+E0020..U+E007E (tag space through tag tilde, offset +0xE0000 from
    // the printable ASCII range), terminated by U+E007F CANCEL TAG.
    const hidden = 'hi';
    const tagRun =
      Array.from(hidden)
        .map((ch) => String.fromCodePoint(0xe0000 + ch.codePointAt(0)!))
        .join('') + String.fromCodePoint(0xe007f);
    expect(neutralise(`a${tagRun}b`)).toBe('ab');
  });

  it('strips a lone tag character at the start of the block (U+E0000)', () => {
    const dirty = `a${String.fromCodePoint(0xe0000)}b`;
    expect(neutralise(dirty)).toBe('ab');
  });

  it('strips a reporter-supplied word joiner before inserting its own, rather than doubling it', () => {
    // The reporter already placed U+2060 right after "@"; neutralise must
    // not leave two word joiners in a row.
    expect(neutralise(`@${WJ}user`)).toBe(`@${WJ}user`);
  });

  it('leaves an "@" with no following mention-shaped character unchanged', () => {
    expect(neutralise('email @ home, or call me')).toBe('email @ home, or call me');
  });

  it('leaves a "#" heading-style character with no following digit unchanged', () => {
    expect(neutralise('# not a heading marker, just a hash')).toBe(
      '# not a heading marker, just a hash',
    );
  });

  it('leaves plain prose with none of these constructs completely unchanged', () => {
    const text = 'When I pick a level and press Continue nothing happens. I have to refresh.';
    expect(neutralise(text)).toBe(text);
  });

  it('neutralises every construct at once in a single hostile string', () => {
    const input =
      'Ping @user re #12 (GH-12 / owner/repo#12) at https://evil.example/x or www.evil.example';
    const expected =
      `Ping @${WJ}user re #${WJ}12 (GH-${WJ}12 / owner/repo#${WJ}12) at https[:]//evil.example/x or www[.]evil.example`;
    expect(neutralise(input)).toBe(expected);
  });
});

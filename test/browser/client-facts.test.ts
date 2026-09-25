import { describe, expect, it } from 'vitest';
import { detectBrowser } from '../../dist/browser/index.js';

const CHROME_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const SAFARI_MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const FIREFOX_LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const EDGE_WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
const CHROME_ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const SAFARI_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('detectBrowser()', () => {
  it('prefers navigator.userAgentData when present', () => {
    const result = detectBrowser({
      userAgentData: { platform: 'macOS', brands: [{ brand: 'Not)A;Brand', version: '99' }, { brand: 'Google Chrome', version: '128.0.0.0' }] },
      userAgent: CHROME_MAC_UA,
    });
    expect(result).toBe('Google Chrome 128 · macOS');
  });

  it('skips Chromium’s GREASE brand entries in userAgentData', () => {
    const result = detectBrowser({
      userAgentData: { platform: 'Windows', brands: [{ brand: 'Not:A-Brand', version: '8' }, { brand: 'Not/A)Brand', version: '24' }, { brand: 'Chromium', version: '128' }] },
      userAgent: '',
    });
    expect(result).toBe('Chromium 128 · Windows');
  });

  it('falls back to UA parsing when userAgentData is absent', () => {
    expect(detectBrowser({ userAgent: CHROME_MAC_UA })).toBe('Chrome 128 · macOS');
    expect(detectBrowser({ userAgent: SAFARI_MAC_UA })).toBe('Safari 17 · macOS');
    expect(detectBrowser({ userAgent: FIREFOX_LINUX_UA })).toBe('Firefox 130 · Linux');
    expect(detectBrowser({ userAgent: EDGE_WINDOWS_UA })).toBe('Edge 128 · Windows');
    expect(detectBrowser({ userAgent: CHROME_ANDROID_UA })).toBe('Chrome 128 · Android');
    expect(detectBrowser({ userAgent: SAFARI_IOS_UA })).toBe('Safari 17 · iOS');
  });

  it('never returns the full user-agent string', () => {
    const result = detectBrowser({ userAgent: CHROME_MAC_UA });
    expect(result).not.toContain('AppleWebKit');
    expect(result).not.toContain('537.36');
    expect(result.length).toBeLessThan(CHROME_MAC_UA.length);
  });

  it('is always at most 100 characters, even for a pathological input', () => {
    const hostileUA = 'Chrome/' + '1'.repeat(500) + '.0 ' + 'Windows NT '.repeat(50);
    const result = detectBrowser({ userAgent: hostileUA });
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('returns an empty string when nothing is available', () => {
    expect(detectBrowser({})).toBe('');
    expect(detectBrowser({ userAgent: '' })).toBe('');
  });

  it('returns just the browser when the OS cannot be determined', () => {
    expect(detectBrowser({ userAgent: 'Chrome/128.0.0.0' })).toBe('Chrome 128');
  });
});

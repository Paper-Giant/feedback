/**
 * @papergiant/feedback/browser — coarse client facts (task P7; design §4:
 * "browser a coarse 'Browser NN · OS' string … never the full UA,
 * ≤ 100 chars"; "viewport `${innerWidth}x${innerHeight}`"; "locale
 * `navigator.language`"; "timezone from
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`").
 *
 * `detectBrowser` is pure (given inputs) and unit-tested directly; the
 * `gather*` functions read `navigator`/`window` at call time and are
 * exercised through the real-browser (P9) suite instead.
 */
import type { FeedbackBuild } from './types.js';

/** The shape of `navigator.userAgentData` this package reads — kept
 * minimal and structural rather than importing `NavigatorUAData` (not
 * every `lib.dom.d.ts` version ships it, and doing so would widen the
 * global `Navigator` type for every consumer of this package). */
export interface UserAgentDataLike {
  platform?: string;
  brands?: ReadonlyArray<{ brand: string; version: string }>;
}

const MAX_BROWSER_LENGTH = 100;

// Chromium's GREASE brand (e.g. "Not:A-Brand", "Not/A)Brand", "Not.A/Brand
// ;Version") intentionally varies release to release so sites can't
// hard-code a brand list; it never names a real engine, so it's excluded.
function isRealBrand(brand: string): boolean {
  return !/not.?a.?brand/i.test(brand);
}

function majorVersion(version: string): string {
  return version.split('.')[0] ?? version;
}

/**
 * Coarse "Browser NN · OS" string from `navigator.userAgentData` when
 * present (the modern, more reliable source), else a small parse of
 * `navigator.userAgent` for the major desktop/mobile browsers and OS
 * families. Never returns the full user-agent string, and is always
 * truncated to `MAX_BROWSER_LENGTH` as a last-resort guard.
 */
export function detectBrowser(input: { userAgentData?: UserAgentDataLike | null; userAgent?: string }): string {
  const { userAgentData, userAgent } = input;

  if (userAgentData && Array.isArray(userAgentData.brands)) {
    const brand = userAgentData.brands.find((entry) => isRealBrand(entry.brand));
    const browserPart = brand ? `${brand.brand} ${majorVersion(brand.version)}` : undefined;
    const osPart = userAgentData.platform && userAgentData.platform.trim() !== '' ? userAgentData.platform : undefined;
    const combined = [browserPart, osPart].filter(Boolean).join(' · ');
    if (combined) return combined.slice(0, MAX_BROWSER_LENGTH);
  }

  const ua = userAgent ?? '';
  if (!ua) return '';

  let browser: string | undefined;
  let version: string | undefined;
  let match: RegExpExecArray | null;

  if ((match = /Edg\/([\d.]+)/.exec(ua))) {
    browser = 'Edge';
    version = match[1];
  } else if ((match = /OPR\/([\d.]+)/.exec(ua))) {
    browser = 'Opera';
    version = match[1];
  } else if ((match = /Firefox\/([\d.]+)/.exec(ua))) {
    browser = 'Firefox';
    version = match[1];
  } else if ((match = /CriOS\/([\d.]+)/.exec(ua))) {
    browser = 'Chrome';
    version = match[1];
  } else if ((match = /Chrome\/([\d.]+)/.exec(ua))) {
    browser = 'Chrome';
    version = match[1];
  } else if (/Version\/([\d.]+).*Safari\//.test(ua)) {
    match = /Version\/([\d.]+)/.exec(ua);
    browser = 'Safari';
    version = match?.[1];
  }

  let os: string | undefined;
  if (/iPhone|iPad|iPod/.test(ua)) {
    os = 'iOS';
  } else if (/Android/.test(ua)) {
    os = 'Android';
  } else if (/Mac OS X/.test(ua)) {
    os = 'macOS';
  } else if (/Windows NT/.test(ua)) {
    os = 'Windows';
  } else if (/CrOS/.test(ua)) {
    os = 'Chrome OS';
  } else if (/Linux/.test(ua)) {
    os = 'Linux';
  }

  const browserPart = browser ? `${browser} ${majorVersion(version ?? '')}`.trim() : undefined;
  const combined = [browserPart, os].filter(Boolean).join(' · ');
  return combined.slice(0, MAX_BROWSER_LENGTH);
}

export interface ClientFacts {
  release?: string;
  commit?: string;
  browser?: string;
  viewport?: string;
  locale?: string;
  timezone?: string;
}

/** Reads `navigator`/`window` at call time; never call at module import time. */
export function gatherClientFacts(build: FeedbackBuild | undefined): ClientFacts {
  const facts: ClientFacts = {};

  const release = build?.release;
  if (release) facts.release = release;
  const commit = build?.commit;
  if (commit) facts.commit = commit;

  try {
    const nav = navigator as Navigator & { userAgentData?: UserAgentDataLike };
    const browser = detectBrowser({ userAgentData: nav.userAgentData, userAgent: nav.userAgent });
    if (browser) facts.browser = browser;
  } catch {
    // navigator unavailable or throwing — leave browser absent.
  }

  try {
    facts.viewport = `${window.innerWidth}x${window.innerHeight}`;
  } catch {
    // window unavailable — leave viewport absent.
  }

  try {
    const locale = navigator.language;
    if (locale) facts.locale = locale;
  } catch {
    // leave locale absent.
  }

  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) facts.timezone = timezone;
  } catch {
    // leave timezone absent.
  }

  return facts;
}

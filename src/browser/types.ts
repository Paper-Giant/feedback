/**
 * @papergiant/feedback/browser — public types for `mountFeedback()` and
 * `mountLauncher()` (task P7; design §3 "Dialog", "Host modals", "Form").
 */

import type { FeedbackKind } from '../core/types.js';
import type { NotSentCode } from '../core/response.js';

/**
 * Build facts a host passes straight through from `buildFacts()` (task
 * P3) or reconstructs from its own inlined bundler values. `''` means
 * absent, so a host that inlines `commit ?? ''` (Next's `env` rejects
 * `null`) never needs the `BuildFacts` type from `@papergiant/feedback/build`.
 */
export interface FeedbackBuild {
  release: string;
  commit?: string | null;
}

/** Every visible string the dialog renders, all overridable (design §3 "Form"). English defaults ship in `./copy.js`. */
export interface FeedbackCopy {
  launcherLabel: string;
  heading: string;
  kindLegend: string;
  kindHelp: string;
  kindBug: string;
  kindIdea: string;
  whatHappenedLabel: string;
  whatHappenedHint: string;
  counterTemplate: string;
  expectedLabel: string;
  referenceLabel: string;
  referenceHint: string;
  detailsSummary: string;
  detailsIntro: string;
  detailsSchema: string;
  detailsReportId: string;
  detailsKind: string;
  detailsArea: string;
  detailsRelease: string;
  detailsCommit: string;
  detailsBrowser: string;
  detailsViewport: string;
  detailsLocale: string;
  detailsTimezone: string;
  areaUnknown: string;
  sendLabel: string;
  sendingLabel: string;
  cancelLabel: string;
  closeLabel: string;
  errorSummaryHeading: string;
  fieldRequired: string;
  fieldTooLong: string;
  fieldInvalid: string;
  receivedTemplate: string;
  notSentHeading: string;
  notSentDefault: string;
  notSentRateLimited: string;
  notSentInvalid: string;
  notSentCredential: string;
  unconfirmedHeading: string;
  unconfirmedMessage: string;
  duplicateWarning: string;
  confirmDuplicateLabel: string;
  refusedOutside: string;
  refusedTooDeep: string;
}

/** `--feedback-*` custom properties the dialog's stylesheet reads (design §3 "Dialog"). */
export interface FeedbackTheme {
  '--feedback-accent'?: string;
  '--feedback-background'?: string;
  '--feedback-foreground'?: string;
  '--feedback-muted'?: string;
  '--feedback-border'?: string;
  '--feedback-danger'?: string;
  '--feedback-radius'?: string;
  '--feedback-font'?: string;
}

/**
 * Open host-modal layers, or a plain open/closed signal (design §3 "Host
 * modals": "the host can replace detection with `isHostModalOpen`;
 * return the list of open layer elements, or a boolean"). Returning the
 * element list lets `mountFeedback` nest when one of them contains the
 * launcher; returning a boolean can only ever gate open-to-`<body>` (a
 * bare `true` gives no containment information, so a launcher can never
 * be proven "inside" it and the request always refuses — see
 * `decideModalPlacement` in `./modal-layers.js`).
 */
export type IsHostModalOpen = () => readonly Element[] | boolean;

/** `onEvent` payloads — ids and codes only, reporter text never appears here (design §3). */
export type FeedbackEvent =
  | { type: 'opened' }
  | { type: 'refused'; reason: 'outside_host_modal' | 'too_many_host_modals' }
  | { type: 'sent' }
  | { type: 'received'; receipt: string }
  | { type: 'not_sent'; code: NotSentCode }
  | { type: 'unconfirmed' };

export interface FeedbackMountOptions {
  /** Default `/api/feedback`. */
  endpoint?: string;
  /** Required, non-empty: where the report goes and who can read it. Throws if missing. */
  notice: string;
  /** Default `false`. Shows the optional staff reference field. */
  allowReference?: boolean;
  /** Valid area keys `setArea()` accepts; anything else sends as `'unknown'`. Default `[]`. */
  areas?: readonly string[];
  build?: FeedbackBuild;
  copy?: Partial<FeedbackCopy>;
  theme?: FeedbackTheme;
  isHostModalOpen?: IsHostModalOpen;
  onEvent?: (event: FeedbackEvent) => void;
}

export interface FeedbackController {
  /** Returns `false` when refused (design §3 "Host modals"); never throws on refusal. */
  open(from?: Element): boolean;
  /**
   * Always closes immediately, including while a Send is in flight — a
   * deliberate, explicit close (the person chose it; the delivery
   * outcome, once it lands, is kept and shown on the next `open()`
   * rather than lost). This is the asymmetry with Escape while sending:
   * the dialog's own `cancel` (Escape's close request) is prevented
   * during a send, because that closure is accidental — a stray
   * keypress must not make an in-flight report's outcome silently
   * disappear — while `close()` (and the Cancel button, which calls it),
   * an unambiguous choice, is never blocked.
   */
  close(): void;
  isOpen(): boolean;
  /** `null` clears the current area (payload sends `'unknown'`). */
  setArea(key: string | null): void;
  /** Removes every DOM node and listener this controller installed. Idempotent. */
  destroy(): void;
}

export interface MountLauncherOptions {
  label?: string;
  side?: 'left' | 'right';
}

export interface LauncherHandle {
  destroy(): void;
}

/** Only these kinds — re-exported so a host building custom UI can rely on one source of truth. */
export type { FeedbackKind };

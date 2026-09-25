/**
 * @papergiant/feedback/browser — default English copy, and the merge with
 * a host's partial overrides (task P7; design §3 "Form": "every visible
 * string").
 */
import type { FeedbackCopy } from './types.js';

export const DEFAULT_COPY: FeedbackCopy = {
  launcherLabel: 'Feedback',
  heading: 'Send feedback',
  kindLegend: 'What kind of report is this?',
  kindHelp: 'Help',
  kindBug: 'Bug',
  kindIdea: 'Idea',
  whatHappenedLabel: 'What happened? What were you doing just before?',
  whatHappenedHint: 'Required.',
  counterTemplate: '{count} of {max} characters',
  expectedLabel: 'What did you expect?',
  referenceLabel: 'Your reference, e.g. ABC 123',
  referenceHint: 'Optional.',
  detailsSummary: 'Details included',
  detailsIntro: 'Sending this report also includes:',
  detailsSchema: 'Schema',
  detailsReportId: 'Report ID',
  detailsKind: 'Kind',
  detailsArea: 'Area',
  detailsRelease: 'Release',
  detailsCommit: 'Commit',
  detailsBrowser: 'Browser',
  detailsViewport: 'Viewport',
  detailsLocale: 'Locale',
  detailsTimezone: 'Timezone',
  areaUnknown: 'unknown',
  sendLabel: 'Send',
  sendingLabel: 'Sending…',
  cancelLabel: 'Cancel',
  closeLabel: 'Close',
  errorSummaryHeading: 'Please fix the following before sending:',
  fieldRequired: 'This is required.',
  fieldTooLong: 'This is too long.',
  fieldInvalid: 'This isn’t valid.',
  receivedTemplate: 'Received · {receipt}',
  notSentHeading: 'Not sent',
  notSentDefault: 'That didn’t send. Your draft is kept — you can try again.',
  notSentRateLimited: 'Too many reports for now — please try again later. Your draft is kept.',
  notSentInvalid: 'Some fields need fixing before this can send.',
  notSentCredential: 'This can’t be sent right now. Your draft is kept — please try again later.',
  unconfirmedHeading: 'Delivery unconfirmed',
  unconfirmedMessage: 'We couldn’t confirm this was received. Your draft is kept.',
  duplicateWarning: 'Sending again may create a duplicate report.',
  confirmDuplicateLabel: 'Send anyway',
  refusedOutside: 'Feedback can’t open over the dialog that’s currently open here.',
  refusedTooDeep: 'Feedback can’t open over more than one dialog at a time.',
};

export function resolveCopy(overrides: Partial<FeedbackCopy> | undefined): FeedbackCopy {
  if (!overrides) return DEFAULT_COPY;
  return { ...DEFAULT_COPY, ...overrides };
}

/** Maps a `not_sent` code (design §5) to the copy shown for it. */
export function notSentMessage(copy: FeedbackCopy, code: string): string {
  switch (code) {
    case 'rate_limited':
      return copy.notSentRateLimited;
    case 'invalid':
      return copy.notSentInvalid;
    case 'unauthenticated':
    case 'credential':
    case 'tracker_refused':
      return copy.notSentCredential;
    default:
      return copy.notSentDefault;
  }
}

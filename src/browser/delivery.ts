/**
 * @papergiant/feedback/browser — the delivery state machine (task P7;
 * design §5 "Delivery states"). Pure: given what `parseFeedbackResponse`
 * (core, P6's reply contract) returned for one Send attempt, decides what
 * the dialog shows, whether the draft is cleared, and whether the next
 * Send must warn about a possible duplicate before it is allowed through.
 */
import type { FeedbackResponse, NotSentCode } from '../core/response.js';

export type DeliveryDisplayState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'received'; receipt: string }
  | { kind: 'not_sent'; code: NotSentCode; fields?: string[] }
  | { kind: 'unconfirmed'; duplicateRisk: boolean };

export interface DeliveryOutcome {
  display: DeliveryDisplayState;
  /** `true` only for `received` — every other outcome keeps the draft (design §5). */
  clearDraft: boolean;
  /** Whether the *next* Send must show the duplicate warning before it may proceed. */
  duplicateRiskNext: boolean;
}

/**
 * `parsed` is `null` for anything `parseFeedbackResponse` could not turn
 * into one of the three reply shapes — a network error, a timeout, a
 * non-JSON body, or a `201` whose body doesn't parse. Per design §5,
 * every one of those is *Delivery unconfirmed*, identically to an
 * explicit `{ status: 'unconfirmed' }` reply: draft and `report_id` kept,
 * and the next Send must warn it may create a duplicate.
 */
export function resolveDeliveryOutcome(parsed: FeedbackResponse | null): DeliveryOutcome {
  if (parsed === null) {
    return { display: { kind: 'unconfirmed', duplicateRisk: true }, clearDraft: false, duplicateRiskNext: true };
  }

  switch (parsed.status) {
    case 'received':
      return { display: { kind: 'received', receipt: parsed.receipt }, clearDraft: true, duplicateRiskNext: false };
    case 'not_sent':
      return {
        display: { kind: 'not_sent', code: parsed.code, fields: parsed.fields },
        clearDraft: false,
        duplicateRiskNext: false,
      };
    case 'unconfirmed':
      return { display: { kind: 'unconfirmed', duplicateRisk: true }, clearDraft: false, duplicateRiskNext: true };
  }
}

/**
 * Whether the *next* Send must still warn it may create a duplicate,
 * given the risk carried into this attempt and this attempt's outcome
 * (review fix, task P7). A `not_sent` always resolves with
 * `duplicateRiskNext: false` on its own — it isn't itself ambiguous —
 * but that must not *clear* a risk left over from an earlier
 * `unconfirmed` attempt: the report that unconfirmed attempt might
 * already have created is still a possible duplicate, so a person who
 * fixes a validation error and resends must still see the warning and
 * still have the same `report_id` reused. Only an explicit `received`
 * clears it.
 */
export function nextDuplicateRisk(current: boolean, outcome: DeliveryOutcome): boolean {
  if (outcome.display.kind === 'received') return false;
  return current || outcome.duplicateRiskNext;
}

/**
 * Whether a `not_sent` outcome should mint a fresh `report_id` for the
 * next Send, rather than keep the current one (review fix, gate R
 * finding 6). `duplicateRiskAfter` is the *already-updated*
 * `nextDuplicateRisk()` result for this same outcome:
 *
 *  - an ordinary definitive refusal (no risk before, none after —
 *    `duplicateRiskAfter` is `false`) carries no ambiguity about whether
 *    a report was already created, so there's nothing this id could
 *    turn out to be a duplicate of — it rotates;
 *  - a `not_sent` that follows an `unconfirmed` attempt
 *    (`duplicateRiskAfter` stays `true`, since a `not_sent` alone never
 *    sets the risk — see `nextDuplicateRisk`) is sticky: that earlier
 *    attempt might already have created a report, and reusing the same
 *    id on retry does not itself stop a second issue being created —
 *    GitHub never looks `report_id` up (design §4) — it only gives a
 *    triager, comparing the two, a way to recognise them as the same
 *    attempt and merge or close the duplicate.
 *
 * Always `false` for anything other than `not_sent` — `received` has
 * its own dedicated reset (a fresh id is *always* minted there, via
 * `mountFeedback`'s `resetDraftAfterReceipt`), and `unconfirmed` must
 * always keep its id.
 */
export function shouldRotateReportId(outcome: DeliveryOutcome, duplicateRiskAfter: boolean): boolean {
  return outcome.display.kind === 'not_sent' && !duplicateRiskAfter;
}

/**
 * @papergiant/feedback/browser — `mountFeedback()` (task P7; design §3
 * "Dialog", "Host modals", "Form"; design §4 "What is sent"; design §5
 * "Delivery states").
 *
 * DOM access only happens inside the functions this module exports —
 * nothing here runs at import time (`test/import-safety.test.ts` checks
 * this for the whole package).
 */
import { KINDS, LIMITS, validatePayload } from '../core/index.js';
import type { FeedbackKind, FeedbackPayload } from '../core/types.js';
import type { FeedbackResponse } from '../core/response.js';
import { parseFeedbackResponse } from '../core/response.js';
import { gatherClientFacts, type ClientFacts } from './client-facts.js';
import { notSentMessage, resolveCopy } from './copy.js';
import { nextDuplicateRisk, resolveDeliveryOutcome, shouldRotateReportId, type DeliveryOutcome } from './delivery.js';
import { decideModalPlacement, queryOpenHostModalLayers } from './modal-layers.js';
import { assembleOutboundPayload, createEmptyDraft, type FeedbackDraft } from './payload.js';
import { scheduleDeferredScrollRestore, type ScrollRestoreHandle } from './scroll-restore.js';
import { adoptFeedbackStyles, applyTheme } from './styles.js';
import { generateUUID } from './uuid.js';
import type {
  FeedbackController,
  FeedbackCopy,
  FeedbackEvent,
  FeedbackMountOptions,
} from './types.js';

const DEFAULT_ENDPOINT = '/api/feedback';
/** No automatic retry (design §5): this only bounds how long one Send
 * attempt waits for a response before it's treated as *Delivery
 * unconfirmed* (review fix, task P7) — a slow or stalled connection must
 * not leave Send disabled and the dialog silent indefinitely. */
const REQUEST_TIMEOUT_MS = 20_000;
const KIND_COPY_KEY: Record<FeedbackKind, keyof FeedbackCopy> = {
  help: 'kindHelp',
  bug: 'kindBug',
  idea: 'kindIdea',
};

interface FieldError {
  field: string;
  code: string;
}

export function mountFeedback(options: FeedbackMountOptions): FeedbackController {
  if (typeof options.notice !== 'string' || options.notice.trim() === '') {
    throw new Error('mountFeedback: options.notice is required and must be a non-empty string.');
  }

  const endpoint = options.endpoint && options.endpoint.trim() !== '' ? options.endpoint : DEFAULT_ENDPOINT;
  const allowReference = options.allowReference ?? false;
  const areas = options.areas ?? [];
  const areasRecord: Record<string, string | null> = Object.fromEntries(areas.map((key) => [key, null]));
  const build = options.build;
  const copy = resolveCopy(options.copy);
  const notice = options.notice;

  const draft: FeedbackDraft = createEmptyDraft(generateUUID());

  let destroyed = false;
  // Gathered once per open() (review fix) and reused both for the
  // "Details included" preview and for the payload actually sent, so the
  // two can never disagree even if, say, the viewport changes while the
  // dialog is open.
  let currentClientFacts: ClientFacts | null = null;
  let hostElement: HTMLElement | null = null;
  let dialogEl: HTMLDialogElement | null = null;
  let formEl: HTMLFormElement | null = null;
  let errorSummaryEl: HTMLDivElement | null = null;
  let errorListEl: HTMLUListElement | null = null;
  let whatHappenedTextarea: HTMLTextAreaElement | null = null;
  let whatHappenedCounterEl: HTMLParagraphElement | null = null;
  let whatHappenedErrorEl: HTMLParagraphElement | null = null;
  let expectedFieldEl: HTMLDivElement | null = null;
  let expectedTextarea: HTMLTextAreaElement | null = null;
  let expectedErrorEl: HTMLParagraphElement | null = null;
  let referenceInput: HTMLInputElement | null = null;
  let referenceErrorEl: HTMLParagraphElement | null = null;
  let detailsListEl: HTMLUListElement | null = null;
  let statusEl: HTMLParagraphElement | null = null;
  let duplicateWarningEl: HTMLDivElement | null = null;
  let sendButton: HTMLButtonElement | null = null;

  let nested = false;
  let sending = false;
  // Whether the *next* Send must warn it may create a duplicate (design
  // §5). Review fix: the warning now shows the moment this becomes true
  // (no separate "arm" click) and a `not_sent` in between two
  // `unconfirmed`-risked attempts does not clear it — see
  // `nextDuplicateRisk` in `./delivery.js`.
  let awaitingDuplicateConfirmation = false;
  // Set when a delivery outcome is applied while the dialog isn't open —
  // the in-flight-send-outlives-a-close case (review fix, item 5): the
  // *next* `open()` must show that outcome once instead of the usual
  // fresh-open blank status.
  let outcomePendingDisplay = false;
  let lastFocused: Element | null = null;

  let refusalAnnouncer: HTMLElement | null = null;
  let refusalTimer: ReturnType<typeof setTimeout> | undefined;
  let escapeGuardActive = false;
  let viewportGuardActive = false;
  let requestTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let requestAbortController: AbortController | undefined;

  // The two deferred requestAnimationFrame passes proceedOpen() schedules
  // (via scheduleDeferredScrollRestore, ./scroll-restore.js) to re-assert
  // the ancestor scroll positions it captured around showModal() (review
  // fix, gate R round 2 finding 2): the returned handle is kept so
  // close()/destroy() can cancel it outright, and `openGeneration` is
  // bumped on every proceedOpen() call so a pass that already fired —
  // cancellation raced it — can still tell its own open() is stale and
  // refuse to restore a position captured for a since-superseded open.
  // Without either, a pending pass could run after close or destroy and
  // stomp on a scroll position the host (or a person) set legitimately
  // in the meantime.
  let pendingScrollRestore: ScrollRestoreHandle | null = null;
  let openGeneration = 0;

  function cancelPendingScrollRestoreFrames(): void {
    pendingScrollRestore?.cancel();
    pendingScrollRestore = null;
  }

  let hasLoggedHostCallbackError = false;

  // ---- host callback safety ---------------------------------------------
  //
  // Everything a host supplies as a callback (`onEvent`, `isHostModalOpen`)
  // runs synchronously inside our own control flow and must never be able
  // to break the dialog (review fix): a throwing `onEvent({type:'sent'})`
  // in particular, left unguarded, would abort `handleSend` before it ever
  // reaches `sending = false` / `setSendingUi(false)`, wedging Send in its
  // busy state permanently. A throwing callback is ignored; at most one
  // `console.error` is logged for the whole lifetime of this controller,
  // naming which callback and the error it threw — never the event or
  // predicate arguments themselves, which is the point of "no payload"
  // even though `onEvent`'s own contract already carries ids and codes
  // only, never reporter text.

  function reportHostCallbackError(name: string, error: unknown): void {
    if (hasLoggedHostCallbackError) return;
    hasLoggedHostCallbackError = true;
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error(`@papergiant/feedback: options.${name} threw and was ignored.`, error);
    }
  }

  function safeEmit(event: FeedbackEvent): void {
    if (!options.onEvent) return;
    try {
      options.onEvent(event);
    } catch (error) {
      reportHostCallbackError('onEvent', error);
    }
  }

  function safeCallIsHostModalOpen(predicate: () => readonly Element[] | boolean): readonly Element[] | boolean | undefined {
    try {
      return predicate();
    } catch (error) {
      reportHostCallbackError('isHostModalOpen', error);
      return undefined;
    }
  }

  function fieldElements(): Partial<Record<string, HTMLElement>> {
    return {
      what_happened: whatHappenedTextarea ?? undefined,
      expected: expectedTextarea ?? undefined,
      reference: referenceInput ?? undefined,
    };
  }

  function fieldErrorEls(): Partial<Record<string, HTMLElement>> {
    return {
      what_happened: whatHappenedErrorEl ?? undefined,
      expected: expectedErrorEl ?? undefined,
      reference: referenceErrorEl ?? undefined,
    };
  }

  function fieldLabels(): Partial<Record<string, string>> {
    return {
      what_happened: copy.whatHappenedLabel,
      expected: copy.expectedLabel,
      reference: copy.referenceLabel,
    };
  }

  function kindLabel(kind: FeedbackKind): string {
    return copy[KIND_COPY_KEY[kind]];
  }

  // ---- construction (lazy, on first open) ------------------------------

  function ensureDialogBuilt(): void {
    if (hostElement) return;

    const host = document.createElement('div');
    host.setAttribute('data-feedback-host', '');
    host.setAttribute('data-testid', 'feedback-host');
    applyTheme(host, options.theme);
    hostElement = host;

    const shadow = host.attachShadow({ mode: 'open' });
    adoptFeedbackStyles(shadow);

    const dialog = document.createElement('dialog');
    dialog.setAttribute('aria-labelledby', 'feedback-heading');
    dialog.setAttribute('aria-describedby', 'feedback-notice');
    dialog.setAttribute('data-testid', 'feedback-dialog');
    dialogEl = dialog;

    const heading = document.createElement('h2');
    heading.id = 'feedback-heading';
    heading.textContent = copy.heading;
    dialog.appendChild(heading);

    const noticeP = document.createElement('p');
    noticeP.id = 'feedback-notice';
    noticeP.className = 'notice';
    noticeP.textContent = notice;
    dialog.appendChild(noticeP);

    const errorSummary = document.createElement('div');
    errorSummary.className = 'error-summary';
    errorSummary.setAttribute('data-testid', 'feedback-error-summary');
    errorSummary.hidden = true;
    errorSummary.tabIndex = -1;
    const errorHeading = document.createElement('p');
    errorHeading.textContent = copy.errorSummaryHeading;
    const errorList = document.createElement('ul');
    errorSummary.append(errorHeading, errorList);
    dialog.appendChild(errorSummary);
    errorSummaryEl = errorSummary;
    errorListEl = errorList;

    const form = document.createElement('form');
    formEl = form;

    const kindFieldset = document.createElement('fieldset');
    const kindLegend = document.createElement('legend');
    kindLegend.textContent = copy.kindLegend;
    kindFieldset.appendChild(kindLegend);
    const kindOptions = document.createElement('div');
    kindOptions.className = 'kind-options';
    for (const kind of KINDS) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'kind';
      radio.value = kind;
      radio.checked = kind === draft.kind;
      radio.setAttribute('data-testid', `feedback-kind-${kind}`);
      radio.addEventListener('change', onKindChange);
      const span = document.createElement('span');
      span.textContent = kindLabel(kind);
      label.append(radio, span);
      kindOptions.appendChild(label);
    }
    kindFieldset.appendChild(kindOptions);
    form.appendChild(kindFieldset);

    const whatField = document.createElement('div');
    whatField.className = 'field';
    const whatLabel = document.createElement('label');
    whatLabel.htmlFor = 'feedback-what';
    whatLabel.textContent = copy.whatHappenedLabel;
    const whatTextarea = document.createElement('textarea');
    whatTextarea.id = 'feedback-what';
    whatTextarea.setAttribute('data-testid', 'feedback-what');
    whatTextarea.required = true;
    whatTextarea.setAttribute('aria-required', 'true');
    whatTextarea.maxLength = LIMITS.what_happened;
    whatTextarea.setAttribute('aria-describedby', 'feedback-what-count feedback-what-error');
    whatTextarea.addEventListener('input', onWhatHappenedInput);
    const whatCounter = document.createElement('p');
    whatCounter.id = 'feedback-what-count';
    whatCounter.className = 'counter';
    const whatError = document.createElement('p');
    whatError.id = 'feedback-what-error';
    whatError.className = 'field-error';
    whatError.hidden = true;
    whatField.append(whatLabel, whatTextarea, whatCounter, whatError);
    form.appendChild(whatField);
    whatHappenedTextarea = whatTextarea;
    whatHappenedCounterEl = whatCounter;
    whatHappenedErrorEl = whatError;

    const expectedField = document.createElement('div');
    expectedField.className = 'field';
    const expectedLabel = document.createElement('label');
    expectedLabel.htmlFor = 'feedback-expected';
    expectedLabel.textContent = copy.expectedLabel;
    const expectedTa = document.createElement('textarea');
    expectedTa.id = 'feedback-expected';
    expectedTa.setAttribute('data-testid', 'feedback-expected');
    expectedTa.maxLength = LIMITS.expected;
    expectedTa.setAttribute('aria-describedby', 'feedback-expected-error');
    expectedTa.addEventListener('input', onExpectedInput);
    const expectedError = document.createElement('p');
    expectedError.id = 'feedback-expected-error';
    expectedError.className = 'field-error';
    expectedError.hidden = true;
    expectedField.append(expectedLabel, expectedTa, expectedError);
    form.appendChild(expectedField);
    expectedFieldEl = expectedField;
    expectedTextarea = expectedTa;
    expectedErrorEl = expectedError;

    if (allowReference) {
      const referenceField = document.createElement('div');
      referenceField.className = 'field';
      const referenceLabel = document.createElement('label');
      referenceLabel.htmlFor = 'feedback-reference';
      referenceLabel.textContent = copy.referenceLabel;
      const referenceInputEl = document.createElement('input');
      referenceInputEl.type = 'text';
      referenceInputEl.id = 'feedback-reference';
      referenceInputEl.setAttribute('data-testid', 'feedback-reference');
      referenceInputEl.maxLength = LIMITS.reference;
      referenceInputEl.setAttribute('aria-describedby', 'feedback-reference-hint feedback-reference-error');
      referenceInputEl.addEventListener('input', onReferenceInput);
      const referenceHint = document.createElement('p');
      referenceHint.id = 'feedback-reference-hint';
      referenceHint.className = 'hint';
      referenceHint.textContent = copy.referenceHint;
      const referenceError = document.createElement('p');
      referenceError.id = 'feedback-reference-error';
      referenceError.className = 'field-error';
      referenceError.hidden = true;
      referenceField.append(referenceLabel, referenceInputEl, referenceHint, referenceError);
      form.appendChild(referenceField);
      referenceInput = referenceInputEl;
      referenceErrorEl = referenceError;
    }

    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = copy.detailsSummary;
    const intro = document.createElement('p');
    intro.textContent = copy.detailsIntro;
    const list = document.createElement('ul');
    list.className = 'details-list';
    details.append(summary, intro, list);
    form.appendChild(details);
    detailsListEl = list;

    const duplicateWarning = document.createElement('div');
    duplicateWarning.className = 'duplicate-warning';
    duplicateWarning.setAttribute('data-testid', 'feedback-duplicate-warning');
    duplicateWarning.hidden = true;
    duplicateWarning.textContent = copy.duplicateWarning;
    form.appendChild(duplicateWarning);
    duplicateWarningEl = duplicateWarning;

    const status = document.createElement('p');
    status.className = 'status';
    status.setAttribute('data-testid', 'feedback-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    // Programmatically focusable (review fix): focus moves here after a
    // delivery outcome, so the announcement is also where focus lands,
    // not just what aria-live happens to read out.
    status.tabIndex = -1;
    form.appendChild(status);
    statusEl = status;

    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.setAttribute('data-cancel', '');
    cancel.setAttribute('data-testid', 'feedback-cancel');
    cancel.textContent = copy.cancelLabel;
    // Deliberately never disabled or guarded, even while sending
    // (review fix, item 5): clicking Cancel is an explicit, unambiguous
    // choice to close now, unlike Escape while sending (see the
    // `cancel` dialog-event listener below), which is prevented because
    // it's more likely an accidental keypress. Either way the delivery
    // outcome, once it lands, is never lost — see `outcomePendingDisplay`.
    cancel.addEventListener('click', () => close());
    const send = document.createElement('button');
    send.type = 'submit';
    send.setAttribute('data-send', '');
    send.setAttribute('data-testid', 'feedback-send');
    send.textContent = copy.sendLabel;
    actions.append(cancel, send);
    form.appendChild(actions);
    sendButton = send;

    // Native constraint validation would otherwise intercept `submit`
    // entirely on an empty required textarea (the browser's own bubble
    // UI, never reaching `onSubmit`) rather than letting our own error
    // summary handle it (review fix) — `required`/`aria-required` stay,
    // for the semantics, but validation itself is ours alone.
    form.noValidate = true;
    form.addEventListener('submit', onSubmit);
    dialog.appendChild(form);
    shadow.appendChild(dialog);

    dialog.addEventListener('close', onDialogClosed);
    // Escape's default 'cancel' → 'close' sequence must not complete
    // while a send is in flight (review fix, item 5): otherwise the
    // dialog disappears mid-request with no way back to what it was
    // doing. `preventDefault` here stops *this* close — deliberately
    // asymmetric with the Cancel button (see its listener above), which
    // is never blocked, because a click is an explicit choice while
    // Escape is more likely an accidental keypress.
    //
    // It does not stop a second, rapid Escape from closing anyway
    // (review fix, item 6 — this is not an engine quirk): the HTML
    // close-watcher spec makes a `cancel` request cancelable only while
    // the page still holds "history-action" user activation, an
    // anti-abuse rule stopping a page from trapping the user in a modal
    // forever by preventing every close attempt — the first prevented
    // `cancel` consumes that activation, so a second Escape shortly
    // after can go through uncancelled on any compliant engine, not
    // just one. Either way, `applyDeliveryOutcome`'s DOM writes never
    // depend on the dialog still being open, so that response is still
    // rendered (via the retained, merely-hidden `<dialog>`) the next
    // time this controller's `open()` runs (`outcomePendingDisplay`).
    dialog.addEventListener('cancel', (event) => {
      if (sending) event.preventDefault();
    });

    updateExpectedVisibility();
    updateCounter();
  }

  // ---- form <-> draft sync ----------------------------------------------

  function onKindChange(event: Event): void {
    const target = event.currentTarget as HTMLInputElement;
    if (!target.checked) return;
    // Every field, kept synchronised into the in-memory draft on every
    // input/change (review fix, gate R finding 5), not copied across
    // only at Send — see `onWhatHappenedInput`/`onExpectedInput`/
    // `onReferenceInput` below for why.
    syncDraftFromForm();
    updateExpectedVisibility();
    refreshDetailsList();
  }

  function onWhatHappenedInput(): void {
    // Kept live in the draft on every keystroke (review fix, gate R
    // finding 5): the draft was previously copied from the form only at
    // Send (`handleSend` -> `syncDraftFromForm`), so unsent text typed
    // and then lost via Cancel, Escape, or the host unmounting the
    // dialog out from under itself (the zombie-recovery path in
    // `open()`) never reached it. Syncing here instead means all three
    // of those paths preserve it automatically — none of them needs its
    // own sync call, because the draft is never stale by the time any
    // of them run.
    syncDraftFromForm();
    updateCounter();
  }

  function onExpectedInput(): void {
    syncDraftFromForm();
  }

  function onReferenceInput(): void {
    syncDraftFromForm();
  }

  function updateCounter(): void {
    if (!whatHappenedTextarea || !whatHappenedCounterEl) return;
    const count = Array.from(whatHappenedTextarea.value).length;
    whatHappenedCounterEl.textContent = copy.counterTemplate
      .replace('{count}', String(count))
      .replace('{max}', String(LIMITS.what_happened));
  }

  function updateExpectedVisibility(): void {
    if (!expectedFieldEl) return;
    expectedFieldEl.hidden = draft.kind !== 'bug';
  }

  function syncDraftFromForm(): void {
    if (!formEl || !whatHappenedTextarea) return;
    const checked = formEl.querySelector<HTMLInputElement>('input[name="kind"]:checked');
    if (checked) draft.kind = checked.value as FeedbackKind;
    draft.whatHappened = whatHappenedTextarea.value;
    draft.expected = expectedTextarea?.value ?? '';
    draft.reference = referenceInput?.value ?? '';
  }

  function syncFormFromDraft(): void {
    if (!formEl || !whatHappenedTextarea) return;
    const radio = formEl.querySelector<HTMLInputElement>(`input[name="kind"][value="${draft.kind}"]`);
    if (radio) radio.checked = true;
    whatHappenedTextarea.value = draft.whatHappened;
    if (expectedTextarea) expectedTextarea.value = draft.expected;
    if (referenceInput) referenceInput.value = draft.reference;
    updateExpectedVisibility();
    updateCounter();

    if (outcomePendingDisplay) {
      // A delivery outcome — including any field errors a not_sent's
      // `fields` carried (review fix) — arrived while this dialog was
      // closed: leave the status text and the field-error DOM
      // `applyDeliveryOutcome` already wrote exactly as they are, shown
      // now instead of the usual fresh-open blank status and cleared
      // errors. `clearValidationErrors()` here would otherwise wipe out
      // field errors the person hasn't even seen yet.
      outcomePendingDisplay = false;
    } else {
      clearValidationErrors();
      if (statusEl) {
        statusEl.textContent = '';
        statusEl.removeAttribute('data-tone');
      }
    }
    refreshDetailsList();
  }

  function refreshDetailsList(): void {
    if (!detailsListEl) return;
    // Gathered once per open() and cached (review fix), not regathered
    // here — see `currentClientFacts`.
    const client = currentClientFacts ?? gatherClientFacts(build);
    const area = draft.area !== null && areas.includes(draft.area) ? draft.area : 'unknown';
    const rows: Array<[string, string | undefined]> = [
      [copy.detailsSchema, 'feedback/v1'],
      [copy.detailsReportId, draft.reportId],
      [copy.detailsKind, kindLabel(draft.kind)],
      [copy.detailsArea, area === 'unknown' ? copy.areaUnknown : area],
      [copy.detailsRelease, client.release],
      [copy.detailsCommit, client.commit],
      [copy.detailsBrowser, client.browser],
      [copy.detailsViewport, client.viewport],
      [copy.detailsLocale, client.locale],
      [copy.detailsTimezone, client.timezone],
    ];
    detailsListEl.replaceChildren(
      ...rows
        .filter((row): row is [string, string] => row[1] !== undefined)
        .map(([label, value]) => {
          const li = document.createElement('li');
          li.textContent = `${label}: ${value}`;
          return li;
        }),
    );
  }

  // ---- validation ---------------------------------------------------------

  function messageForCode(code: string): string {
    switch (code) {
      case 'missing':
      case 'too_short':
        return copy.fieldRequired;
      case 'too_long':
        return copy.fieldTooLong;
      default:
        return copy.fieldInvalid;
    }
  }

  function clearValidationErrors(): void {
    if (errorSummaryEl) errorSummaryEl.hidden = true;
    errorListEl?.replaceChildren();
    const elements = fieldElements();
    const errors = fieldErrorEls();
    for (const key of Object.keys(elements)) {
      elements[key]?.removeAttribute('aria-invalid');
      const errEl = errors[key];
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
      }
    }
  }

  function renderValidationErrors(errors: readonly FieldError[]): void {
    clearValidationErrors();
    if (!errorListEl || !errorSummaryEl) return;
    const elements = fieldElements();
    const errorEls = fieldErrorEls();
    const labels = fieldLabels();
    const items: HTMLLIElement[] = [];
    for (const error of errors) {
      const message = messageForCode(error.code);
      const target = elements[error.field];
      const label = labels[error.field] ?? error.field;
      if (target) {
        target.setAttribute('aria-invalid', 'true');
        const errEl = errorEls[error.field];
        if (errEl) {
          errEl.textContent = message;
          errEl.hidden = false;
        }
      }
      const li = document.createElement('li');
      if (target) {
        const link = document.createElement('a');
        link.href = '#';
        link.textContent = `${label}: ${message}`;
        link.addEventListener('click', (event) => {
          event.preventDefault();
          focusInDialog(target);
        });
        li.appendChild(link);
      } else {
        li.textContent = `${label}: ${message}`;
      }
      items.push(li);
    }
    errorListEl.replaceChildren(...items);
    errorSummaryEl.hidden = false;
    focusInDialog(errorSummaryEl);
  }

  // ---- sending --------------------------------------------------------

  function updateSendButtonLabel(): void {
    if (!sendButton) return;
    if (sending) {
      sendButton.textContent = copy.sendingLabel;
      return;
    }
    sendButton.textContent = awaitingDuplicateConfirmation ? copy.confirmDuplicateLabel : copy.sendLabel;
  }

  function updateDuplicateWarningVisibility(): void {
    if (!duplicateWarningEl) return;
    duplicateWarningEl.hidden = !awaitingDuplicateConfirmation;
  }

  function setSendingUi(isSending: boolean): void {
    // `aria-disabled`, not the `disabled` property (review fix): Chromium
    // and Firefox move focus to <body> the instant a focused button
    // becomes truly disabled, which would yank focus off Send mid-submit.
    // Re-entry while sending is already guarded in `onSubmit` below.
    sendButton?.setAttribute('aria-disabled', isSending ? 'true' : 'false');
    formEl?.setAttribute('aria-busy', isSending ? 'true' : 'false');
  }

  function onSubmit(event: Event): void {
    event.preventDefault();
    if (sending) return;
    void handleSend();
  }

  async function sendReport(payload: FeedbackPayload): Promise<FeedbackResponse | null> {
    // A bounded wait, not a retry (design §5 "no automatic retry, ever";
    // review fix): a stalled connection must not leave Send disabled and
    // the dialog silent forever. A timeout resolves to `null`, exactly
    // like a network error, and is treated as *Delivery unconfirmed*.
    //
    // Both the timer and the controller are kept on controller state,
    // not local variables (review fix, item 8): `destroy()` clears the
    // timer and aborts the request outright, so a still-in-flight Send
    // can't fire a timeout, run `fetch`/`json()`, or touch any DOM after
    // this controller was torn down (belt-and-braces alongside the
    // `destroyed` guards in `handleSend` and `applyDeliveryOutcome`).
    const controller = new AbortController();
    requestAbortController = controller;
    requestTimeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        // A redirect is refused rather than followed (review fix, gate R
        // finding 4): a 307/308 replays the POST body verbatim, possibly
        // to a cross-origin target the report was never meant to leave
        // same-origin for, and `credentials: 'same-origin'` alone
        // doesn't stop that replay. `redirect: 'error'` makes `fetch`
        // reject on *any* redirect, same-origin or not, instead of
        // following it — caught below and treated as *Delivery
        // unconfirmed*, the same as any other network-level failure; no
        // separate path is needed.
        //
        // Deliberately NOT also `mode: 'same-origin'`, despite the
        // review asking for it alongside `redirect: 'error'`: verified
        // directly against this task's own fixture (real P6 handler,
        // task P6) that current WebKit/Safari sends `Origin: null`
        // instead of the real origin on an otherwise-ordinary same-origin
        // POST once `mode: 'same-origin'` is set. This is not a WebKit
        // bug — it's the Fetch spec's own "append a request origin
        // header" algorithm: for a non-GET/HEAD request whose `mode` is
        // not "cors", a `referrerPolicy` of "no-referrer" (required here
        // so the page's path and query never travel in `Referer`) makes
        // the serialized Origin `null` by specification, regardless of
        // engine. The handler's own CSRF check (design §5) explicitly
        // refuses a missing/null Origin, so shipping `mode:
        // 'same-origin'` would make every report on Safari (and any
        // other engine implementing this rule) fail with
        // `forbidden_origin`. `redirect: 'error'` alone already refuses
        // *any* redirect target, cross-origin included, which is the
        // threat this finding names ("a 307/308 replays the POST,
        // possibly cross-origin") — `mode: 'same-origin'` would only add
        // protection against `endpoint` itself being misconfigured to a
        // cross-origin URL, which is a host configuration error, not a
        // response-triggered one, and is out of scope for what a
        // redirect can do to a request that was already same-origin.
        redirect: 'error',
        credentials: 'same-origin',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: controller.signal,
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        return null;
      }
      return parseFeedbackResponse(json);
    } catch {
      return null;
    } finally {
      clearTimeout(requestTimeoutId);
      requestTimeoutId = undefined;
      if (requestAbortController === controller) requestAbortController = undefined;
    }
  }

  async function handleSend(): Promise<void> {
    syncDraftFromForm();
    // Gathered once per open() and cached (review fix): reused here
    // rather than regathered, so the payload actually sent can never
    // disagree with what "Details included" showed.
    const client = currentClientFacts ?? gatherClientFacts(build);
    const candidate = assembleOutboundPayload(draft, { areas, allowReference, client });
    const validation = validatePayload(candidate, { areas: areasRecord, allowReference });
    if (!validation.ok) {
      renderValidationErrors(validation.errors);
      return;
    }
    clearValidationErrors();

    sending = true;
    setSendingUi(true);
    updateSendButtonLabel();
    safeEmit({ type: 'sent' });
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.removeAttribute('data-tone');
    }

    const parsed = await sendReport(candidate);
    // No DOM writes, no onEvent past this point once destroyed (review
    // fix): `destroy()` may have run while the request was in flight.
    if (destroyed) return;

    sending = false;
    setSendingUi(false);
    applyDeliveryOutcome(resolveDeliveryOutcome(parsed));
  }

  /**
   * A no-op once `destroy()` has run (review fix). Otherwise always
   * fully applies the outcome's DOM writes regardless of whether the
   * dialog happens to be open right now — the `<dialog>` element and its
   * fields are only ever hidden, never torn down, by a close, so a
   * response that lands after the person closed it (see the `cancel`
   * listener in `ensureDialogBuilt`, which cannot always prevent that)
   * is still visible the moment they reopen (`outcomePendingDisplay`,
   * consulted by `syncFormFromDraft`).
   */
  function applyDeliveryOutcome(outcome: DeliveryOutcome): void {
    if (destroyed) return;

    awaitingDuplicateConfirmation = nextDuplicateRisk(awaitingDuplicateConfirmation, outcome);
    updateDuplicateWarningVisibility();
    updateSendButtonLabel();

    let fieldsRendered = false;

    switch (outcome.display.kind) {
      case 'received': {
        if (statusEl) {
          statusEl.removeAttribute('data-tone');
          statusEl.textContent = copy.receivedTemplate.replace('{receipt}', outcome.display.receipt);
        }
        safeEmit({ type: 'received', receipt: outcome.display.receipt });
        resetDraftAfterReceipt();
        break;
      }
      case 'not_sent': {
        if (statusEl) {
          statusEl.dataset.tone = 'danger';
          statusEl.textContent = `${copy.notSentHeading}. ${notSentMessage(copy, outcome.display.code)}`;
        }
        safeEmit({ type: 'not_sent', code: outcome.display.code });
        if (outcome.display.fields && outcome.display.fields.length > 0) {
          renderValidationErrors(outcome.display.fields.map((field) => ({ field, code: 'invalid_format' })));
          fieldsRendered = true;
        }
        if (shouldRotateReportId(outcome, awaitingDuplicateConfirmation)) {
          // See `shouldRotateReportId` (review fix, gate R finding 6):
          // an ordinary definitive refusal rotates the id; one that
          // follows an unconfirmed attempt stays sticky.
          draft.reportId = generateUUID();
          refreshDetailsList();
        }
        break;
      }
      case 'unconfirmed': {
        if (statusEl) {
          statusEl.dataset.tone = 'danger';
          // The duplicate warning is folded into this same live-region
          // text (review fix), not left in a visually-separate banner
          // alone: the warning is now visible immediately (no "arm"
          // click first), and it must be *announced*, not merely shown.
          statusEl.textContent = `${copy.unconfirmedHeading}. ${copy.unconfirmedMessage} ${copy.duplicateWarning}`;
        }
        safeEmit({ type: 'unconfirmed' });
        break;
      }
    }

    if (!isOpen()) {
      outcomePendingDisplay = true;
    } else if (!fieldsRendered) {
      // Focus follows the announcement (review fix) — unless
      // `renderValidationErrors` above already moved it to the error
      // summary, which takes precedence.
      focusInDialog(statusEl);
    }
  }

  function resetDraftAfterReceipt(): void {
    draft.reportId = generateUUID();
    draft.kind = 'help';
    draft.whatHappened = '';
    draft.expected = '';
    draft.reference = '';
    // draft.area is deliberately preserved — it reflects where the host
    // says the reporter currently is, not something they typed.

    if (formEl && whatHappenedTextarea) {
      const radio = formEl.querySelector<HTMLInputElement>('input[name="kind"][value="help"]');
      if (radio) radio.checked = true;
      whatHappenedTextarea.value = '';
      if (expectedTextarea) expectedTextarea.value = '';
      if (referenceInput) referenceInput.value = '';
      updateExpectedVisibility();
      updateCounter();
    }
    clearValidationErrors();
    refreshDetailsList();
  }

  // ---- host-modal guards ------------------------------------------------

  function onWindowKeydownCapture(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;

    if (!hostElement?.isConnected) {
      // The host modal we're nested in removed our host element from the
      // document without ever closing our <dialog> (a route change or a
      // redirect while feedback was open inside it, for example) — the
      // zombie case `open()` also recovers from below. Self-heal right
      // here rather than waiting for the next `open()` call, so Escape
      // reaches the host again immediately (review fix, blocker).
      removeEscapeGuard();
      return;
    }

    if (isOpen()) {
      event.stopPropagation();
    }
  }

  function installEscapeGuard(): void {
    if (escapeGuardActive) return;
    window.addEventListener('keydown', onWindowKeydownCapture, true);
    escapeGuardActive = true;
  }

  function removeEscapeGuard(): void {
    if (!escapeGuardActive) return;
    window.removeEventListener('keydown', onWindowKeydownCapture, true);
    escapeGuardActive = false;
  }

  function stopEventPropagation(event: Event): void {
    event.stopPropagation();
  }

  function installScrollGuard(): void {
    if (!hostElement) return;
    hostElement.addEventListener('wheel', stopEventPropagation, { passive: true });
    hostElement.addEventListener('touchstart', stopEventPropagation, { passive: true });
    hostElement.addEventListener('touchmove', stopEventPropagation, { passive: true });
  }

  function removeScrollGuard(): void {
    if (!hostElement) return;
    hostElement.removeEventListener('wheel', stopEventPropagation);
    hostElement.removeEventListener('touchstart', stopEventPropagation);
    hostElement.removeEventListener('touchmove', stopEventPropagation);
  }

  function onVisualViewportChange(): void {
    const vv = window.visualViewport;
    if (!vv || !dialogEl) return;
    dialogEl.style.setProperty('--feedback-vv-height', `${vv.height}px`);
  }

  function installViewportGuard(): void {
    const vv = window.visualViewport;
    if (!vv || viewportGuardActive) return;
    vv.addEventListener('resize', onVisualViewportChange);
    vv.addEventListener('scroll', onVisualViewportChange);
    viewportGuardActive = true;
    onVisualViewportChange();
  }

  function removeViewportGuard(): void {
    const vv = window.visualViewport;
    if (!vv || !viewportGuardActive) return;
    vv.removeEventListener('resize', onVisualViewportChange);
    vv.removeEventListener('scroll', onVisualViewportChange);
    viewportGuardActive = false;
  }

  // ---- refusal announcement --------------------------------------------

  function announceRefusal(message: string, layers: readonly Element[]): void {
    if (refusalTimer !== undefined) clearTimeout(refusalTimer);
    refusalAnnouncer?.remove();

    const container = layers.length > 0 ? layers[layers.length - 1]! : document.body;
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    Object.assign(el.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    container.appendChild(el);
    refusalAnnouncer = el;
    // Appended empty, with the text set on the next frame (review fix):
    // several screen readers only pick up a live region's content
    // *changes*, and can miss text that's already present the instant
    // the region is inserted.
    requestAnimationFrame(() => {
      el.textContent = message;
    });
    refusalTimer = setTimeout(() => {
      el.remove();
      if (refusalAnnouncer === el) refusalAnnouncer = null;
    }, 5000);
  }

  // ---- open / close / destroy -------------------------------------------

  // ---- focus, without ever scrolling the host --------------------------
  //
  // Every programmatic focus call in this module goes through one of the
  // two helpers below (review fix, gate R): a plain `el.focus()` makes
  // the browser scroll *every* scrollable ancestor of `el` to bring it
  // into view, including the host page — opening feedback nested inside
  // a scrolled host modal (design §3) with no `preventScroll` silently
  // reset the host's own scroll position, with no gesture from the
  // person to explain it (e.g. a host's always-open wizard dialog jumping
  // back to its top the moment someone opens feedback partway down it).

  /**
   * Focuses `el`, which lives inside feedback's own dialog, without
   * scrolling anything outside it. `{ preventScroll: true }` suppresses
   * *all* of the browser's automatic scrolling, feedback's own dialog
   * included, so if `el` isn't already visible within the dialog's own
   * scroller, `scrollDialogIntoView` brings it into view there —
   * deliberately not `el.scrollIntoView()`, which would scroll every
   * scrollable ancestor exactly like a bare `focus()` does; only the
   * dialog's own `scrollTop` is ever touched here.
   */
  function focusInDialog(el: HTMLElement | null | undefined): void {
    if (!el) return;
    el.focus({ preventScroll: true });
    scrollDialogIntoView(el);
  }

  /** Adjusts the dialog's own `scrollTop` — and nothing else — so `el`
   * (already known to be inside it) is within its visible bounds. */
  function scrollDialogIntoView(el: HTMLElement): void {
    if (!dialogEl) return;
    const dialogRect = dialogEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < dialogRect.top) {
      dialogEl.scrollTop -= dialogRect.top - elRect.top;
    } else if (elRect.bottom > dialogRect.bottom) {
      dialogEl.scrollTop += elRect.bottom - dialogRect.bottom;
    }
  }

  /** Focuses an element that lives in the *host* page (the launcher),
   * not inside feedback's own dialog — `preventScroll` only, never
   * `scrollDialogIntoView`, which would be meaningless for a target
   * outside the dialog entirely. */
  function focusInHost(el: Element | null | undefined): void {
    if (el instanceof HTMLElement || el instanceof SVGElement) {
      el.focus({ preventScroll: true });
    }
  }

  interface ScrollPosition {
    el: Element;
    scrollTop: number;
    scrollLeft: number;
  }

  /** Every scrollable ancestor from the host element up to (and
   * including) the document's own scrolling element — walked and
   * recorded before `showModal()`, so `restoreAncestorScrollPositions`
   * can undo whatever its own internal default-focusing step disturbed,
   * the host included once nested (see the call site in `proceedOpen`). */
  function captureAncestorScrollPositions(): ScrollPosition[] {
    if (!hostElement) return [];
    const positions: ScrollPosition[] = [];
    let el: Element | null = hostElement.parentElement;
    while (el) {
      positions.push({ el, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft });
      el = el.parentElement;
    }
    const scrollingElement = document.scrollingElement;
    if (scrollingElement && !positions.some((position) => position.el === scrollingElement)) {
      positions.push({ el: scrollingElement, scrollTop: scrollingElement.scrollTop, scrollLeft: scrollingElement.scrollLeft });
    }
    return positions;
  }

  function restoreAncestorScrollPositions(positions: readonly ScrollPosition[]): void {
    for (const { el, scrollTop, scrollLeft } of positions) {
      if (el.scrollTop !== scrollTop) el.scrollTop = scrollTop;
      if (el.scrollLeft !== scrollLeft) el.scrollLeft = scrollLeft;
    }
  }

  function onDialogClosed(): void {
    // Belt-and-braces (review fix, gate R finding 5): every field
    // already syncs into the draft live on input/change, but this
    // covers the rare case of a value changed without one firing (e.g.
    // some IME composition sequences) reaching the draft before close.
    syncDraftFromForm();
    // A still-pending scroll-restore frame from this open must not run
    // after close and stomp on wherever the host's scroll legitimately
    // is by then (review fix, gate R round 2 finding 2).
    cancelPendingScrollRestoreFrames();
    removeEscapeGuard();
    removeScrollGuard();
    removeViewportGuard();
    nested = false;
    const target = lastFocused;
    lastFocused = null;
    focusInHost(target);
  }

  function focusFirstField(): void {
    const firstRadio = formEl?.querySelector<HTMLInputElement>('input[name="kind"]');
    focusInDialog(firstRadio);
  }

  /** Same priority as the end of `applyDeliveryOutcome`: the error
   * summary, if it's the thing actually showing, else the status region
   * — never the first field, which would silently steal attention from
   * a result the person hasn't seen yet (review fix, item 3). */
  function focusPendingOutcome(): void {
    if (errorSummaryEl && !errorSummaryEl.hidden) {
      focusInDialog(errorSummaryEl);
    } else {
      focusInDialog(statusEl);
    }
  }

  function proceedOpen(container: Element | null, from: Element | undefined): boolean {
    ensureDialogBuilt();
    if (!hostElement || !dialogEl) return false;

    const targetParent = container ?? document.body;
    if (hostElement.parentNode !== targetParent) {
      targetParent.appendChild(hostElement);
    }

    lastFocused = from ?? null;
    nested = container !== null;
    if (nested) {
      installEscapeGuard();
      installScrollGuard();
    }
    installViewportGuard();

    // Gathered once per open() (review fix), not on every render of the
    // "Details included" list or every Send — see `currentClientFacts`.
    currentClientFacts = gatherClientFacts(build);

    const showingPendingOutcome = outcomePendingDisplay;
    syncFormFromDraft();

    // `showModal()` itself — not any of our own subsequent `.focus()`
    // calls, which already carry `{ preventScroll: true }` via
    // `focusInDialog`/`focusInHost` — performs the browser's own default
    // "dialog focusing steps" as part of its own algorithm, before
    // control ever returns here: with nothing carrying `autofocus`, that
    // moves focus to a default descendant with no `preventScroll` of its
    // own, so it scrolls every scrollable ancestor (the host, once
    // nested) to bring the dialog into view regardless of what this
    // function does afterward. Capturing every ancestor scroller's
    // position first and restoring it right after — synchronously, same
    // tick, before paint — undoes exactly that, without needing to
    // intercept a browser-internal step this module has no hook into.
    // Cancels any still-pending restore frames from a previous open that
    // was never cleanly closed (the zombie-recovery path above doesn't
    // go through onDialogClosed()) before scheduling this open's own —
    // belt-and-braces alongside the generation check below, and avoids
    // wasted work restoring a position nothing needs restored any more.
    cancelPendingScrollRestoreFrames();
    const myGeneration = ++openGeneration;
    const ancestorScrollPositions = captureAncestorScrollPositions();
    dialogEl.showModal();
    restoreAncestorScrollPositions(ancestorScrollPositions);
    if (showingPendingOutcome) {
      focusPendingOutcome();
    } else {
      focusFirstField();
    }
    restoreAncestorScrollPositions(ancestorScrollPositions);
    // Tracked and cancellable (close()/destroy() below), and each pass
    // checks it's still the current open before restoring anything —
    // either guard alone would do, kept both since a pass that already
    // started running (a cancellation racing it) still needs the
    // staleness check. See ./scroll-restore.js.
    pendingScrollRestore = scheduleDeferredScrollRestore(
      () => restoreAncestorScrollPositions(ancestorScrollPositions),
      () => myGeneration !== openGeneration || destroyed || !isOpen(),
      // Wrapped, not passed as bare references (review fix): `window.
      // requestAnimationFrame`/`cancelAnimationFrame` are native methods
      // that require `this` to be `window` when called — detaching them
      // onto a plain object and invoking them as `scheduler.
      // requestAnimationFrame(...)` throws "Illegal invocation" on
      // Firefox and WebKit (confirmed directly). Each wrapper keeps the
      // actual call a bare global reference, which always resolves the
      // receiver correctly regardless of engine.
      {
        requestAnimationFrame: (callback) => requestAnimationFrame(callback),
        cancelAnimationFrame: (id) => cancelAnimationFrame(id),
      },
    );

    safeEmit({ type: 'opened' });
    return true;
  }

  function refuse(reason: 'outside_host_modal' | 'too_many_host_modals', layers: readonly Element[]): boolean {
    const message = reason === 'too_many_host_modals' ? copy.refusedTooDeep : copy.refusedOutside;
    announceRefusal(message, layers);
    safeEmit({ type: 'refused', reason });
    return false;
  }

  function open(from?: Element): boolean {
    if (destroyed) return false;

    if (dialogEl?.open && !hostElement?.isConnected) {
      // Zombie recovery (review fix, blocker): the host modal we were
      // nested in (or, in principle, whatever held <body> itself) removed
      // our host element from the document without ever closing our
      // <dialog> — removing a node fires no `close` event and leaves
      // `.open` untouched, so without this, `isOpen()` would keep
      // reporting true forever, the window-capture Escape guard would
      // keep eating every Escape on the page (nothing left to remove it,
      // since `onDialogClosed` never runs), and this very function would
      // return `true` below showing nothing. Recover synchronously: tear
      // the guards down by hand, then fall through to an ordinary open.
      // Deliberately `removeAttribute('open')`, not `dialogEl.close()` —
      // `.close()`'s `close` event is dispatched asynchronously, and by
      // the time it arrived it would tear down the *new* guards this
      // call is about to install instead of the stale ones.
      removeEscapeGuard();
      removeScrollGuard();
      removeViewportGuard();
      nested = false;
      lastFocused = null;
      dialogEl.removeAttribute('open');
    } else if (isOpen()) {
      return true;
    }

    const ownHosts = hostElement ? [hostElement] : [];

    if (options.isHostModalOpen) {
      const result = safeCallIsHostModalOpen(options.isHostModalOpen);
      if (result !== undefined) {
        if (typeof result === 'boolean') {
          return result ? refuse('outside_host_modal', []) : proceedOpen(null, from);
        }
        const layers = Array.from(result).filter(
          (el) => el.isConnected && !ownHosts.some((host) => host === el || host.contains(el)),
        );
        const decision = decideModalPlacement(layers, from ?? null);
        if (decision.kind === 'refused') return refuse(decision.reason, layers);
        return proceedOpen(decision.kind === 'nested' ? decision.container : null, from);
      }
      // The predicate threw (review fix): ignored, falling through to the
      // default DOM-query detection below, exactly as if isHostModalOpen
      // had never been provided.
    }

    const layers = queryOpenHostModalLayers(ownHosts);
    const decision = decideModalPlacement(layers, from ?? null);
    if (decision.kind === 'refused') return refuse(decision.reason, layers);
    return proceedOpen(decision.kind === 'nested' ? decision.container : null, from);
  }

  function close(): void {
    if (!dialogEl || !dialogEl.open) return;
    // Cancel synchronously: the native `close` event (where onDialogClosed() also cancels) is a queued
    // task, and a restore frame can fire before it and stomp on a scroll the host sets right after close().
    cancelPendingScrollRestoreFrames();
    dialogEl.close();
  }

  /**
   * `dialogEl.open` alone is not reliable (review fix, blocker): a host
   * modal can remove our host element from the document (a route change,
   * a redirect) without ever closing our `<dialog>`, which fires no
   * `close` event and leaves `.open` untouched. Requiring the host
   * element to still be connected as well means a zombie controller
   * never reports itself open.
   */
  function isOpen(): boolean {
    return Boolean(dialogEl?.open && hostElement?.isConnected);
  }

  function setArea(key: string | null): void {
    draft.area = key;
    if (isOpen()) refreshDetailsList();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    // Synchronous, immediate teardown (review fix, gate R round 2 finding
    // 2) — `dialogEl.close()` below fires `onDialogClosed()`
    // asynchronously, which cancels these too, but that's too late to
    // stop a frame already queued to fire before that event arrives; the
    // `destroyed` check inside each callback is a second line of defense
    // for exactly that ordering.
    cancelPendingScrollRestoreFrames();
    removeEscapeGuard();
    removeScrollGuard();
    removeViewportGuard();
    if (refusalTimer !== undefined) clearTimeout(refusalTimer);
    refusalAnnouncer?.remove();
    refusalAnnouncer = null;
    // A send still in flight is stopped outright (review fix, item 8),
    // not just left to resolve into a now-destroyed controller: clearing
    // the timer alone would still let fetch/json() run to completion
    // (harmlessly, since `applyDeliveryOutcome` also no-ops once
    // destroyed, but there's no reason to let the request keep going).
    if (requestTimeoutId !== undefined) clearTimeout(requestTimeoutId);
    requestTimeoutId = undefined;
    requestAbortController?.abort();
    requestAbortController = undefined;
    if (dialogEl?.open) dialogEl.close();
    hostElement?.remove();
    hostElement = null;
    dialogEl = null;
    formEl = null;
  }

  return { open, close, isOpen, setArea, destroy };
}

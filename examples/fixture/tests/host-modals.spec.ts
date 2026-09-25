import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test';

/**
 * Real-browser proof for task P7's host-modal handling (design §3 "Host
 * modals"), run against the Radix page which mirrors a host's always-open
 * wizard dialog (`examples/fixture/README.md` "The Radix page").
 * Build plan P9's "Host modals" group; these were `test.fixme` entries in
 * `p9.fixme.spec.ts` until this task filled them in.
 */

async function resetHostSpies(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__hostSpies = { escapeCalls: 0, openChangeCalls: 0, navigateCalls: [] };
  });
}

test.describe('Host modals — nesting', () => {
  test('a launcher inside the Radix dialog nests feedback, accepts typing and clicks, Escape closes only feedback with zero host-spy calls, the host draft is untouched, and focus returns to the launcher', async ({
    page,
  }) => {
    await page.goto('/radix.html');
    await expect(page.evaluate(() => window.__hostSpies)).resolves.toEqual({
      escapeCalls: 0,
      openChangeCalls: 0,
      navigateCalls: [],
    });

    const launcher = page.getByTestId('launcher-inside');
    await launcher.click();

    const dialog = page.getByTestId('feedback-dialog');
    await expect(dialog).toBeVisible();

    // Nested inside the Radix content element, not appended to <body>.
    const nested = await page.evaluate(() => {
      const radixContent = document.querySelector('[role="dialog"][data-state="open"]');
      const host = document.querySelector('[data-testid="feedback-host"]');
      return Boolean(radixContent && host && radixContent.contains(host));
    });
    expect(nested).toBe(true);

    // Accepts typing.
    const textarea = page.getByTestId('feedback-what');
    await textarea.fill('Escape while nested should not touch the host wizard.');
    await expect(textarea).toHaveValue('Escape while nested should not touch the host wizard.');

    // Accepts clicks (a kind radio).
    await page.getByTestId('feedback-kind-bug').check();
    await expect(page.getByTestId('feedback-kind-bug')).toBeChecked();

    // Escape closes only feedback.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    const spiesAfterEscape = await page.evaluate(() => window.__hostSpies);
    expect(spiesAfterEscape).toEqual({ escapeCalls: 0, openChangeCalls: 0, navigateCalls: [] });

    // The host's own draft, inside the same Radix content, is untouched.
    await expect(page.getByTestId('host-draft')).toHaveValue('SENTINEL_FORM');

    // Focus returns to the launcher that opened it.
    await expect(launcher).toBeFocused();

    // The guard is gone: Escape now reaches the host's own handler again.
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__hostSpies!.escapeCalls)).toBeGreaterThan(0);
  });

  test('the guard is also gone once feedback is disabled (which destroys the controller)', async ({ page }) => {
    // Task P8 review item 10/1: there's no imperative `controller.destroy()`
    // exposed to a host any more, and `<FeedbackProvider>` itself is never
    // unmounted here — `pages/radix.tsx`'s `unmount-feedback` test hook
    // flips the provider's `enabled` prop to `false` instead (the tree
    // stays stable throughout, exactly how a host is expected to use this
    // in production). Radix's own dialog (and its Escape handler) is
    // asserted to survive that, since it was never touched either way.
    await page.goto('/radix.html');
    await page.getByTestId('launcher-inside').click();
    const dialog = page.getByTestId('feedback-dialog');
    await expect(dialog).toBeVisible();

    // The feedback dialog is a *native* `<dialog>` opened with
    // `showModal()`, so — correctly — it blocks real pointer interaction
    // with the rest of the page while open, `unmount-feedback` included;
    // that's exactly the point being tested (feedback is disabled, and so
    // the controller destroyed, *while the dialog is still open*, not
    // after an ordinary close has already torn the guard down on its
    // own). A direct DOM click bypasses that hit-testing the way a real
    // pointer click can't, without going anywhere near Escape itself.
    await page.evaluate(() => {
      (document.querySelector('[data-testid="unmount-feedback"]') as HTMLButtonElement).click();
    });
    // `destroy()` removes the whole shadow host element outright — assert
    // it's gone from the DOM, not merely hidden (a `close()`d dialog would
    // also read as hidden, which wouldn't distinguish this from the
    // ordinary-close path the earlier "guard is gone" test already
    // covers).
    await expect(page.getByTestId('feedback-host')).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    await resetHostSpies(page);

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__hostSpies!.escapeCalls)).toBeGreaterThan(0);
  });
});

test.describe('Host modals — refusal', () => {
  test('a launcher outside the open Radix dialog refuses to open, and announces why', async ({ page }) => {
    await page.goto('/radix.html');
    await page.evaluate(() => {
      window.__feedbackEvents!.length = 0;
    });

    // `launcher-inside`'s sibling `launcher-outside` sits behind the
    // Radix overlay by design — that's exactly the refusal case this
    // proves — so Playwright's own pointer-based click() (which refuses
    // to click an element another element visually covers) can't be used
    // here; a direct DOM click still exercises the real
    // <FeedbackButton>'s onClick, including the real `open()` call.
    await page.evaluate(() => {
      (document.querySelector('[data-testid="launcher-outside"]') as HTMLButtonElement).click();
    });

    const opened = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="feedback-host"]');
      const dialog = host?.shadowRoot?.querySelector('[data-testid="feedback-dialog"]') as HTMLDialogElement | null;
      return Boolean(dialog?.open);
    });
    expect(opened).toBe(false);

    const events = await page.evaluate(() => window.__feedbackEvents);
    expect(events).toContainEqual({ type: 'refused', reason: 'outside_host_modal' });

    // A polite live region announcing the refusal is present in the DOM
    // somewhere assistive tech can hear it (design §3: "inside the
    // topmost open host modal if there is one"). Its text is set on the
    // next animation frame (review fix, item 10 — several screen readers
    // miss text already present the instant a live region is inserted),
    // so this polls rather than reading it back synchronously.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const radixContent = document.querySelector('[role="dialog"][data-state="open"]');
          if (!radixContent) return false;
          return Array.from(radixContent.querySelectorAll('[role="status"]')).some((el) => (el.textContent ?? '').length > 0);
        }),
      )
      .toBe(true);
  });

  test('a launcher inside a second, nested Radix dialog refuses — beyond one level of nesting', async ({ page }) => {
    await page.goto('/radix.html');
    await page.getByTestId('open-nested').click();
    await expect(page.getByTestId('launcher-nested-2')).toBeVisible();

    await page.evaluate(() => {
      window.__feedbackEvents!.length = 0;
    });

    await page.getByTestId('launcher-nested-2').click();

    const opened = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="feedback-host"]');
      const dialog = host?.shadowRoot?.querySelector('[data-testid="feedback-dialog"]') as HTMLDialogElement | null;
      return Boolean(dialog?.open);
    });
    expect(opened).toBe(false);

    const events = await page.evaluate(() => window.__feedbackEvents);
    expect(events).toContainEqual({ type: 'refused', reason: 'too_many_host_modals' });
  });
});

/**
 * The two host conditions Gate R finding 10 requires: the Radix content
 * (the actual scroller react-remove-scroll locks) either has nothing to
 * scroll at all, or is overflowing and already pinned at its own bottom
 * boundary — both established before any wheel/touch gesture, so "the
 * host's scrollTop doesn't move" below is checked against a real,
 * already-settled baseline rather than an untouched `0` that was never
 * actually exercised (the bug this replaces: the boundary used to get
 * established only *after* feedback's own scrolling had already been
 * asserted, at the very end of the test, making it decorative). Testing
 * both matters because react-remove-scroll's own chaining behaviour
 * (whether it lets a wheel/touch "fall through" to a nested scroller it
 * can't see inside a shadow root) can differ depending on whether the
 * locked region itself has any room left to scroll — see this file's
 * "grow-host" doc comment in the README on why an earlier fixture
 * revision that capped the wrong element could never even produce the
 * overflowing case.
 *
 * Growing the host (making it overflow at all) is unaffected by opening
 * feedback and so is done up front, before `launcher-inside` is even
 * clicked. *Pinning* it to its exact bottom-boundary scrollTop is
 * deliberately done separately, immediately before the gesture rather
 * than immediately after growing — see the defect this task found,
 * documented in its own `test.fail()` below: opening feedback nested
 * inside an already-scrolled host silently resets the host's scrollTop
 * to `0` on its own, with no gesture involved at all, so pinning any
 * earlier than "right before the gesture" would make these tests assert
 * against a baseline the product has already invalidated for reasons
 * that have nothing to do with the wheel/touch guards being tested here.
 */
const HOST_CONDITIONS = [
  { label: 'the Radix content is not overflowing', overflowing: false },
  { label: 'the Radix content is overflowing and already at its own bottom boundary', overflowing: true },
] as const;

/** The two scrollers feedback itself owns once nested: the outer dialog
 * chrome, and the `what happened` textarea inside it. */
const FEEDBACK_SCROLLERS = [
  { label: 'the dialog scroller', target: 'dialog' as const },
  { label: 'the textarea', target: 'textarea' as const },
] as const;

/** Grows (or leaves short) the host's own scrollable content, before
 * feedback is opened — see the file-header comment above for why pinning
 * to the boundary is a separate, later step. */
async function growHost(page: Page, overflowing: boolean): Promise<Locator> {
  await page.goto('/radix.html');
  if (overflowing) {
    await page.getByTestId('grow-host').click();
  }
  const radixContent = page.locator('[role="dialog"][data-state="open"]').first();
  await expect.poll(() => radixContent.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(overflowing);
  return radixContent;
}

/** Pins the host to its exact bottom-boundary scrollTop (or confirms `0`
 * for the non-overflowing case) and returns that as the baseline the
 * gesture must not disturb. Called immediately before the gesture — see
 * the file-header comment above. */
async function pinHostCondition(radixContent: Locator, overflowing: boolean): Promise<number> {
  if (overflowing) {
    await radixContent.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect
      .poll(() => radixContent.evaluate((el) => el.scrollTop >= el.scrollHeight - el.clientHeight - 1))
      .toBe(true);
  }
  return radixContent.evaluate((el) => el.scrollTop);
}

/** Opens feedback nested (from `launcher-inside`) and fills `what
 * happened` with enough text that both the dialog chrome and the
 * textarea itself independently need to scroll — the host condition
 * (above) is a separate axis from this. */
async function openNestedFeedbackWithLongContent(page: Page): Promise<{ dialog: Locator; textarea: Locator }> {
  await page.getByTestId('launcher-inside').click();
  const dialog = page.getByTestId('feedback-dialog');
  await expect(dialog).toBeVisible();

  const textarea = page.getByTestId('feedback-what');
  const longText = Array.from(
    { length: 150 },
    (_, i) => `Line ${i + 1}: enough filler to make both the feedback dialog and its textarea need their own scrollbars.`,
  ).join('\n');
  await textarea.fill(longText);
  // Blur so the dialog chrome (not the textarea) receives the first wheel.
  await page.getByTestId('feedback-kind-bug').focus();
  // `fill()` leaves the caret at the end of the text, and some engines
  // (Firefox observed) auto-scroll a textarea to keep the caret in view
  // on blur/input — reset both scrollers to a known 0 baseline so the
  // gesture assertions below measure a real, unambiguous increase rather
  // than racing (and timing out against) an already-maxed scrollTop.
  await dialog.evaluate((el) => {
    el.scrollTop = 0;
  });
  await textarea.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect.poll(() => dialog.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => textarea.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  return { dialog, textarea };
}

/** The point to wheel over, or the start/end of a touch-drag, for a given
 * feedback scroller — the dialog's own chrome (away from the textarea)
 * or the textarea itself. */
async function scrollerBox(target: 'dialog' | 'textarea', dialog: Locator, textarea: Locator) {
  return target === 'dialog' ? (await dialog.boundingBox())! : (await textarea.boundingBox())!;
}

async function touchDragUp(
  cdp: Awaited<ReturnType<import('@playwright/test').BrowserContext['newCDPSession']>>,
  x: number,
  startY: number,
  endY: number,
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
  const steps = 6;
  for (let i = 1; i <= steps; i += 1) {
    const y = startY + ((endY - startY) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test.describe('Host modals — scrolling', () => {
  test.use({ viewport: { width: 800, height: 500 } });

  for (const hostCondition of HOST_CONDITIONS) {
    for (const scroller of FEEDBACK_SCROLLERS) {
      test(`wheel: ${scroller.label} scrolls when ${hostCondition.label}, without leaking to or being blocked by the host's scroll lock`, async ({
        page,
      }) => {
        const radixContent = await growHost(page, hostCondition.overflowing);
        const { dialog, textarea } = await openNestedFeedbackWithLongContent(page);
        // Pinned here, immediately before the gesture — see the
        // file-header comment on why not earlier.
        const radixBaseline = await pinHostCondition(radixContent, hostCondition.overflowing);

        const scrollerLocator = scroller.target === 'dialog' ? dialog : textarea;
        const box = await scrollerBox(scroller.target, dialog, textarea);
        // Dialog: near the top of its own chrome, away from the textarea.
        // Textarea: its own centre.
        const point =
          scroller.target === 'dialog'
            ? { x: box.x + box.width / 2, y: box.y + 5 }
            : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.move(point.x, point.y);

        const scrollBefore = await scrollerLocator.evaluate((el) => el.scrollTop);
        // The wheel dispatch is repeated inside the poll (rather than
        // once before it): Firefox was observed to need a couple of
        // "warm-up" wheel ticks before a synthesized wheel event actually
        // moves a scroller's `scrollTop`, even though the same total
        // delta moves it immediately in Chromium and WebKit — this is
        // Playwright's Firefox wheel-input timing, not anything
        // feedback's guard does (the "host didn't move" check below, on
        // the *same* wheel calls, is what actually proves the guard's
        // behaviour).
        await expect
          .poll(async () => {
            await page.mouse.wheel(0, 800);
            return scrollerLocator.evaluate((el) => el.scrollTop);
          })
          .toBeGreaterThan(scrollBefore);

        // The host's own scrollTop is exactly where it was pinned right
        // before this gesture — not merely "unchanged from an untouched
        // 0", but unchanged from a real, already-settled baseline
        // (including, in the boundary case, already-pinned at its own
        // maximum).
        const radixScrollAfter = await radixContent.evaluate((el) => el.scrollTop);
        expect(radixScrollAfter).toBe(radixBaseline);
      });

      test(`touch-drag (Chromium): ${scroller.label} scrolls when ${hostCondition.label}, without moving the host scroller underneath`, async ({
        page,
        browserName,
        context,
      }) => {
        test.skip(browserName !== 'chromium', 'Trusted synthetic touch dispatch is exercised via the Chromium DevTools Protocol.');

        const radixContent = await growHost(page, hostCondition.overflowing);
        const { dialog, textarea } = await openNestedFeedbackWithLongContent(page);
        const radixBaseline = await pinHostCondition(radixContent, hostCondition.overflowing);

        const scrollerLocator = scroller.target === 'dialog' ? dialog : textarea;
        const box = await scrollerBox(scroller.target, dialog, textarea);
        const cdp = await context.newCDPSession(page);

        const scrollBefore = await scrollerLocator.evaluate((el) => el.scrollTop);
        if (scroller.target === 'dialog') {
          await touchDragUp(cdp, box.x + box.width / 2, box.y + 5 + 40, box.y + 5);
        } else {
          await touchDragUp(cdp, box.x + box.width / 2, box.y + box.height - 10, box.y + 10);
        }
        await expect.poll(() => scrollerLocator.evaluate((el) => el.scrollTop)).toBeGreaterThan(scrollBefore);

        // Negative control: none of that reached the host dialog
        // underneath — its scroll position is exactly the baseline
        // pinned right before this gesture.
        const radixScrollAfter = await radixContent.evaluate((el) => el.scrollTop);
        expect(radixScrollAfter).toBe(radixBaseline);
      });
    }
  }
});

/**
 * A review finding: the previous version of this block
 * wheeled over the *outer* Radix content's own bounding box to prove the
 * guard was gone after close/destroy — but a real mouse wheel or
 * touch-drag dispatched there never passes through feedback's shadow
 * host at all (`installScrollGuard`/`removeScrollGuard` in
 * `src/browser/dialog.ts` attach `wheel`/`touchstart`/`touchmove`
 * listeners on the host element itself, calling `stopPropagation()`), so
 * those tests passed identically whether or not the listeners were ever
 * removed — proved by a probe that suppressed the removal calls and
 * watched the tests keep passing regardless.
 *
 * The fix tests propagation *through* the retained host element
 * directly: a synthetic event dispatched on the host element bubbles up
 * through whatever the host's current parent chain is, and an ancestor
 * listener either does or doesn't see it, depending only on whether the
 * host's own `stopPropagation()` listener is still attached — which is
 * exactly the thing under test, independent of any layout/geometry
 * (event type doesn't matter for this: the guard's own
 * `stopEventPropagation` handler doesn't inspect the event beyond
 * calling `stopPropagation()`, so plain `Event`s with `bubbles: true`
 * stand in for real `wheel`/`touchstart`/`touchmove` events without the
 * cross-engine `TouchEvent`/`WheelEvent` constructor differences that
 * would otherwise be irrelevant noise here).
 */
async function dispatchScrollEventsOn(hostHandle: ElementHandle<Element>): Promise<void> {
  await hostHandle.evaluate((el) => {
    for (const type of ['wheel', 'touchstart', 'touchmove']) {
      el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
    }
  });
}

/** Installs a temporary probe listener on `targetHandle` for
 * `wheel`/`touchstart`/`touchmove`, dispatches all three on `hostHandle`,
 * and returns how many of them the probe observed — 0 for every type
 * means the guard stopped every one of them before they reached
 * `targetHandle`; 1 for every type means none of them were stopped. The
 * listener is removed again before returning, so repeated calls (e.g.
 * "blocked while open", then "not blocked after close") on the same
 * `targetHandle` don't accumulate stale state. */
async function countPropagatedScrollEvents(
  hostHandle: ElementHandle<Element>,
  targetHandle: ElementHandle<Element>,
): Promise<{ wheel: number; touchstart: number; touchmove: number }> {
  await targetHandle.evaluate((target) => {
    const counts: Record<string, number> = { wheel: 0, touchstart: 0, touchmove: 0 };
    const listener = (event: Event) => {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
    };
    Object.assign(target, { __probeCounts: counts, __probeListener: listener });
    for (const type of ['wheel', 'touchstart', 'touchmove']) {
      target.addEventListener(type, listener);
    }
  });

  await dispatchScrollEventsOn(hostHandle);

  const counts = await targetHandle.evaluate(
    (target) => (target as unknown as { __probeCounts: { wheel: number; touchstart: number; touchmove: number } }).__probeCounts,
  );
  await targetHandle.evaluate((target) => {
    const rich = target as unknown as { __probeListener: EventListener };
    for (const type of ['wheel', 'touchstart', 'touchmove']) {
      target.removeEventListener(type, rich.__probeListener);
    }
    delete (target as unknown as Record<string, unknown>).__probeListener;
    delete (target as unknown as Record<string, unknown>).__probeCounts;
  });
  return counts;
}

test.describe('Host modals — scrolling: the guard is removed after close and after destroy', () => {
  test.use({ viewport: { width: 800, height: 500 } });

  test('while nested, synthetic wheel/touchstart/touchmove events dispatched on the host element are stopped before they reach the Radix content — after Escape closes feedback, the same events on the same (retained) host element now reach it', async ({
    page,
  }) => {
    await growHost(page, true);
    const { dialog } = await openNestedFeedbackWithLongContent(page);

    // Grabbed once, kept for the whole test (per the fix instructions) —
    // the *same* element node is used for every dispatch below, including
    // after close, so "removed" genuinely means "no longer attached to
    // this node", not "a fresh node that never had it".
    const hostHandle = (await page
      .locator('[data-testid="feedback-host"]')
      .elementHandle())!;
    const radixHandle = (await page.locator('[role="dialog"][data-state="open"]').first().elementHandle())!;

    // While open and nested: every one of the three event types is
    // stopped at the host element — none of them reach the Radix content.
    const whileOpen = await countPropagatedScrollEvents(hostHandle, radixHandle);
    expect(whileOpen).toEqual({ wheel: 0, touchstart: 0, touchmove: 0 });

    // Close feedback — `removeScrollGuard()` (called from
    // `onDialogClosed()`) comes off. The host element itself is only
    // hidden by its now-closed `<dialog>` child, not removed — it's
    // still the exact same node `hostHandle` already points at.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // The exact same events, dispatched on the exact same host node, now
    // reach the Radix content — the positive proof the guard is gone,
    // not merely "a gesture over some other element didn't move
    // anything". Polled, not read once: a native `<dialog>`'s `close`
    // event (which `onDialogClosed()`/`removeScrollGuard()` runs from) is
    // spec'd as a *queued task*, not synchronous with `.close()` itself —
    // `toBeHidden()` above can resolve (the `open` attribute is removed
    // synchronously) before that queued task has actually run, observed
    // as a real, occasional race in this exact test.
    await expect
      .poll(() => countPropagatedScrollEvents(hostHandle, radixHandle))
      .toEqual({ wheel: 1, touchstart: 1, touchmove: 1 });
  });

  test('after feedback is disabled (destroying the controller) while its dialog is still open, synthetic wheel/touchstart/touchmove events dispatched on the retained (now detached) host element reach a probe parent it’s re-appended to', async ({
    page,
  }) => {
    await growHost(page, true);
    await openNestedFeedbackWithLongContent(page);

    const hostHandle = (await page
      .locator('[data-testid="feedback-host"]')
      .elementHandle())!;

    // Destroy while the dialog is still open (review fix, item 1's
    // `enabled` prop; matches "the guard is also gone once feedback is
    // disabled" in the nesting block above) — a direct DOM click bypasses
    // the native modal's own pointer-blocking the same way that test
    // does, since that blocking is exactly the thing being destroyed out
    // from under an open dialog on purpose here.
    await page.evaluate(() => {
      (document.querySelector('[data-testid="unmount-feedback"]') as HTMLButtonElement).click();
    });
    // `destroy()` removes the whole shadow host element from the
    // document outright (`hostElement.remove()`) — `hostHandle` still
    // points at that same, now-detached node (an `ElementHandle` keeps
    // its target alive regardless of document membership).
    await expect(page.getByTestId('feedback-host')).toHaveCount(0);

    // Re-parent the detached host node under a fresh probe container —
    // not appended to the document at all, since DOM event bubbling
    // within a detached subtree works the same as within an attached
    // one, and this deliberately avoids touching the visible page for a
    // check that has nothing to do with layout. If a stale guard
    // listener were still attached to the host node, its
    // `stopPropagation()` would keep the probe from ever seeing these
    // events, regardless of where the node's parent chain now leads.
    const probeHandle = await page.evaluateHandle((host) => {
      const probe = document.createElement('div');
      probe.appendChild(host);
      return probe;
    }, hostHandle);

    const afterDestroy = await countPropagatedScrollEvents(hostHandle, probeHandle as ElementHandle<Element>);
    expect(afterDestroy).toEqual({ wheel: 1, touchstart: 1, touchmove: 1 });
  });
});

test.describe('Host modals — scrolling: opening feedback does not reset the host’s own scroll position', () => {
  test.use({ viewport: { width: 800, height: 500 } });

  test('opening feedback nested inside an already-scrolled host does not reset the host’s scrollTop', async ({ page }) => {
    // Was a documented DEFECT (test.fail()): `src/browser/dialog.ts`'s
    // `focusFirstField()` called `firstRadio?.focus()` with no
    // `{ preventScroll: true }` — the browser default is to scroll every
    // scrollable ancestor of the focused element into view, and even
    // though feedback's dialog is `position: fixed` (so it doesn't affect
    // the host's *layout*), it is still a DOM *descendant* of the Radix
    // content once nested, so that default "scroll into view" walked up
    // to the Radix content and reset its scrollTop to 0 regardless. Fixed
    // in src/browser/dialog.ts: every programmatic focus now goes through
    // `focusInDialog()` (`{ preventScroll: true }`, then — if needed —
    // adjusts only the dialog's own scrollTop, never scrollIntoView(),
    // which would walk back up to every ancestor including the host) or
    // `focusInHost()` (`{ preventScroll: true }` only, for returning
    // focus to the launcher on close); `showModal()`'s own internal
    // default-focusing step (which runs before any of this module's own
    // code, so no `preventScroll` on a later `.focus()` call can reach
    // it) is separately undone by capturing every ancestor scroller's
    // position first and restoring it right after, in `proceedOpen()`.
    //
    // Opened via a direct `open()` call, not `launcher-inside.click()`
    // (review fix): `launcher-inside` sits above the grown filler content
    // in this fixture's DOM order (see the file header above), so once
    // the host is scrolled to its bottom boundary the button itself is
    // scrolled out of view, and Playwright's own pre-click actionability
    // check auto-scrolls it back into view before the click can land —
    // confirmed directly, by tracing every `.focus()` call and by
    // comparing a real `locator.click()` against a same-origin
    // `open()` call with no click involved at all: only the auto-scroll
    // reproduces the reset, and it reproduces identically with feedback's
    // fix already applied, i.e. it is Playwright's test-automation
    // behaviour, not a product defect — a real pointer can't click
    // something off-screen either. `open()` exercises the exact product
    // code path this test means to cover (`showModal()` through
    // `focusFirstField()`) without that confound.
    const radixContent = await growHost(page, true);
    await radixContent.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const radixScrollBeforeOpen = await radixContent.evaluate((el) => el.scrollTop);
    expect(radixScrollBeforeOpen).toBeGreaterThan(0);

    const opened = await page.evaluate(() => {
      const button = document.querySelector('[data-testid="launcher-inside"]') as HTMLButtonElement;
      return window.__feedbackController!.open(button);
    });
    expect(opened).toBe(true);
    await expect(page.getByTestId('feedback-dialog')).toBeVisible();

    const radixScrollAfterOpen = await radixContent.evaluate((el) => el.scrollTop);
    // Opening feedback nested inside an already-scrolled host leaves the
    // host's own scroll position exactly where it was.
    expect(radixScrollAfterOpen).toBe(radixScrollBeforeOpen);
  });
});

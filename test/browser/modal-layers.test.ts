import { describe, expect, it } from 'vitest';
import {
  decideModalPlacement,
  HOST_MODAL_LAYER_SELECTOR,
  HOST_MODAL_LAYER_SELECTOR_FALLBACK,
  queryOpenHostModalLayers,
} from '../../dist/browser/index.js';

/**
 * `decideModalPlacement` only ever calls `.contains()` on a layer element,
 * so it can be exercised with a minimal fake rather than a real DOM
 * (jsdom, which this package doesn't depend on, has no layout engine
 * anyway — see `queryOpenHostModalLayers`, which is real-DOM-only and
 * left to the Playwright suite).
 */
function fakeElement(childrenOfMine: readonly unknown[] = []): Element {
  return {
    contains(other: unknown): boolean {
      return other === this || childrenOfMine.includes(other);
    },
  } as unknown as Element;
}

describe('decideModalPlacement()', () => {
  it('no open host modal layers → mounts to <body>', () => {
    const launcher = fakeElement();
    expect(decideModalPlacement([], launcher)).toEqual({ kind: 'body' });
  });

  it('no layers and no launcher element either → still mounts to <body>', () => {
    expect(decideModalPlacement([], undefined)).toEqual({ kind: 'body' });
    expect(decideModalPlacement([], null)).toEqual({ kind: 'body' });
  });

  it('exactly one layer that contains the launcher → nests inside it', () => {
    const launcher = fakeElement();
    const layer = fakeElement([launcher]);
    expect(decideModalPlacement([layer], launcher)).toEqual({ kind: 'nested', container: layer });
  });

  it('exactly one layer that does not contain the launcher → refused as outside', () => {
    const launcher = fakeElement();
    const layer = fakeElement([]); // does not contain launcher
    expect(decideModalPlacement([layer], launcher)).toEqual({ kind: 'refused', reason: 'outside_host_modal' });
  });

  it('exactly one layer, but no launcher element was given → refused as outside (containment cannot be shown)', () => {
    const layer = fakeElement();
    expect(decideModalPlacement([layer], undefined)).toEqual({ kind: 'refused', reason: 'outside_host_modal' });
    expect(decideModalPlacement([layer], null)).toEqual({ kind: 'refused', reason: 'outside_host_modal' });
  });

  it('two open layers → always refused as too deep, even when one of them contains the launcher', () => {
    const launcher = fakeElement();
    const layerContainingLauncher = fakeElement([launcher]);
    const otherLayer = fakeElement();
    expect(decideModalPlacement([layerContainingLauncher, otherLayer], launcher)).toEqual({
      kind: 'refused',
      reason: 'too_many_host_modals',
    });
  });

  it('more than two layers → also refused as too deep', () => {
    const launcher = fakeElement();
    const layers = [fakeElement([launcher]), fakeElement(), fakeElement()];
    expect(decideModalPlacement(layers, launcher)).toEqual({ kind: 'refused', reason: 'too_many_host_modals' });
  });

  it('the layer itself as the launcher (self-containment) counts as containing it', () => {
    const layer = fakeElement();
    expect(decideModalPlacement([layer], layer)).toEqual({ kind: 'nested', container: layer });
  });
});

describe('HOST_MODAL_LAYER_SELECTOR_FALLBACK', () => {
  it('is the primary selector with dialog:modal swapped for dialog[open], otherwise identical', () => {
    expect(HOST_MODAL_LAYER_SELECTOR_FALLBACK).toBe(HOST_MODAL_LAYER_SELECTOR.replace('dialog:modal', 'dialog[open]'));
    expect(HOST_MODAL_LAYER_SELECTOR_FALLBACK).not.toBe(HOST_MODAL_LAYER_SELECTOR);
  });
});

/**
 * `queryOpenHostModalLayers` is otherwise real-DOM-only and left to the
 * Playwright suite (see the file header), but the review fix (item 7)
 * — falling back to `HOST_MODAL_LAYER_SELECTOR_FALLBACK` when the
 * primary selector throws — needs nothing beyond a `document` with a
 * `querySelectorAll` method, so it's exercised here with a minimal fake
 * rather than a real DOM: every engine this package targets supports
 * `:modal`, so this path can't be provoked from a real browser in CI.
 */
describe('queryOpenHostModalLayers() (review fix, item 7: the :modal fallback)', () => {
  it('falls back to HOST_MODAL_LAYER_SELECTOR_FALLBACK when the primary selector throws', () => {
    const calls: string[] = [];
    const fakeDocument = {
      querySelectorAll(selector: string) {
        calls.push(selector);
        if (selector === HOST_MODAL_LAYER_SELECTOR) {
          throw new Error("':modal' is not a valid selector on this engine");
        }
        return [];
      },
    };
    const previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = fakeDocument;
    try {
      expect(queryOpenHostModalLayers()).toEqual([]);
    } finally {
      (globalThis as { document?: unknown }).document = previousDocument;
    }
    expect(calls).toEqual([HOST_MODAL_LAYER_SELECTOR, HOST_MODAL_LAYER_SELECTOR_FALLBACK]);
  });

  it('does not fall back when the primary selector succeeds', () => {
    const calls: string[] = [];
    const fakeDocument = {
      querySelectorAll(selector: string) {
        calls.push(selector);
        return [];
      },
    };
    const previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = fakeDocument;
    try {
      queryOpenHostModalLayers();
    } finally {
      (globalThis as { document?: unknown }).document = previousDocument;
    }
    expect(calls).toEqual([HOST_MODAL_LAYER_SELECTOR]);
  });
});

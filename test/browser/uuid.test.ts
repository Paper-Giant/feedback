import { describe, expect, it } from 'vitest';
import { generateUUID } from '../../dist/browser/index.js';
import type { RandomSource } from '../../dist/browser/index.js';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateUUID()', () => {
  it('uses randomUUID() when the source provides it', () => {
    const fake: RandomSource = {
      randomUUID: () => 'fixed-uuid-value',
      getRandomValues: () => {
        throw new Error('getRandomValues should not be called when randomUUID() is available');
      },
    };
    expect(generateUUID(fake)).toBe('fixed-uuid-value');
  });

  it('falls back to getRandomValues() when randomUUID is absent, producing a well-formed RFC 4122 v4 UUID', () => {
    let counter = 0;
    const fake: RandomSource = {
      getRandomValues: (array) => {
        for (let i = 0; i < array.length; i += 1) {
          array[i] = (counter * 37 + i) % 256;
        }
        counter += 1;
        return array;
      },
    };
    const id = generateUUID(fake);
    expect(id).toMatch(UUID_V4_PATTERN);
  });

  it('the fallback always sets the version-4 and RFC-4122-variant bits, regardless of the input randomness', () => {
    const allZeros: RandomSource = {
      getRandomValues: (array) => {
        array.fill(0);
        return array;
      },
    };
    expect(generateUUID(allZeros)).toMatch(UUID_V4_PATTERN);

    const allOnes: RandomSource = {
      getRandomValues: (array) => {
        array.fill(0xff);
        return array;
      },
    };
    expect(generateUUID(allOnes)).toMatch(UUID_V4_PATTERN);
  });

  it('defaults to the real global crypto and produces a valid UUID either way (randomUUID or the fallback)', () => {
    const id = generateUUID();
    expect(id).toMatch(UUID_V4_PATTERN);
  });

  it('produces different ids across calls', () => {
    const a = generateUUID();
    const b = generateUUID();
    expect(a).not.toBe(b);
  });
});

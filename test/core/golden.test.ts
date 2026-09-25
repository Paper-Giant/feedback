import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { renderTicket, validatePayload } from '../../dist/core/index.js';
import type {
  FeedbackHostConfig,
  FeedbackIdentity,
  FeedbackPayload,
} from '../../dist/core/index.js';

// Golden-ticket tests (build plan P2's done-when). Each fixture under
// test/golden/ is a triple: <name>.input.json (the payload, identity, host
// and receivedAt that produced it), <name>.expected.md (title + body,
// title on the first line, a blank line, then the body — exactly as
// scripts/regen-golden.mjs writes it) and <name>.labels.json.
//
// The committed *.expected.md/*.labels.json files ARE the contract: this
// test recomputes the ticket from each input and compares byte for byte
// against what is already committed. It does not regenerate anything —
// run `npm run golden:update` for that, and review the diff.

interface FixtureInput {
  payload: FeedbackPayload;
  identity: FeedbackIdentity;
  host: FeedbackHostConfig;
  receivedAt: string;
}

const goldenDir = fileURLToPath(new URL('../golden/', import.meta.url));

const fixtureNames = Array.from(
  new Set(
    readdirSync(goldenDir)
      .filter((f) => f.endsWith('.input.json'))
      .map((f) => f.replace(/\.input\.json$/, '')),
  ),
).sort();

describe('golden tickets', () => {
  it('found the expected fixture set', () => {
    expect(fixtureNames).toEqual([
      'bug-full',
      'bug-minimal',
      'help-full',
      'help-minimal',
      'idea-full',
      'idea-minimal',
      'unknown-area',
    ]);
  });

  for (const name of fixtureNames) {
    it(`renders ${name} to match the committed fixture byte for byte`, () => {
      const input = JSON.parse(
        readFileSync(path.join(goldenDir, `${name}.input.json`), 'utf8'),
      ) as FixtureInput;

      const result = validatePayload(input.payload, {
        areas: input.host.areas,
        allowReference: input.identity.allowReference,
      });
      expect(result.ok, `fixture ${name} should validate`).toBe(true);
      if (!result.ok) return;

      const ticket = renderTicket({
        payload: result.value,
        identity: input.identity,
        host: input.host,
        receivedAt: new Date(input.receivedAt),
      });

      const expectedBody = readFileSync(path.join(goldenDir, `${name}.expected.md`), 'utf8');
      const expectedLabels = JSON.parse(
        readFileSync(path.join(goldenDir, `${name}.labels.json`), 'utf8'),
      ) as string[];

      const actual = `${ticket.title}\n\n${ticket.body}\n`;
      expect(actual).toBe(expectedBody);
      expect(ticket.labels).toEqual(expectedLabels);
    });
  }
});

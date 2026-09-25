#!/usr/bin/env node
// Regenerates the committed golden fixtures in test/golden/ from the fixture
// specs below, using the *built* renderer. Run `npm run golden:update`
// (build + this script), or `npm run build && node scripts/regen-golden.mjs`
// directly.
//
// The committed *.expected.md and *.labels.json files ARE the contract
// (task P2, docs/superpowers/plans/2026-09-25-feedback-0.1-build.md):
// `test/core/golden.test.ts` compares current renderer output against them
// byte for byte. Review any diff this script produces as carefully as a
// behaviour change, because that is exactly what it is.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTicket, validatePayload } from '../dist/core/index.js';

const goldenDir = fileURLToPath(new URL('../test/golden/', import.meta.url));
mkdirSync(goldenDir, { recursive: true });

/** @type {import('../dist/core/index.js').FeedbackHostConfig} */
const host = {
  app: 'example-app',
  displayName: 'Example',
  productRepository: 'example-org/example-app',
  environment: 'uat',
  areas: {
    'checkout-wizard': 'app/(app)/orders/[order_id]/steps/[step_id]/page.tsx',
    'dashboard': null,
  },
  receivingCommit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc',
};

/** A reporter with no staff permissions: no reference, no organisation, no lookup link. */
const placeIdentity = {
  ref: 'c2d3e4f5-6789-4abc-9def-0123456789ab',
  role: 'place_member',
  surface: 'customer',
  allowReference: false,
};

/** A staff reporter: allowed to supply `reference`, resolvable via a lookup link. */
const staffIdentity = {
  ref: '8b203879-7383-4600-bae3-a44a205e91f0',
  role: 'org_admin',
  surface: 'staff',
  organisationRef: '5d0c7e1a-1111-2222-3333-444455556666',
  lookupUrl: 'https://app.example/staff/people/8b203879-7383-4600-bae3-a44a205e91f0',
  allowReference: true,
};

const receivedAt = '2026-09-29T04:12:00.000Z';

const fullClient = {
  release: '2026.09.29-9f4c2a1',
  commit: '9f4c2a1d7e803bd2a61549c0e176fed32208aabc',
  browser: 'Chrome 129 · Windows',
  viewport: '1440x900',
  locale: 'en-AU',
  timezone: 'Australia/Melbourne',
};

const fixtures = [
  {
    name: 'help-minimal',
    identity: placeIdentity,
    payload: {
      schema: 'feedback/v1',
      report_id: '11111111-1111-4111-8111-111111111111',
      kind: 'help',
      what_happened: 'How do I export a round’s results to PDF?',
    },
  },
  {
    name: 'help-full',
    identity: staffIdentity,
    payload: {
      schema: 'feedback/v1',
      report_id: '22222222-2222-4222-8222-222222222222',
      kind: 'help',
      what_happened: 'Where can I find the previous round’s results?',
      reference: 'ABC-042',
      diagnostic: 'ui:help-search-empty',
      area: 'checkout-wizard',
      client: fullClient,
    },
  },
  {
    name: 'bug-minimal',
    identity: placeIdentity,
    payload: {
      schema: 'feedback/v1',
      report_id: '33333333-3333-4333-8333-333333333333',
      kind: 'bug',
      what_happened: 'When I pick a level and press Continue nothing happens. I have to refresh.',
    },
  },
  {
    name: 'bug-full',
    identity: staffIdentity,
    payload: {
      schema: 'feedback/v1',
      report_id: '44444444-4444-4444-8444-444444444444',
      kind: 'bug',
      what_happened: 'When I pick a level and press Continue nothing happens. I have to refresh.',
      expected: 'It should go to the next question.',
      reference: 'ABC-128',
      diagnostic: 'ui:wizard-continue-noop',
      area: 'checkout-wizard',
      client: fullClient,
    },
  },
  {
    name: 'idea-minimal',
    identity: placeIdentity,
    payload: {
      schema: 'feedback/v1',
      report_id: '55555555-5555-4555-8555-555555555555',
      kind: 'idea',
      what_happened: 'It would help to see last round’s score next to this one.',
    },
  },
  {
    name: 'idea-full',
    identity: staffIdentity,
    payload: {
      schema: 'feedback/v1',
      report_id: '66666666-6666-4666-8666-666666666666',
      kind: 'idea',
      what_happened: 'It would help to see last round’s score next to this one.',
      reference: 'ABC-077',
      diagnostic: 'ui:dashboard-idea',
      area: 'dashboard',
      client: fullClient,
    },
  },
  {
    name: 'unknown-area',
    identity: placeIdentity,
    payload: {
      schema: 'feedback/v1',
      report_id: '77777777-7777-4777-8777-777777777777',
      kind: 'bug',
      what_happened: 'The results chart is blank on this page.',
      area: 'nonexistent-page',
    },
  },
];

let failed = false;

for (const fixture of fixtures) {
  const { name, payload, identity } = fixture;
  const result = validatePayload(payload, { areas: host.areas, allowReference: identity.allowReference });
  if (!result.ok) {
    console.error(`fixture "${name}" failed validation:`, result.errors);
    failed = true;
    continue;
  }

  const ticket = renderTicket({
    payload: result.value,
    identity,
    host,
    receivedAt: new Date(receivedAt),
  });

  const input = { payload, identity, host, receivedAt };
  writeFileSync(path.join(goldenDir, `${name}.input.json`), `${JSON.stringify(input, null, 2)}\n`);
  writeFileSync(path.join(goldenDir, `${name}.expected.md`), `${ticket.title}\n\n${ticket.body}\n`);
  writeFileSync(path.join(goldenDir, `${name}.labels.json`), `${JSON.stringify(ticket.labels, null, 2)}\n`);
  console.log(`wrote ${name}`);
}

if (failed) {
  console.error('one or more fixtures failed validation; see above');
  process.exitCode = 1;
}

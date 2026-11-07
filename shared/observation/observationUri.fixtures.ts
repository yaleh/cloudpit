/**
 * The observation URI grammar's shared FIXTURE.
 *
 * `./observationUri.ts` is the one implementation both compilers use; the two former copies
 * (`server/modules/observation/core/observation-uri.ts` and
 * `src/modules/cockpit-contract/observationUri.ts`) are now re-export shims onto it. This file
 * holds the accepted/rejected spellings ONCE so the backend suite and the frontend suite drive
 * the SAME readings through their own shim: if either side ever stops re-exporting the shared
 * module, or the shared grammar changes without one side following, one of the two fixtures
 * assertions goes red instead of a deep link silently addressing an object the server never
 * wrote.
 *
 * The expected values are spelled out in full (not derived from the parser) so this is a real
 * reading rather than a tautology: `expected.uri` is the canonical spelling the formatter must
 * produce, and the fixture is driven through `formatObservationUri` as well.
 *
 * Consumers: `server/modules/observation/tests/observation-store.test.ts` and
 * `src/modules/cockpit/tests/observationUri.test.ts`.
 */
import type { ObservationUri } from './observationUri.js';

/** One input → parse reading. `expected` is `null` for everything outside the grammar. */
export type ObservationUriParseCase = {
  readonly input: unknown;
  readonly expected: ObservationUri | null;
};

/** One formatter reading: `format<kind>Uri(id)` must produce exactly `uri`. */
export type ObservationUriFormatCase = {
  readonly format: 'session' | 'architecture' | 'project' | 'initiative';
  readonly id: string;
  readonly uri: string;
};

/** The accepted and rejected spellings of the grammar. */
export const OBSERVATION_URI_PARSE_CASES: readonly ObservationUriParseCase[] = [
  {
    input: 'cloudpit://session/5f0c1f3a-session',
    expected: {
      scheme: 'cloudpit',
      kind: 'session',
      id: '5f0c1f3a-session',
      uri: 'cloudpit://session/5f0c1f3a-session',
    },
  },
  {
    input: 'cloudpit://architecture/fleet-project-7',
    expected: {
      scheme: 'cloudpit',
      kind: 'architecture',
      id: 'fleet-project-7',
      uri: 'cloudpit://architecture/fleet-project-7',
    },
  },
  {
    input: 'quay://MyProject/board',
    expected: { scheme: 'quay', kind: 'project', id: 'MyProject', uri: 'quay://MyProject/board' },
  },
  {
    input: 'quay://fleet/initiative/cockpit-observation-wall',
    expected: {
      scheme: 'quay',
      kind: 'initiative',
      id: 'cockpit-observation-wall',
      uri: 'quay://fleet/initiative/cockpit-observation-wall',
    },
  },
  // The retired 2.x read spellings are a `null`, not a normalization (3.0 owns one spelling).
  { input: 'cloudcli://session/legacy-1', expected: null },
  { input: 'cloudcli://architecture/legacy-2', expected: null },
  // The R14 reply-item address is a DIFFERENT grammar; this parser must not claim it.
  { input: 'cloudcli://session/legacy-1/msg/msg-1#item-1', expected: null },
  // Everything outside the grammar, including the structural characters a segment may not hold.
  { input: '', expected: null },
  { input: '   ', expected: null },
  { input: 'quay://fleet/initiative/', expected: null },
  { input: 'quay://fleet/task/abc', expected: null },
  { input: 'quay://fleet/initiative/a/b', expected: null },
  { input: 'quay://fleet/initiative/a b', expected: null },
  { input: 'cloudcli://session/', expected: null },
  { input: 'cloudcli://session/a/b', expected: null },
  { input: 'cloudcli://sessions/abc', expected: null },
  { input: 'cloudcli://architecture//x', expected: null },
  { input: 'cloudcli://session/a b', expected: null },
  { input: 'cloudcli://session/a?x=1', expected: null },
  { input: 'cloudcli://session/a#frag', expected: null },
  { input: 'quay://project', expected: null },
  { input: 'quay://project/Board', expected: null },
  { input: 'quay:///board', expected: null },
  { input: 'http://session/abc', expected: null },
  // Non-string input is a `null`, never a throw (the routes turn it into their own 400).
  { input: undefined, expected: null },
  { input: null, expected: null },
  { input: 42, expected: null },
  { input: { uri: 'cloudcli://session/x' }, expected: null },
];

/** The four formatters and the exact spelling each must mint. */
export const OBSERVATION_URI_FORMAT_CASES: readonly ObservationUriFormatCase[] = [
  { format: 'session', id: '5f0c1f3a-session', uri: 'cloudpit://session/5f0c1f3a-session' },
  {
    format: 'architecture',
    id: 'fleet-project-7',
    uri: 'cloudpit://architecture/fleet-project-7',
  },
  { format: 'project', id: 'MyProject', uri: 'quay://MyProject/board' },
  {
    format: 'initiative',
    id: 'cockpit-observation-wall',
    uri: 'quay://fleet/initiative/cockpit-observation-wall',
  },
];

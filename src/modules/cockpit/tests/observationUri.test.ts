import { describe, expect, it } from 'vitest';

import {
  formatArchitectureUri,
  formatInitiativeUri,
  formatObservationUri,
  formatProjectUri,
  formatSessionUri,
  parseObservationUri,
} from '@/modules/cockpit/observationUri';

/**
 * AC4 — the observation URI grammar used by the cockpit's deep links.
 *
 * The round trip is the reading that matters: the formatter and the parser must agree on the
 * EXACT spelling, including the scheme (`cloudpit://` vs `quay://`), the kind segment and the
 * `board` suffix, because that string is the server's object key. 3.0 owns one cloud spelling:
 * the formatters write `cloudpit://` and the retired 2.x `cloudcli://` read is rejected, in step
 * with the server's copy. Everything outside the grammar is rejected rather than coerced, so a
 * mis-spelled link cannot address a second object for the same conversation.
 */
describe('observation URI grammar', () => {
  it('round-trips a session URI', () => {
    const uri = formatSessionUri('5f0c1f3a-session');
    expect(uri).toBe('cloudpit://session/5f0c1f3a-session');
    const parsed = parseObservationUri(uri);
    expect(parsed).toEqual({
      scheme: 'cloudpit',
      kind: 'session',
      id: '5f0c1f3a-session',
      uri,
    });
    expect(parsed === null ? null : formatObservationUri(parsed)).toBe(uri);
  });

  it('round-trips an architecture URI', () => {
    const uri = formatArchitectureUri('fleet-project-7');
    expect(uri).toBe('cloudpit://architecture/fleet-project-7');
    const parsed = parseObservationUri(uri);
    expect(parsed).toEqual({
      scheme: 'cloudpit',
      kind: 'architecture',
      id: 'fleet-project-7',
      uri,
    });
    expect(parsed === null ? null : formatObservationUri(parsed)).toBe(uri);
  });

  it('rejects the retired cloudcli spelling (3.0 owns one cloud scheme)', () => {
    expect(parseObservationUri('cloudcli://session/legacy-1')).toBeNull();
    expect(parseObservationUri('cloudcli://architecture/legacy-2')).toBeNull();
    // The R14 reply-item address is a different grammar and is NOT this parser's business;
    // it also does not become an observation URI.
    expect(parseObservationUri('cloudcli://session/legacy-1/msg/msg-1#item-1')).toBeNull();
  });

  it('round-trips the fleet board URI unchanged', () => {
    const uri = formatProjectUri('MyProject');
    expect(uri).toBe('quay://MyProject/board');
    const parsed = parseObservationUri(uri);
    expect(parsed).toEqual({ scheme: 'quay', kind: 'project', id: 'MyProject', uri });
    expect(parsed === null ? null : formatObservationUri(parsed)).toBe(uri);
  });

  it('round-trips the fleet initiative URI (the reserved segment the initiative view pins)', () => {
    const uri = formatInitiativeUri('cockpit-observation-wall');
    expect(uri).toBe('quay://fleet/initiative/cockpit-observation-wall');
    const parsed = parseObservationUri(uri);
    expect(parsed).toEqual({
      scheme: 'quay',
      kind: 'initiative',
      id: 'cockpit-observation-wall',
      uri,
    });
    expect(parsed === null ? null : formatObservationUri(parsed)).toBe(uri);
  });

  it.each([
    '',
    'quay://fleet/initiative/',
    'quay://fleet/task/abc',
    'quay://fleet/initiative/a/b',
    'quay://fleet/initiative/a b',
    '   ',
    'cloudcli://session/',
    'cloudcli://session/a/b',
    'cloudcli://sessions/abc',
    'cloudcli://architecture//x',
    'cloudcli://session/a b',
    'cloudcli://session/a?x=1',
    'cloudcli://session/a#frag',
    'quay://project',
    'quay://project/Board',
    'quay:///board',
    'http://session/abc',
  ])('rejects the malformed form %j', (value) => {
    expect(parseObservationUri(value)).toBeNull();
  });

  it('rejects non-string input without throwing', () => {
    expect(parseObservationUri(undefined)).toBeNull();
    expect(parseObservationUri(null)).toBeNull();
    expect(parseObservationUri(42)).toBeNull();
    expect(parseObservationUri({ uri: 'cloudcli://session/x' })).toBeNull();
  });
});

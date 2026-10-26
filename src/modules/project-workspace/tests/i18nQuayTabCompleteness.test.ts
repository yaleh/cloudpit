import { globSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The Quay workspace view is registered as `{ id: 'quay', labelKey: 'tabs.quay' }` in
 * WorkspaceTabs, so every language bundle has to carry that key. react-i18next renders a
 * missing key verbatim, which is how the tab shipped showing the literal text `tabs.quay`
 * instead of a label. This walks the whole `locales/&#42;/common.json` glob rather than a
 * hardcoded list, so a locale added (or dropped) without a matching key cannot pass by
 * silently going stale, and it does not settle for checking `en` alone.
 *
 * Resolved from the vitest process cwd (the repo root), the way the other filesystem-reading
 * tests in this repo do it: under vitest's jsdom environment `import.meta.url` is not a
 * file: URL, so `fileURLToPath` rejects it.
 */
const LOCALES_DIR = resolve(process.cwd(), 'src', 'modules', 'i18n', 'locales');

/** The shape this test reads back out of a locale bundle — deliberately loose. */
type CommonBundle = {
  tabs?: Record<string, unknown>;
  quayPulse?: Record<string, unknown>;
  quayTab?: Record<string, unknown>;
};

/**
 * The reasons a bundle fails the `tabs.quay` contract; an empty array means it passes.
 * Returning the reason rather than a boolean is what lets one positive control below prove
 * the checker can actually go red, instead of the suite merely asserting a constant green.
 */
function quayTabProblems(bundle: CommonBundle): string[] {
  const value = bundle.tabs?.quay;
  if (typeof value !== 'string') return ['tabs.quay is missing or not a string'];
  if (value.trim().length === 0) return ['tabs.quay is an empty string'];
  if (value === 'tabs.quay') return ['tabs.quay is the raw key name, not a label'];
  return [];
}

/** The interpolation names in a translated string, e.g. `{{count}}` → `count`, sorted. */
function interpolationNames(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((match) => match[1]).sort();
}

/** The plural-category suffix i18next appends to a key, e.g. `viaTasks_one` → `viaTasks` / `one`. */
const PLURAL_KEY = /^(.+)_(zero|one|two|few|many|other)$/;

/**
 * The retired minute-based mention key, assembled rather than written out: the task's acceptance
 * criterion is `git grep -n "<that key>" -- src` returning nothing, and a literal here would be
 * counted by that search even though this file only asserts its absence.
 */
const RETIRED_MENTION_KEY = ['mentioned', 'Ago'].join('');

/** The keys of a block that are NOT plural-category variants. */
function baseKeys(block: Record<string, unknown>): string[] {
  return Object.keys(block).filter((key) => !PLURAL_KEY.test(key)).sort();
}

/**
 * The reasons one locale's `quayPulse` block fails the contract the title-bar popover needs.
 * The ENGLISH bundle's non-plural keys are the reference: every other locale must carry the
 * same key set, with the same interpolation names, and a value that is not merely its own key
 * name. Plural keys are checked separately, because their categories differ per language.
 */
function quayPulseProblems(
  bundle: CommonBundle,
  reference: Record<string, unknown>,
): string[] {
  const block = bundle.quayPulse;
  if (typeof block !== 'object' || block === null) {
    return ['quayPulse is missing'];
  }

  const problems: string[] = [];
  if (Object.prototype.hasOwnProperty.call(block, RETIRED_MENTION_KEY)) {
    problems.push(`quayPulse.${RETIRED_MENTION_KEY} must not exist (replaced by mentionedAt)`);
  }
  for (const [key, referenceValue] of Object.entries(reference)) {
    const value = block[key];
    if (typeof value !== 'string') {
      problems.push(`quayPulse.${key} is missing or not a string`);
      continue;
    }
    if (value.trim().length === 0) {
      problems.push(`quayPulse.${key} is an empty string`);
      continue;
    }
    if (value === `quayPulse.${key}`) {
      problems.push(`quayPulse.${key} is the raw key name, not a label`);
      continue;
    }
    const expected = interpolationNames(String(referenceValue));
    const actual = interpolationNames(value);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(
        `quayPulse.${key} interpolates ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
  return problems;
}

/**
 * The reasons one locale's `quayTab` block fails the contract the Quay tab's new surfaces
 * (status band + session panel) need. The ENGLISH block is the reference: every locale must
 * carry the same keys, the same interpolation names, and a value that is not merely its key.
 */
function quayTabKeysProblems(
  bundle: CommonBundle,
  reference: Record<string, unknown>,
): string[] {
  const block = bundle.quayTab;
  if (typeof block !== 'object' || block === null) {
    return ['quayTab is missing'];
  }

  const problems: string[] = [];
  for (const [key, referenceValue] of Object.entries(reference)) {
    const value = block[key];
    if (typeof value !== 'string') {
      problems.push(`quayTab.${key} is missing or not a string`);
      continue;
    }
    if (value.trim().length === 0) {
      problems.push(`quayTab.${key} is an empty string`);
      continue;
    }
    if (value === `quayTab.${key}`) {
      problems.push(`quayTab.${key} is the raw key name, not a label`);
      continue;
    }
    const expected = interpolationNames(String(referenceValue));
    const actual = interpolationNames(value);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(
        `quayTab.${key} interpolates ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
      );
    }
  }
  return problems;
}

/**
 * The reasons one locale's `viaTasks` plural block fails the contract. Each language must carry
 * exactly the plural categories `Intl.PluralRules` resolves for it — the same table i18next uses
 * at render time — each value interpolating `{{count}}` and not merely naming itself. A bare
 * `quayPulse.viaTasks` is forbidden: i18next would never pick it for a plural call, so its
 * presence means a translator (or a merge) left the old non-plural key behind.
 */
function viaTasksPluralProblems(locale: string, block: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (Object.prototype.hasOwnProperty.call(block, 'viaTasks')) {
    problems.push('quayPulse.viaTasks is a bare non-plural key');
  }
  const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  for (const category of categories) {
    const key = `viaTasks_${category}`;
    const value = block[key];
    if (typeof value !== 'string') {
      problems.push(`quayPulse.${key} is missing or not a string`);
      continue;
    }
    if (value.trim().length === 0) {
      problems.push(`quayPulse.${key} is an empty string`);
      continue;
    }
    if (value === `quayPulse.${key}`) {
      problems.push(`quayPulse.${key} is the raw key name, not a label`);
      continue;
    }
    if (!/\{\{\s*count\s*\}\}/.test(value)) {
      problems.push(`quayPulse.${key} does not interpolate {{count}}`);
    }
  }
  return problems;
}

describe('every locale carries the tabs.quay label', () => {
  const localeDirs = readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const bundleFiles = globSync('*/common.json', { cwd: LOCALES_DIR }).sort();

  it('covers every language directory on disk (the 12-locale glob, not a sampled subset)', () => {
    // Two independent enumerations agreeing: readdir for the directories, glob for the
    // bundles. A dropped directory or a truncated glob breaks this equality.
    expect(bundleFiles).toEqual(localeDirs.map((dir) => `${dir}/common.json`));
    expect(localeDirs.length, `locale directories found: ${JSON.stringify(localeDirs)}`).toBeGreaterThanOrEqual(12);
  });

  it('gives every locale a non-empty tabs.quay that is not the key name itself', () => {
    const offenders: string[] = [];

    for (const file of bundleFiles) {
      const bundle = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as CommonBundle;
      for (const problem of quayTabProblems(bundle)) {
        offenders.push(`${file}: ${problem}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  // Positive control: the same checker must reject a bundle that lacks the key (or carries a
  // blank / copy-pasted value). If it could not, the case above would be a green that cannot
  // go red — exactly the failure it exists to catch.
  it('rejects a bundle with a missing, blank or key-copied tab label (positive control)', () => {
    expect(quayTabProblems({ tabs: {} })).toEqual(['tabs.quay is missing or not a string']);
    expect(quayTabProblems({ tabs: { quay: '' } })).toEqual(['tabs.quay is an empty string']);
    expect(quayTabProblems({ tabs: { quay: 'tabs.quay' } })).toEqual(['tabs.quay is the raw key name, not a label']);
    expect(quayTabProblems({ tabs: { quay: 'Quay' } })).toEqual([]);
  });
});

/**
 * The title bar's Loop pulse popover derives its labels from `quayPulse.*` (the chart, the
 * project counts band, the in-flight rows and the session's mention list). A missed key shows
 * as the raw dotted key on screen (react-i18next renders a missing key verbatim), and a dropped
 * interpolation shows as 「Mentioned min ago」. Both are invisible to an English-only test, so
 * this walks the same 12-locale glob the tab label does.
 */
describe('every locale carries the title-bar Loop pulse keys', () => {
  const bundleFiles = globSync('*/common.json', { cwd: LOCALES_DIR }).sort();
  const english = JSON.parse(
    readFileSync(join(LOCALES_DIR, 'en', 'common.json'), 'utf8'),
  ) as CommonBundle;
  const referenceBlock = english.quayPulse ?? {};
  // The English non-plural keys; the plural ones depend on the locale's own category table.
  const reference = Object.fromEntries(
    Object.entries(referenceBlock).filter(([key]) => !PLURAL_KEY.test(key)),
  );

  const EXPECTED_KEYS = [
    'done',
    'empty',
    'goalsCountLabel',
    'goalsHeading',
    'inFlightEmpty',
    'inFlightHeading',
    'inFlightMentioned',
    'lanesNote',
    'listError',
    'loading',
    'mentionedAt',
    'mentionedInMessage',
    'notRead',
    'openQuayPanel',
    'projectCounts',
    'sessionCounts',
    'snapshotError',
    'snapshotLoading',
    'tasksCountLabel',
    'tasksHeading',
    'title',
    'triggerLabel',
  ];

  it('the English bundle declares every key this task introduced', () => {
    expect(baseKeys(referenceBlock)).toEqual(EXPECTED_KEYS);
  });

  it('every locale carries each key with the English placeholders and a real value', () => {
    const offenders: string[] = [];
    for (const file of bundleFiles) {
      const bundle = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as CommonBundle;
      for (const problem of quayPulseProblems(bundle, reference)) {
        offenders.push(`${file}: ${problem}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every locale carries a viaTasks_<category> for each of its own plural categories', () => {
    const offenders: string[] = [];
    for (const file of bundleFiles) {
      const locale = file.split('/')[0];
      const bundle = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as CommonBundle;
      for (const problem of viaTasksPluralProblems(locale, bundle.quayPulse ?? {})) {
        offenders.push(`${file}: ${problem}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('rejects a missing, blank, key-copied or placeholder-dropping block (positive control)', () => {
    expect(quayPulseProblems({}, reference)).toEqual(['quayPulse is missing']);

    const { title: _omittedTitle, ...withoutTitle } = reference;
    expect(quayPulseProblems({ quayPulse: withoutTitle }, reference)).toEqual([
      'quayPulse.title is missing or not a string',
    ]);

    const blank = quayPulseProblems({ quayPulse: { ...reference, title: '  ' } }, reference);
    expect(blank).toEqual(['quayPulse.title is an empty string']);

    const keyCopied = quayPulseProblems({ quayPulse: { ...reference, done: 'quayPulse.done' } }, reference);
    expect(keyCopied).toEqual(['quayPulse.done is the raw key name, not a label']);

    const dropped = quayPulseProblems(
      { quayPulse: { ...reference, mentionedAt: 'Mentioned' } },
      reference,
    );
    expect(dropped).toEqual(['quayPulse.mentionedAt interpolates [], expected ["when"]']);

    const stale = quayPulseProblems(
      { quayPulse: { ...reference, [RETIRED_MENTION_KEY]: 'Mentioned {{some-unit}} ago' } },
      reference,
    );
    expect(stale).toEqual([`quayPulse.${RETIRED_MENTION_KEY} must not exist (replaced by mentionedAt)`]);
  });

  it('rejects a plural block missing a category, a bare viaTasks, or a value without {{count}} (positive control)', () => {
    // Russian resolves one/few/many/other: dropping `few` must be named.
    expect(
      viaTasksPluralProblems('ru', {
        viaTasks_one: 'через {{count}} задачу',
        viaTasks_many: 'через {{count}} задач',
        viaTasks_other: 'через {{count}} задачи',
      }),
    ).toEqual(['quayPulse.viaTasks_few is missing or not a string']);

    expect(viaTasksPluralProblems('en', { viaTasks: 'via {{count}} tasks', viaTasks_one: 'x {{count}}', viaTasks_other: 'y {{count}}' }))
      .toEqual(['quayPulse.viaTasks is a bare non-plural key']);

    expect(viaTasksPluralProblems('en', { viaTasks_one: 'via a task', viaTasks_other: 'via {{count}} tasks' }))
      .toEqual(['quayPulse.viaTasks_one does not interpolate {{count}}']);
  });
});

/**
 * The Quay tab's new status band and session column render every `quayTab.*` label below. A
 * missed key shows the raw dotted key on screen, and a dropped interpolation shows a sentence
 * with the value missing — both invisible to an English-only read. This walks the same
 * 12-locale glob the title-bar keys do.
 */
describe('every locale carries the Quay tab status-band and session keys', () => {
  const bundleFiles = globSync('*/common.json', { cwd: LOCALES_DIR }).sort();
  const english = JSON.parse(
    readFileSync(join(LOCALES_DIR, 'en', 'common.json'), 'utf8'),
  ) as CommonBundle;
  const reference = english.quayTab ?? {};

  const EXPECTED_KEYS = [
    'blockedReason',
    'chainError',
    'chainUnavailable',
    'createdEmpty',
    'createdHeading',
    'done',
    'draining',
    'driverIdle',
    'driverNotConfigured',
    'driverRunning',
    'driverStale',
    'driverUnavailable',
    'goalsHeading',
    'inFlightCount',
    'kernelAhead',
    'kernelBehind',
    'kernelCurrent',
    'kernelNotEvaluated',
    'loadingChain',
    'loadingMentions',
    'mentionedAt',
    'mentionedInMessage',
    'mentionsError',
    'needsHumanCount',
    'noMentions',
    'noSession',
    'orphanExpired',
    'orphanMarked',
    'orphanMarkedUnknown',
    'pointerDeviation',
    'readyCount',
    'sessionPanelTitle',
    'suiteState',
    'tasksHeading',
    'viaTasks',
  ];

  it('the English bundle declares every quayTab key this task introduced', () => {
    expect(baseKeys(reference)).toEqual(EXPECTED_KEYS);
  });

  it('every locale carries each quayTab key with the English placeholders and a real value', () => {
    const offenders: string[] = [];
    for (const file of bundleFiles) {
      const bundle = JSON.parse(readFileSync(join(LOCALES_DIR, file), 'utf8')) as CommonBundle;
      for (const problem of quayTabKeysProblems(bundle, reference)) {
        offenders.push(`${file}: ${problem}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('rejects a missing, blank, key-copied or placeholder-dropping quayTab block (positive control)', () => {
    expect(quayTabKeysProblems({}, reference)).toEqual(['quayTab is missing']);

    const { orphanMarked: _omitted, ...withoutOrphan } = reference;
    expect(quayTabKeysProblems({ quayTab: withoutOrphan }, reference)).toEqual([
      'quayTab.orphanMarked is missing or not a string',
    ]);

    expect(quayTabKeysProblems({ quayTab: { ...reference, noSession: '  ' } }, reference)).toEqual([
      'quayTab.noSession is an empty string',
    ]);

    expect(quayTabKeysProblems({ quayTab: { ...reference, noMentions: 'quayTab.noMentions' } }, reference)).toEqual([
      'quayTab.noMentions is the raw key name, not a label',
    ]);

    expect(
      quayTabKeysProblems({ quayTab: { ...reference, orphanMarked: 'Plugin version removed soon' } }, reference),
    ).toEqual(['quayTab.orphanMarked interpolates [], expected ["days"]']);
  });
});

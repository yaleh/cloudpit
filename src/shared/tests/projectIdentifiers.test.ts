import assert from 'node:assert/strict';

import { test, vi } from 'vitest';

import { repairIdentifiers } from '@/shared/identifierRepair';
import { flattenProjectIdentifiers, loadProjectIdentifiers } from '@/shared/projectIdentifiers';

/**
 * The candidate source the transcript repair is fed from.
 *
 * `identifierRepair.test.ts` already covers what the repair does with a list of
 * names; nothing covered where that list comes from, and every way the source can
 * fail is a way the dictation path has to survive. The two readings that matter
 * are "the names arrive in the shape the repair matches against" and "the index
 * reader is asked for the open project, and nothing else".
 *
 * The request and its per-project cache belong to the file-tree module
 * (`loadProjectFileIndex`, pinned by `file-tree/tests/projectFileIndex.test.tsx`);
 * the reader is injected here so this shared module never imports a feature
 * module. That also means there is no module-scope cache to reset between cases.
 */

/** A reader that records the project ids it was asked for and answers with `entries`. */
const readerReturning = (entries: unknown) =>
  vi.fn(async (_projectId: string) => entries);

/** The tree the first flattening reading is written against. */
const TREE = [
  {
    type: 'directory',
    name: 'src',
    path: '/project/src',
    children: [
      { type: 'file', name: 'voice.routes.ts', path: '/project/src/voice.routes.ts' },
      { type: 'file', name: 'useVoiceInput.tsx', path: '/project/src/useVoiceInput.tsx' },
    ],
  },
  { type: 'file', name: 'README.md', path: '/project/README.md' },
];

/** The flat index `GET /api/file-tree/projects/:id/files-index` answers with. */
const INDEX = [
  { type: 'file', name: 'voice.routes.ts', path: '/project/src/voice.routes.ts' },
  { type: 'file', name: 'useVoiceInput.tsx', path: '/project/src/useVoiceInput.tsx' },
  { type: 'file', name: 'README.md', path: '/project/README.md' },
];

test('a file tree is flattened to the two shapes a recogniser breaks', () => {
  assert.deepEqual(
    [...flattenProjectIdentifiers(TREE)].sort(),
    [
      // The basename: what a dotted, mis-spelled reference is matched against.
      'README.md',
      'useVoiceInput.tsx',
      'voice.routes.ts',
      // The bare stem — the whole name minus its last extension, so `voice.routes.ts`
      // offers `voice.routes` and `README.md` offers `README`. This is the shape a
      // symbol rendered as ordinary words is matched against: "use voice input" carries
      // no dot, so the basename can never reach it.
      'README',
      'useVoiceInput',
      'voice.routes',
    ].sort(),
  );
});

test('a file tree with no files yields no candidates', () => {
  assert.deepEqual(flattenProjectIdentifiers([]), []);
  // A response the module does not recognise is a smaller list, never a throw.
  assert.deepEqual(flattenProjectIdentifiers(undefined), []);
  assert.deepEqual(flattenProjectIdentifiers([{ type: 'directory', name: 'src' }]), []);
});

test('the injected index reader is asked for the open project, and its answer is flattened', async () => {
  const read = readerReturning(INDEX);
  const candidates = await loadProjectIdentifiers('project-1', read);

  assert.deepEqual(
    [...candidates].sort(),
    ['README', 'README.md', 'useVoiceInput', 'useVoiceInput.tsx', 'voice.routes', 'voice.routes.ts'].sort(),
    'a flat index yields the same two shapes the tree does',
  );
  assert.equal(read.mock.calls.length, 1, 'the injected reader is the only source of names');
  assert.deepEqual(read.mock.calls[0], ['project-1']);

  // No project open is no question at all.
  assert.deepEqual(await loadProjectIdentifiers(null, read), []);
  assert.deepEqual(await loadProjectIdentifiers(undefined, read), []);
  assert.equal(read.mock.calls.length, 1, 'and nothing was asked for them');
});

test('a failed read leaves the transcript something to fall back on', async () => {
  const rejected = vi.fn(async () => {
    throw new Error('offline');
  });
  assert.deepEqual(
    await loadProjectIdentifiers('project-1', rejected),
    [],
    'a rejected read is no candidates, not a throw',
  );

  const threw = vi.fn(() => {
    throw new Error('synchronous failure');
  });
  assert.deepEqual(
    await loadProjectIdentifiers('project-2', threw),
    [],
    'a reader that throws before returning is no candidates either',
  );
});

test('no candidates is the utterance unchanged — the degradation is silent', async () => {
  const candidates = await loadProjectIdentifiers('project-1', readerReturning([]));
  assert.deepEqual(candidates, []);

  // This is the whole reading of the fallback: the repair is a pure function of its
  // candidate list, so the empty list it can always be handed costs the recogniser's
  // own sentence nothing.
  const utterance = 'please open voice.rouse.ts and fix the proxy';
  assert.equal(repairIdentifiers(utterance, candidates), utterance);
  assert.deepEqual(flattenProjectIdentifiers([]), []);
});

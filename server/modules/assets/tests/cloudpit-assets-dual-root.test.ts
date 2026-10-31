/**
 * Criterion file for the dual asset roots (GOAL-053 A3).
 *
 *   npx tsx --tsconfig server/tsconfig.json --test server/modules/assets/tests/cloudpit-assets-dual-root.test.ts
 *
 * Covers: the legacy root staying readable (with a negative control), the
 * unchanged default write root, the explicit opt-in root, the identical
 * direct-child traversal guard on both roots, new-root-first resolution, and
 * the resend/isAllowed acceptance of both roots. Every filesystem arm works in
 * a temporary home so the real `~` is never read or written.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findStoredAttachmentAsset,
  buildStoredImageRecords,
  resolveImageAssetFileInRoot,
} from '@/modules/assets/services/image-assets.service.js';
import {
  getImageAssetsReadDirs,
  getImageAssetsRoots,
  getImageAssetsWriteDir,
  isAllowedImageSourcePath,
} from '@/shared/image-attachments.js';
import {
  filterAttachmentsToUploadStore,
  filterImagesToUploadStore,
} from '@/modules/websocket/index.js';

const UPLOAD_FILES = [
  { originalname: 'shot.png', filename: '123-shot.png', size: 42, mimetype: 'image/png' },
];

function temporaryHome(t: { after: (fn: () => void) => void }, prefix: string): string {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(homeDir, { recursive: true, force: true }));
  return homeDir;
}

function writeAsset(root: string, filename: string, content = 'asset'): string {
  mkdirSync(root, { recursive: true });
  const filePath = path.join(root, filename);
  writeFileSync(filePath, content);
  return filePath;
}

test('AC2: the legacy root stays readable and removing the file proves the read', async (t) => {
  const homeDir = temporaryHome(t, 'cloudpit-dual-root-legacy-');
  const legacyRoot = path.resolve(homeDir, '.cloudcli', 'assets');
  const newRoot = path.resolve(homeDir, '.cloudpit', 'assets');
  const oldShot = path.resolve(writeAsset(legacyRoot, 'old-shot.png', 'legacy-bytes'));

  const roots = getImageAssetsReadDirs({ env: {}, homeDir });
  assert.deepEqual(roots, [newRoot, legacyRoot], 'read roots are new-first, then legacy');
  assert.equal(existsSync(newRoot), false, 'the inert new root must not be created');

  const found = await findStoredAttachmentAsset('old-shot.png', { roots });
  assert.equal(found, oldShot, 'the legacy copy is returned by absolute path');

  // Negative control: with the legacy file gone the same lookup is null, so
  // the positive arm above really read the legacy root.
  rmSync(oldShot);
  assert.equal(await findStoredAttachmentAsset('old-shot.png', { roots }), null);
});

test('AC2: the same filename resolves from the new root first', async (t) => {
  const homeDir = temporaryHome(t, 'cloudpit-dual-root-priority-');
  const legacyRoot = path.resolve(homeDir, '.cloudcli', 'assets');
  const newRoot = path.resolve(homeDir, '.cloudpit', 'assets');
  writeAsset(legacyRoot, 'same.png', 'legacy');
  const newCopy = path.resolve(writeAsset(newRoot, 'same.png', 'new'));
  const legacyCopy = path.resolve(legacyRoot, 'same.png');

  const roots = getImageAssetsReadDirs({ env: {}, homeDir });
  assert.equal(await findStoredAttachmentAsset('same.png', { roots }), newCopy);
  assert.notEqual(await findStoredAttachmentAsset('same.png', { roots }), legacyCopy);
});

test('AC3: the default arm writes to the legacy root and leaves the opt-in root alone', () => {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), 'cloudpit-dual-root-write-'));
  try {
    const expectedLegacyRoot = path.resolve(homeDir, '.cloudcli', 'assets');

    const defaultOptions = { env: {}, homeDir };
    assert.equal(getImageAssetsWriteDir(defaultOptions), expectedLegacyRoot);
    assert.deepEqual(getImageAssetsReadDirs(defaultOptions), [
      path.resolve(homeDir, '.cloudpit', 'assets'),
      expectedLegacyRoot,
    ]);
    const defaultRecords = buildStoredImageRecords(UPLOAD_FILES, defaultOptions);
    assert.equal(defaultRecords[0].path, `${expectedLegacyRoot.replace(/\\/g, '/')}/123-shot.png`);
    assert.ok(defaultRecords[0].path.startsWith(`${expectedLegacyRoot.replace(/\\/g, '/')}/`));
    assert.equal(existsSync(expectedLegacyRoot), false, 'building records must not create the root');
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('AC3: an explicit root opts into the new root without creating the legacy root', () => {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), 'cloudpit-dual-root-opt-in-'));
  try {
    const explicitRoot = path.join(homeDir, 'new-data');
    const expectedNewRoot = path.resolve(explicitRoot, 'assets');
    const legacyRoot = path.resolve(homeDir, '.cloudcli', 'assets');
    const options = { env: { CLOUDPIT_HOME: explicitRoot }, homeDir };

    const roots = getImageAssetsRoots(options);
    assert.equal(roots.legacyRoot, legacyRoot);
    assert.equal(roots.newRoot, expectedNewRoot);
    assert.equal(roots.writeRoot, expectedNewRoot);
    assert.deepEqual(roots.readRoots, [expectedNewRoot, legacyRoot]);
    assert.equal(getImageAssetsWriteDir(options), expectedNewRoot);

    const records = buildStoredImageRecords(UPLOAD_FILES, options);
    assert.equal(records[0].path, `${expectedNewRoot.replace(/\\/g, '/')}/123-shot.png`);
    assert.equal(existsSync(legacyRoot), false, 'the opt-in arm must not create the legacy root');
    assert.equal(existsSync(path.resolve(homeDir, '.cloudpit')), false, 'nor the inert new root');
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('AC3: the legacy env spelling is a fallback and blank values count as unset', () => {
  const homeDir = mkdtempSync(path.join(os.tmpdir(), 'cloudpit-dual-root-env-'));
  try {
    const explicitRoot = path.join(homeDir, 'legacy-spelling');
    const expectedNewRoot = path.resolve(explicitRoot, 'assets');

    assert.equal(
      getImageAssetsWriteDir({ env: { CLOUDCLI_HOME: explicitRoot }, homeDir }),
      expectedNewRoot,
    );
    assert.equal(
      getImageAssetsWriteDir({ env: { CLOUDPIT_HOME: '   ' }, homeDir }),
      path.resolve(homeDir, '.cloudcli', 'assets'),
      'a blank explicit root is unset; the default write root stays legacy',
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('AC4: the direct-child guard rejects the same traversal set in both roots', (t) => {
  const homeDir = temporaryHome(t, 'cloudpit-dual-root-guard-');
  const legacyRoot = path.resolve(homeDir, '.cloudcli', 'assets');
  const newRoot = path.resolve(homeDir, '.cloudpit', 'assets');

  for (const root of [legacyRoot, newRoot]) {
    assert.equal(
      resolveImageAssetFileInRoot('shot.png', root),
      path.resolve(root, 'shot.png'),
      `${root}: a plain filename resolves under that root`,
    );

    const rejected: Array<[string, string]> = [
      ['', 'empty string'],
      ['   ', 'blank string'],
      ['../x.png', 'parent traversal'],
      ['a/b.png', 'posix separator'],
      ['a\\b.png', 'windows separator'],
      ['..', 'bare dot-dot'],
      ['/etc/passwd', 'absolute path'],
      [path.join(root, 'nested', 'deep.png'), 'absolute subdirectory file'],
      ['nested/deep.png', 'relative subdirectory file'],
    ];
    for (const [filename, label] of rejected) {
      assert.equal(
        resolveImageAssetFileInRoot(filename, root),
        null,
        `${root}: ${label} must be rejected`,
      );
    }
  }
});

test('AC5: isAllowedImageSourcePath accepts both roots and still rejects outsiders', (t) => {
  const homeDir = temporaryHome(t, 'cloudpit-dual-root-allowed-');
  const explicitRoot = path.join(homeDir, 'new-data');
  const legacyRoot = path.resolve(homeDir, '.cloudcli', 'assets');
  const newRoot = path.resolve(explicitRoot, 'assets');
  const cwd = path.join(homeDir, 'project');
  const options = { env: { CLOUDPIT_HOME: explicitRoot }, homeDir };

  assert.equal(isAllowedImageSourcePath(path.join(legacyRoot, 'old.png'), cwd, options), true);
  assert.equal(isAllowedImageSourcePath(path.join(newRoot, 'new.png'), cwd, options), true);
  assert.equal(isAllowedImageSourcePath(path.join(cwd, 'docs', 'diagram.png'), cwd, options), true);

  assert.equal(isAllowedImageSourcePath('/etc/passwd', cwd, options), false);
  assert.equal(isAllowedImageSourcePath(path.join(homeDir, 'elsewhere', 'x.png'), cwd, options), false);
  assert.equal(isAllowedImageSourcePath(legacyRoot, cwd, options), false, 'roots are directories');
});

test('AC5: the resend filter accepts direct children of both roots and rejects outsiders', (t) => {
  const homeDir = temporaryHome(t, 'cloudpit-dual-root-filter-');
  const explicitRoot = path.join(homeDir, 'new-data');
  const previousExplicitRoot = process.env.CLOUDPIT_HOME;
  process.env.CLOUDPIT_HOME = explicitRoot;
  t.after(() => {
    if (previousExplicitRoot === undefined) {
      delete process.env.CLOUDPIT_HOME;
    } else {
      process.env.CLOUDPIT_HOME = previousExplicitRoot;
    }
  });

  const legacyRoot = path.resolve(os.homedir(), '.cloudcli', 'assets');
  const newRoot = path.resolve(explicitRoot, 'assets');
  const accepted = [
    path.join(legacyRoot, 'old-resend.png'),
    path.join(newRoot, 'new-send.png'),
    'bare-filename.png',
  ];

  const result = filterAttachmentsToUploadStore([
    { path: accepted[0] },
    { path: accepted[1] },
    { path: accepted[2] },
    { path: '/etc/passwd' },
    { path: path.join(homeDir, 'outside.png') },
    { path: path.join(newRoot, 'nested', 'deep.png') },
    { path: path.join(legacyRoot, 'nested', 'deep.png') },
  ]);
  assert.deepEqual(result.map((descriptor) => descriptor.path), accepted);

  // `filterImagesToUploadStore` rides the same dual-root filter.
  assert.deepEqual(
    filterImagesToUploadStore([{ path: accepted[1] }]).map((descriptor) => descriptor.path),
    [accepted[1]],
  );
});

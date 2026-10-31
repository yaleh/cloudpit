import fsSync, { promises as fs } from 'node:fs';
import path from 'node:path';

import mime from 'mime-types';

import {
  getGlobalImageAssetsDir,
  getImageAssetsReadDirs,
  getImageAssetsWriteDir,
  toPosixPath,
  type ImageAssetsRootsOptions,
} from '@/shared/image-attachments.js';

/**
 * Image mime types accepted for chat attachment uploads. SVG is allowed for
 * storage/preview even though some providers (Claude API) skip it at send time.
 */
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

// Used only by this service and the assets routes via the barrel file.
type StoredImageAsset = {
  /** Original upload filename, for display. */
  name: string;
  /** Absolute posix-normalized path inside the global assets folder. */
  path: string;
  size: number;
  mimeType: string;
};

// Shape of one multer-stored file; kept local because only this module reads it.
type UploadedImageFile = {
  originalname: string;
  filename: string;
  size: number;
  mimetype: string;
};

type UploadedAttachmentFile = UploadedImageFile;

/** Returns whether one uploaded mime type may be stored as a chat image asset. */
export function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
}

/**
 * Creates the active upload folder if needed and returns it. Without options
 * this is the unchanged `~/.cloudcli/assets` default; an explicit
 * `CLOUDPIT_HOME`/`CLOUDCLI_HOME` opts into `<explicit>/assets`.
 */
export async function ensureImageAssetsDir(options: ImageAssetsRootsOptions = {}): Promise<string> {
  const assetsDir = getImageAssetsWriteDir(options);
  await fs.mkdir(assetsDir, { recursive: true });
  return assetsDir;
}

/**
 * Maps multer-stored upload files to the attachment records returned to the
 * chat composer. The absolute path is what providers receive and what session
 * history carries back to the UI.
 */
export function buildStoredImageRecords(
  files: UploadedImageFile[],
  options: ImageAssetsRootsOptions = {},
): StoredImageAsset[] {
  const assetsDir = getImageAssetsWriteDir(options);
  return files.map((file) => ({
    name: file.originalname,
    path: toPosixPath(path.join(assetsDir, file.filename)),
    size: file.size,
    mimeType: file.mimetype,
  }));
}

/**
 * Maps multer-stored files to provider-neutral attachment records for the
 * assets route. The shared storage format intentionally matches image records
 * so one uploaded file can move through queueing and provider dispatch.
 */
export function buildStoredAttachmentRecords(
  files: UploadedAttachmentFile[],
  options: ImageAssetsRootsOptions = {},
): StoredImageAsset[] {
  return buildStoredImageRecords(files, options);
}

/**
 * Resolves one asset filename to its absolute path inside one store root, or
 * null when the name is empty, contains path separators/traversal, or would
 * escape that root. The same strict direct-child boundary is applied to every
 * root, so a second store never widens the accepted name space.
 */
export function resolveImageAssetFileInRoot(filename: string, root: string): string | null {
  const trimmed = typeof filename === 'string' ? filename.trim() : '';
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    return null;
  }

  const assetsDir = path.resolve(root);
  const resolved = path.resolve(assetsDir, trimmed);
  if (!resolved.startsWith(assetsDir + path.sep)) {
    return null;
  }

  return resolved;
}

/**
 * Resolves one asset filename inside the legacy `~/.cloudcli/assets` folder.
 * Existing callers and tests keep this single-root default; the dual-root
 * serving path uses {@link findStoredAttachmentAsset}.
 */
export function resolveImageAssetFile(filename: string): string | null {
  return resolveImageAssetFileInRoot(filename, getGlobalImageAssetsDir());
}

/**
 * Resolves a general chat attachment for the assets serving route. It shares
 * the image resolver's strict direct-child containment boundary.
 */
export function resolveAttachmentAssetFile(filename: string): string | null {
  return resolveImageAssetFile(filename);
}

/**
 * Looks one attachment filename up across the dual read roots (new root
 * first), returning the first existing absolute path or null. Each root gets
 * the identical direct-child guard, so filenames cannot traverse either store.
 */
export async function findStoredAttachmentAsset(
  filename: string,
  options: { roots?: readonly string[] } = {},
): Promise<string | null> {
  const roots = options.roots ?? getImageAssetsReadDirs();
  for (const root of roots) {
    const resolved = resolveImageAssetFileInRoot(filename, root);
    if (!resolved) {
      continue;
    }
    try {
      await fs.access(resolved);
      return resolved;
    } catch {
      // Try the next root.
    }
  }
  return null;
}

/**
 * Opens one stored chat asset for the assets route without exposing arbitrary
 * filesystem reads. The route translates the lookup status and streams the
 * returned direct-child file to the authenticated client.
 */
export async function openStoredAttachmentAsset(filename: string) {
  const roots = getImageAssetsReadDirs();
  const hasValidName = roots.some((root) => resolveImageAssetFileInRoot(filename, root) !== null);
  if (!hasValidName) {
    return { status: 'invalid' as const };
  }

  const resolved = await findStoredAttachmentAsset(filename, { roots });
  if (!resolved) {
    return { status: 'missing' as const };
  }

  return {
    status: 'found' as const,
    contentType: mime.lookup(resolved) || 'application/octet-stream',
    stream: fsSync.createReadStream(resolved),
  };
}

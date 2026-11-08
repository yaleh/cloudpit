import {
  appendFilesInputTag,
  buildCodexInputItems,
} from '@/shared/image-attachments.js';
import type { HostTurnInput } from '@/shared/types.js';

/** Used by resident start, steer, queue and transcript paths to retain uploaded files. */
export function codexResidentPrompt(turn: HostTurnInput): string {
  return appendFilesInputTag(turn.command, turn.options.files);
}

/** Builds app-server input for the resident driver, including native local images. */
export function codexResidentInput(turn: HostTurnInput) {
  const items = buildCodexInputItems(codexResidentPrompt(turn), turn.options.images, turn.options.cwd);
  if (items.length > 1 && items[0].type === 'text' && !items[0].text.trim()) {
    items[0].text = 'Please analyze the attached image(s).';
  }
  // The SDK uses local_image; the app-server protocol uses localImage.
  return items.map((item) => item.type === 'local_image'
    ? { type: 'localImage' as const, path: item.path }
    : item);
}

/**
 * The single `api` endpoint map: `apiCore` (auth … taskmaster) and `apiTail` (user … notices)
 * composed into the object every call site imports.
 *
 * WHY IT IS ITS OWN MODULE. `voiceConfig.ts` needs `api` for the settings document, and the
 * barrel `index.ts` value-imports `voiceConfig.ts` for the transcription path — so while `api`
 * lived in `index.ts` those two files formed a file-level value SCC that the directory-level
 * cycle ratchets cannot see. `voiceConfig.ts` now imports `./client`; nothing in that chain
 * points back at the barrel, so the SCC is gone while every consumer keeps its existing import
 * (`index.ts` re-exports `api` unchanged).
 */
import { apiCore } from '@/shared/api/clientCore';
import { apiTail } from '@/shared/api/clientTail';

export const api = { ...apiCore, ...apiTail };

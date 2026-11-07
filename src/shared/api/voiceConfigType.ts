import type { VoiceSettings } from '@shared/voice/voiceSettingsRegistry';

/**
 * The browser's copy of the user's voice settings document.
 *
 * THE SHAPE IS THE CONTRACT'S, NOT THIS MODULE'S. `shared/voice/voiceSettingsRegistry.ts` names
 * every field once — the same declaration the server's `VoiceSettings`, the store's field list and
 * its empty row are read from — so a field added there reaches both ends rather than being written
 * down a second time here. What `voiceConfig.ts` owns is the browser's RUNTIME copy: the in-memory
 * document, its hydration from the server and its whole-document saves.
 *
 * `Required` IS THE ONE DIFFERENCE FROM THE SERVER'S VIEW, and it is a real one rather than a
 * convenience: a stored row may omit the provider-owned and user-data fields (absent means
 * "unset", which the store resolves to its own default), while the browser always holds the
 * complete document it sends back whole. So the type is the same declaration read with the
 * optionality resolved, not a second list of fields.
 *
 * IT LIVES IN ITS OWN LEAF because both the settings store (`voiceConfig.ts`) and the endpoint map
 * (`clientTail.ts`'s `voice.saveConfig`) need the type, and a type import between those two files
 * would recreate the file-level edge this extraction exists to remove. A type-only module is a
 * leaf: neither side can gain a runtime dependency through it.
 */
export type VoiceConfig = Required<VoiceSettings>;

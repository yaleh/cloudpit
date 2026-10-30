/**
 * Voice sub-package of `chat/utils`: capture, segmentation, playback and the activity-dock
 * reading derived from a voice turn. Consumers reach voice utilities through this barrel so the
 * sub-package stays the import surface rather than its individual files.
 *
 * The model cache and the audio decoder are not here: they moved to `src/shared` when the
 * chat↔settings cycle was broken, because the ASR worker needs them from outside the feature.
 */
export { UNCONFIRMED_TURN_LABEL_MS, UNREACHABLE_STOP_REASON_KEY, activityPhaseLabelKey, deriveActivityDockView } from '@/modules/chat-session';
export type { ActivityDockInput, ActivityDockView } from '@/modules/chat-session';
export * from '@/modules/chat-voice/utils/voice/voiceContextPack';
export * from '@/modules/chat-voice/utils/voice/voiceErrorMessages';
export * from '@/modules/chat-voice/utils/voice/voiceInsertion';
export * from '@/modules/chat-voice/utils/voice/voiceLiveReading';
export * from '@/modules/chat-voice/utils/voice/voiceLiveSegmenter';
export * from '@/modules/chat-voice/utils/voice/voicePlayer';
export * from '@/modules/chat-voice/utils/voice/voiceSegments';

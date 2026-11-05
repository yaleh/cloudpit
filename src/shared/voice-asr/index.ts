/**
 * The browser ASR worker and the client-side model listing it drives.
 *
 * Split out of `src/shared` so the root directory is no longer the endpoint
 * map, the settings store, the voice pipeline and the ASR worker all at once.
 */
export * from '@/shared/voice-asr/voiceClientAsrWorker';
export * from '@/shared/voice-asr/voiceClientFrontend';
export * from '@/shared/voice-asr/voiceModelCache';

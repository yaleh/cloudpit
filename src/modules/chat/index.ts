export { default as ChatInterface } from '@/modules/chat/ChatInterface';
/**
 * The session → task chain bar: 「本会话发起 6 个任务：执行中 2 · 已合入待生效 3 · 线上 1 · 卡住 0」.
 * Used by `ChatInterface` above the transcript; exported so a scenario runner can render it
 * without the whole chat page and so the cockpit can adopt the same stage vocabulary.
 */
export { default as SessionTaskChain } from '@/modules/chat/SessionTaskChain';
export type {
  SessionTaskChainCounts,
  SessionTaskChainEntry,
  SessionTaskChainPort,
  SessionTaskChainReading,
  SessionTaskChainStage,
} from '@/modules/chat/SessionTaskChain';
/**
 * The i18n key for one activity phase's running word, or null when the phase
 * has none. Used by the sidebar module, whose running rows draw the same phase
 * label the dock draws — one reduction, so the two surfaces cannot disagree.
 */
export { activityPhaseLabelKey } from '@/modules/chat-session';
/**
 * The wall-aware voice input seam, for modules outside `chat` (the dev-only ui-scenario surface):
 * one builder for the reference pack, the dictation-pack builder it shares with the real ASR path,
 * and the seam's build counter a scenario uses to assert it reached that same builder.
 */
export {
  buildVoiceInputContextPack,
  buildVoiceReferencePack,
  readVoiceInputPackBuildCount,
} from '@/modules/chat-voice';
export type { VoiceReferencePack } from '@/modules/chat-voice';
export { default as ResidentSessionBadge } from '@/modules/chat/transcript/ResidentSessionBadge';
/**
 * The cockpit's push-to-talk reuses chat's ONE dictation hook rather than a second ASR path:
 * dictated text lands in the cockpit's input box exactly as it does in the composer. The
 * capture-engine and draft types travel with it so the cockpit hook can accept an injected
 * engine, which is what lets a test push PCM without a microphone.
 */
export { useVoiceInput } from '@/modules/chat-voice';
export type {
  VoiceCaptureEngine,
  VoiceCaptureSink,
  VoiceDraftSnapshot,
  VoiceSource,
} from '@/modules/chat-voice';
/** The composer's mic control, rendered by the cockpit input beside the same submit button. */
export { VoiceInputButton, VoiceFailureNotice } from '@/modules/chat-composer';
/**
 * The composer's presentation shell, exposed so the cockpit's intent input is assembled from
 * the SAME form/textarea/footer/submit components instead of a copy. The cockpit deliberately
 * does not reuse `ChatComposer` itself: that component is bound to one session's permission,
 * model and effort state, which a fleet-wide view does not have.
 */
export {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from '@/modules/chat-composer';
/**
 * The wall's deterministic referent resolver — 「第二个」/「②」/「红的那个」 over a view's
 * declared `{uri,label,display}` objects. The cockpit's intent parser resolves the same spoken
 * phrases over the same contract, so it calls this implementation rather than a second one.
 */
export { resolveVoiceReference } from '@/modules/chat-voice';
export type { VoiceReferenceMatch } from '@/modules/chat-voice';
/**
 * The ONE session-allocation gateway, exposed for the cockpit's card button: starting a
 * conversation about a card allocates a brand-new session through the same call the composer and
 * Live Voice use, rather than minting a second creation path.
 */
export { createChatSession } from '@/modules/chat-session';
export type { CreatedChatSession } from '@/modules/chat-session';

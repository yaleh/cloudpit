/**
 * Thin re-export kept for the criteria that import the dock by its former
 * composer path. The dock now lives in `chat/activity` so the transcript half can
 * render it without importing the composer half.
 */
export { ActivityIndicator as default } from '@/modules/chat-support';

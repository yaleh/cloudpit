/**
 * Transcript sub-package of `chat/utils`: the row model, keys and ordering, message text
 * projection (markdown, diffs, tool groups) and the geometry the transcript renders
 * against. Consumers reach transcript utilities through this barrel.
 *
 * The downloadable-export entry point (`chatExport`) lives in `chat/export/`: it composes
 * `chat/export/*`, whose components import this barrel, so keeping it here would make the
 * utils layer depend on the export feature and close a package cycle.
 */
export * from '@/modules/chat/utils/transcript/chatFormatting';
export * from '@/modules/chat/utils/transcript/contentHeightModel';
export * from '@/modules/chat/utils/transcript/jumpAnchorLock';
export * from '@/modules/chat/utils/transcript/liveRowIdentity';
export * from '@/modules/chat/utils/transcript/messageKeys';
export * from '@/modules/chat/utils/transcript/messageTransforms';
export * from '@/modules/chat/utils/transcript/searchTargetLocator';
export * from '@/modules/chat/utils/transcript/streamingMarkdown';
export * from '@/modules/chat/utils/transcript/syntaxHighlightTheme';
export * from '@/modules/chat/utils/transcript/toolGrouping';
export * from '@/modules/chat/utils/transcript/workSegments';
export * from '@/modules/chat/utils/transcript/workSegmentTitle';

// The brief subpackage's public surface: the LLM-backed brief service, its settings
// source and the result/token helpers the composition entry needs. The card content
// contract (BriefSpec validation, presets and prompts) is internal to this subpackage;
// the provider that needs `BRIEF_VERSION` imports `cockpit-brief-core.js` directly so a
// fixture scenario does not pull the whole brief service in through this barrel.
export { createCockpitBriefService } from './cockpit-brief.service.js';
export type {
  CockpitBrief,
  CockpitBriefAuthScheme,
  CockpitBriefComplete,
  CockpitBriefCompletion,
  CockpitBriefCompletionRequest,
  CockpitBriefDeps,
  CockpitBriefGateway,
  CockpitBriefProtocol,
  CockpitBriefResult,
} from './cockpit-brief.service.js';
export { fallbackResult, noTokens } from './cockpit-brief-result.js';
export { createCockpitBriefSettingsSource } from './cockpit-brief-settings.js';
export type {
  CockpitBriefSettings,
  CockpitBriefSettingsSource,
} from './cockpit-brief-settings.js';

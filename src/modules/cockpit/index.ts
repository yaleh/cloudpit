// The cockpit's public surface. `App` mounts `CockpitPage` at `/cockpit` and `CockpitRemote` at
// `/cockpit/remote`; the next cockpit task (push-to-talk + focus routing) reuses the same
// deterministic intent parser, so it is exported here rather than deep-imported from its file.
export { default as CockpitPage } from '@/modules/cockpit/CockpitPage';
export { default as CockpitRemote } from '@/modules/cockpit/CockpitRemote';
// The route gate `App` mounts for both cockpit addresses. It reads the server's boot-time
// switch through the shared store and redirects to the workspace when the feature is off.
export { default as CockpitRoute } from '@/modules/cockpit/CockpitRoute';
export { parseCockpitIntent } from '@/modules/cockpit/cockpitIntent';
export type { CockpitIntent, CockpitIntentContext } from '@/modules/cockpit/cockpitIntent';
// The cockpit's address grammar, exported so the sidebar's mode switch and its project rows
// mint the same deep link this module parses (`?view=board&project=…`) instead of each
// spelling `/cockpit` by hand. The storage helpers are the round trip: a session page records
// where it was before entering, and the cockpit's 「会话」 segment leads back to it.
export {
  COCKPIT_PATH,
  buildInitiativeContract,
  buildObservationWallContract,
  cockpitViewPath,
  readCockpitReturnPath,
  rememberCockpitReturnPath,
  resolveCockpitProject,
} from '@/modules/cockpit/cockpitView';
export type {
  CockpitProject,
  CockpitView,
  InitiativeAuditDecision,
  InitiativeCharterReading,
  InitiativeDecidePort,
  InitiativeDecisionOption,
  InitiativeDecisionOutcome,
  InitiativeDecisionRequest,
  InitiativeEdgeKind,
  InitiativeEdgeReading,
  InitiativeMemberReading,
  InitiativeQueueItem,
  InitiativeReading,
  InitiativeReadingAnswer,
  InitiativeReadingDocument,
  InitiativeReadingUnavailable,
} from '@/modules/cockpit/cockpitView';
// The initiative view and the decision queue: the two surfaces `CockpitPage` mounts for
// `/cockpit?view=initiatives`. Exported so a scenario runner (and a sibling criterion) can
// render them without the whole page.
export { default as InitiativeView } from '@/modules/cockpit/InitiativeView';
export { default as DecisionQueue, sampleAuditDecisions } from '@/modules/cockpit/DecisionQueue';
// The deployment strip: `CockpitPage` mounts it persistently. `DeployConfirmDialog` is the one
// confirmation panel and confirmed write, reused by the notices module's slot so a deploy started
// from the chat page passes through the same human confirmation. Exported here so the notices
// module reaches it through this barrel rather than deep-importing the cockpit's files.
export { default as DeployReadiness, DeployConfirmDialog } from '@/modules/cockpit/DeployReadiness';
export type {
  DeployCommitReading,
  DeployConfirmDialogProps,
  DeployExecutePort,
  DeployFailureReading,
  DeployLastDeployReading,
  DeployReadinessPort,
  DeployReadinessReading,
  DeployStatus,
} from '@/modules/cockpit/DeployReadiness';
export {
  decideInitiative,
  fetchInitiativeReading,
  useInitiativeReading,
} from '@/modules/cockpit/hooks/useInitiatives';
export type {
  InitiativeReadingConnection,
  InitiativeReadingView,
} from '@/modules/cockpit/hooks/useInitiatives';
// The observation URI grammar, so the sidebar's 「钉到观察墙」 mints the same address the
// producers wrote and the wall reads — one spelling, both sides.
export {
  formatArchitectureUri,
  formatInitiativeUri,
  formatProjectUri,
  formatSessionUri,
  parseObservationUri,
} from '@/modules/cockpit/observationUri';
// The observation wall itself, and the row action the sidebar shares with it. Exported here so
// the sidebar mints its pin toggle from the same module (and the same pin cache) the wall uses.
export { default as ObservationWall } from '@/modules/cockpit/ObservationWall';
export { default as ObservationPreview } from '@/modules/cockpit/ObservationPreview';
export {
  WatchPinToggle,
  observationLiveness,
  observationSummary,
} from '@/modules/cockpit/ObservationTile';
export {
  deriveSelfReading,
  fetchObservationWall,
  markObservationSeen,
  observationPinnedUris,
  setObservationWatch,
  useObservationPin,
  useObservationWall,
} from '@/modules/cockpit/hooks/useObservationWall';
export type {
  ObservationKind,
  ObservationWall as ObservationWallData,
  ObservationWallEntry,
  ObservationWallView,
  ObservedObject,
  ObservationProducerReading,
} from '@/modules/cockpit/hooks/useObservationWall';
// The cards view: one list over every provider's open cards, backed by a React-free controller.
// The reading type and `cockpitCardsReading` are exported for the scenario-runner task that
// consumes the list's `data-cockpit-cards` attribute; the controller factory is exported so a
// sibling criterion can drive the same rules without a browser.
export { default as CockpitCardList } from '@/modules/cockpit/CockpitCardList';
export { default as CockpitCard } from '@/modules/cockpit/CockpitCard';
export { default as CockpitCardDetails } from '@/modules/cockpit/CockpitCardDetails';
// The Details drawer's brief section. Exported for the same reason as the list: a sibling
// criterion (or a scenario surface) renders it without mounting the whole cards view.
export { default as CockpitBriefView } from '@/modules/cockpit/CockpitBriefView';
export { CockpitBriefBlockView } from '@/modules/cockpit/cockpitBriefBlocks';
export type { CockpitBriefBlockContext } from '@/modules/cockpit/cockpitBriefBlocks';
export type { CockpitBriefState } from '@/modules/cockpit/cockpitCardController';
export {
  cockpitCardDescriptor,
  DEFAULT_COCKPIT_CARD_DESCRIPTOR,
} from '@/modules/cockpit/cockpitCardDescriptors';
export type {
  CockpitCardDescriptor,
  CockpitCardVizKind,
} from '@/modules/cockpit/cockpitCardDescriptors';
export {
  cockpitCardsReading,
  confirmTargetOf,
  createCockpitCardController,
  defaultShownOption,
  isIrreversibleOption,
  shownOptionOf,
} from '@/modules/cockpit/cockpitCardController';
export type {
  CockpitCardConfirmOutcome,
  CockpitCardConfirmRequest,
  CockpitCardConfirmTarget,
  CockpitCardController,
  CockpitCardControllerDeps,
  CockpitCardControllerSnapshot,
  CockpitCardDensity,
  CockpitCardReading,
  CockpitCardShown,
  CockpitCardTypeFilter,
} from '@/modules/cockpit/cockpitCardController';
export { useCockpitCards } from '@/modules/cockpit/hooks/useCockpitCards';
export type {
  CockpitCardsBinding,
  CockpitCardsDepsOverride,
} from '@/modules/cockpit/hooks/useCockpitCards';
// The PC right column: the frame controller, the column itself, the header's count button, and
// the one binding the three read. The workspace shell mounts the provider and the column; the
// header draws the button; the sidebar's mode switch asks the same binding whether the column is
// open. Exported through the barrel so none of them deep-imports the cockpit's files.
export {
  cockpitColumnLayoutFor,
  createCockpitColumnController,
  COCKPIT_COLUMN_DEFAULT_WIDTH,
  COCKPIT_COLUMN_MAX_WIDTH,
  COCKPIT_COLUMN_MIN_WIDTH,
  COCKPIT_COLUMN_OVERLAY_MIN_WIDTH,
  COCKPIT_COLUMN_SQUEEZE_MIN_WIDTH,
  COCKPIT_COLUMN_STORAGE_KEY,
} from '@/modules/cockpit/cockpitColumnController';
export type {
  CockpitColumnController,
  CockpitColumnControllerDeps,
  CockpitColumnLayout,
  CockpitColumnSnapshot,
  CockpitColumnStorage,
} from '@/modules/cockpit/cockpitColumnController';
export {
  CockpitColumnContext,
  useCockpitColumn,
  useCockpitColumnContext,
} from '@/modules/cockpit/hooks/useCockpitColumn';
export type { CockpitColumnBinding } from '@/modules/cockpit/hooks/useCockpitColumn';
export { default as CockpitColumn, CockpitColumnProvider } from '@/modules/cockpit/CockpitColumn';
export { default as CockpitHeaderButton } from '@/modules/cockpit/CockpitHeaderButton';

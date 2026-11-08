/**
 * Claude-activity subpackage barrel — the per-run activity tables (tasks,
 * schedules, turn phase) and the resident/systemd session-scope spawn helpers
 * the Claude runtime drives. They are Claude-shaped but provider-runtime-free:
 * the lease deriver that mixes all three stays in the package root.
 *
 * Dependency direction: `claude-activity/` imports only `server/shared/**` and
 * node builtins. It never imports `modules/providers` (the root or
 * `providers/list/claude`), so it cannot join the AC-394 provider cycle.
 */
export {
  CLI_NOTIFIED_TASK_KINDS,
  createClaudeTaskReducer,
  earnsTaskTerminalRow,
  mapUpdatedStatus,
} from './claude-activity-task-reducer.service.js';
export type {
  ActivityTask,
  BackgroundTaskSummary,
  ClaudeTaskReducer,
  ClaudeTaskReducerMutations,
  ClaudeTaskTransition,
  TaskKind,
  TaskOrigin,
  TaskState,
} from './claude-activity-task-reducer.service.js';

export { createClaudeScheduleTracker } from './claude-activity-schedules.service.js';
export type {
  ActivitySchedule,
  ClaudeScheduleTracker,
  ClaudeScheduleTrackerOptions,
  ScheduleKind,
  ScheduleSource,
  SessionCronEntry,
} from './claude-activity-schedules.service.js';

export {
  DEFAULT_RESIDENT_MEMORY_MAX,
  DEFAULT_RESIDENT_SLICE_MEMORY_MAX,
  DEFAULT_RESIDENT_SLICE_NAME,
  applyResidentSliceMemoryMax,
  buildResidentScopeUnitName,
  createResidentScopeSpawn,
  detectResidentScopeOomKill,
  listResidentScopeUnits,
  parseResidentScopeOwnerPid,
  probeSystemdUserScope,
  readResidentSliceMemoryMax,
  resetResidentScopeProbeCache,
  resolveResidentMemoryMax,
  resolveResidentScopeSweepEnabled,
  resolveResidentSliceMemoryMax,
  resolveResidentSliceName,
  stopResidentScopes,
  sweepOrphanResidentScopes,
  // The pre-promotion `claude*` aliases stay exported: the runtime wiring and
  // `server/index.ts` still import them, and the criterion asserts the contract
  // they name (generated argv and the literal unit-name shape).
  buildClaudeSessionScopeUnitName,
  createClaudeSessionScopeSpawn,
  DEFAULT_CLAUDE_SESSION_MEMORY_MAX,
  listClaudeSessionScopeUnits,
  parseClaudeSessionScopeOwnerPid,
  resetClaudeSessionScopeProbeCache,
  resolveClaudeSessionMemoryMax,
  stopClaudeSessionScopes,
  sweepOrphanClaudeSessionScopes,
} from './claude-session-scope.service.js';
export type {
  ClaudeSessionScopeSpawnDeps,
  ResidentScopeProcess,
  ResidentScopeSpawnDeps,
  ResidentScopeSpawnImpl,
  SessionScopeProcess,
  SessionScopeSpawnImpl,
} from './claude-session-scope.service.js';

export { createClaudeTurnTracker } from './claude-turn-phase.service.js';
export type { ClaudeTurnTracker } from './claude-turn-phase.service.js';
export type { TurnPhase, TurnState } from './claude-turn-phase.service.js';

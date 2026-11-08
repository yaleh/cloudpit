

// ---------------------------
//----------------- COCKPIT BRIEF (GET /api/cockpit/cards/:id/brief) ------------

/**
 * Whether the brief read produced a model brief or the deterministic default.
 * `generated` means the document passed the host checker; `fallback` means it did
 * not, and `reason` names the rule that prevented it.
 */
export type CockpitBriefStatus = 'generated' | 'fallback';

/** One rejected model round, kept verbatim so the next investigation sees the raw answer. */
export type CockpitBriefFailure = {
  round: number;
  rules: string[];
  raw: string;
  reason: string;
};

/** Every token class both brief ceilings count, cache reads and creations included. */
export type CockpitBriefTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
};

/** One consequence tag on a brief option: the fixed kind plus the words shown for it. */
export type CockpitBriefConsequence = {
  kind: string;
  text: string;
};

/** One alternative the brief offers; `does` is what choosing it does. */
export type CockpitBriefOption = {
  id: string;
  label: string;
  does: string;
  consequence: CockpitBriefConsequence[];
  evidenceRefs?: string[];
};

/** The option the brief recommends, with 1–3 reasons. */
export type CockpitBriefRecommendation = {
  optionId: string;
  why: string[];
};

/** One evidence item the blocks cite; `mechanical` separates a measurement from a judgement. */
export type CockpitBriefEvidence = {
  id: string;
  label: string;
  mechanical: boolean;
  ref?: string;
  observedAt?: string;
};

/** The fixed block vocabulary the client renderer table is keyed by. */
export type CockpitBriefBlockType =
  | 'radar'
  | 'compare-table'
  | 'diffstat'
  | 'checklist'
  | 'timeline'
  | 'graph'
  | 'callout';

/** How a radar axis was measured: an evidence-backed reading or the model's judgement. */
export type CockpitBriefAxisBasis = 'mechanical' | 'llm';

/** One radar axis; `rev` and `evid` are mandatory on every radar. */
export type CockpitBriefRadarAxis = {
  id: string;
  label: string;
  definition: string;
  basis: CockpitBriefAxisBasis;
  evidenceRefs?: string[];
};

/** One option's scores on every radar axis, keyed by axis id. */
export type CockpitBriefRadarSeries = {
  optionId: string;
  values: Record<string, number>;
  notes?: string;
};

/** A radar: every option scored on the same axes, rev and evid always present. */
export type CockpitBriefRadarBlock = {
  id: string;
  type: 'radar';
  title: string;
  axes: CockpitBriefRadarAxis[];
  series: CockpitBriefRadarSeries[];
};

/** One row of a comparison table; cells are keyed by option id. */
export type CockpitBriefCompareTableRow = {
  label: string;
  cells: Record<string, string>;
  basis?: CockpitBriefAxisBasis;
};

/** A comparison of facts that do not fit a 0–100 axis. */
export type CockpitBriefCompareTableBlock = {
  id: string;
  type: 'compare-table';
  title: string;
  columns: string[];
  rows: CockpitBriefCompareTableRow[];
};

/** One changed file: additions and deletions. */
export type CockpitBriefDiffstatFile = {
  path: string;
  add: number;
  del: number;
};

/** The files a change touches and how much of each. */
export type CockpitBriefDiffstatBlock = {
  id: string;
  type: 'diffstat';
  title: string;
  files: CockpitBriefDiffstatFile[];
};

/** One checklist item; `done` is optional and defaults to not done. */
export type CockpitBriefChecklistItem = {
  text: string;
  done?: boolean;
};

/** Open questions or steps to tick through. */
export type CockpitBriefChecklistBlock = {
  id: string;
  type: 'checklist';
  title: string;
  items: CockpitBriefChecklistItem[];
};

/** How one timeline event ended. */
export type CockpitBriefTimelineState = 'ok' | 'bad' | 'neutral';

/** One ordered event. */
export type CockpitBriefTimelineEvent = {
  at: string;
  label: string;
  state: CockpitBriefTimelineState;
};

/** Ordered events, e.g. a worker's failed attempts. */
export type CockpitBriefTimelineBlock = {
  id: string;
  type: 'timeline';
  title: string;
  events: CockpitBriefTimelineEvent[];
};

/** How a graph node changed. */
export type CockpitBriefGraphNodeState = 'changed' | 'same' | 'new' | 'bad';

/** One node of a small dependency/impact graph. */
export type CockpitBriefGraphNode = {
  id: string;
  label: string;
  state: CockpitBriefGraphNodeState;
};

/** One directed edge between two graph nodes. */
export type CockpitBriefGraphEdge = {
  from: string;
  to: string;
  kind?: string;
};

/** A small dependency/impact graph. */
export type CockpitBriefGraphBlock = {
  id: string;
  type: 'graph';
  title: string;
  nodes: CockpitBriefGraphNode[];
  edges: CockpitBriefGraphEdge[];
};

/** The tone a callout uses. */
export type CockpitBriefCalloutTone = 'info' | 'warn';

/** One short note. */
export type CockpitBriefCalloutBlock = {
  id: string;
  type: 'callout';
  tone: CockpitBriefCalloutTone;
  text: string;
};

/** The brief's visual blocks, discriminated by `type`. */
export type CockpitBriefBlock =
  | CockpitBriefRadarBlock
  | CockpitBriefCompareTableBlock
  | CockpitBriefDiffstatBlock
  | CockpitBriefChecklistBlock
  | CockpitBriefTimelineBlock
  | CockpitBriefGraphBlock
  | CockpitBriefCalloutBlock;

/**
 * The read endpoint's answer: the brief document flattened beside its identity, status and
 * spend. `status: 'fallback'` always names a `reason` and carries no blocks, so the renderer
 * can show the reason instead of drawing an empty chart. The fields are hand-copied in
 * `src/shared/types.ts` and pinned by `cockpitCardTypeSync.test.ts`.
 */
export type CockpitBriefResponse = {
  cardId: string;
  sessionId: string;
  askId: string | null;
  revision: number | null;
  messageId: string | null;
  status: CockpitBriefStatus;
  reason: string | null;
  cached: boolean;
  question: string | null;
  rounds: number;
  durationMs: number;
  failures: CockpitBriefFailure[];
  tokens: CockpitBriefTokens;
  v: number;
  itemRef: string;
  headline: string;
  fallback?: boolean;
  options: CockpitBriefOption[];
  recommendation: CockpitBriefRecommendation | null;
  evidence: CockpitBriefEvidence[];
  blocks: CockpitBriefBlock[];
};


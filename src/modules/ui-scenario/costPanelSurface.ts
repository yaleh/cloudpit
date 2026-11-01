/**
 * The `/cost` command modal's cache-accounting reading.
 *
 * WHY THIS IS A SIBLING FILE. The panel's slice of the scenario surface is one reading taken from
 * the panel's own `data-cost-*` declarations; the surface's own criterion caps every source file
 * at 800 lines, so the slice lives here and `scenarioSurface` imports it (the same split as the
 * cockpit cards view). The module's `index.ts` barrel re-exports the public type, so the frontend
 * boundary rule still has one cross-module import path.
 *
 * THE READING IS THE PANEL'S OWN DECLARATION. The modal does not import this dev-only module, so
 * the reading is the DOM it draws: each row declares `data-cost-label`/`data-cost-value` (and the
 * derived hit-rate row names itself with `data-cost-role`), the proportion bar's segments declare
 * their key and percentage, and the provider statement is its own `data-testid`. A closed modal
 * answers `open: false` with every other field absent — never a fabricated ratio.
 */

/** One usage line, exactly as the panel drew it. */
export type ScenarioCostPanelRowReading = {
  label: string;
  value: string;
  /** The row's stable role (e.g. `cache-hit-ratio`), or `null` for an ordinary quantity. */
  role: string | null;
};

/** One proportion-bar segment, in draw order. */
export type ScenarioCostPanelSegmentReading = {
  key: string;
  percent: number;
};

/** The `/cost` panel's cache-accounting reading. */
export type ScenarioCostPanelReading = {
  /** Whether the panel is mounted right now. */
  open: boolean;
  /** The provider's cache-accounting sentence, or `null` when absent. */
  accountingNote: string | null;
  /** The hit-rate row's value (e.g. `30%`), or `null` when no ratio was drawn. */
  cacheHitRatio: string | null;
  /** Bar segments in draw order. */
  segments: ScenarioCostPanelSegmentReading[];
  /** Rendered usage rows in draw order. */
  rows: ScenarioCostPanelRowReading[];
};

/** The reading returned when the `/cost` modal is closed: every field is honestly absent. */
const EMPTY_COST_PANEL_READING: ScenarioCostPanelReading = {
  open: false,
  accountingNote: null,
  cacheHitRatio: null,
  segments: [],
  rows: [],
};

/**
 * Reads the `/cost` modal's cache accounting from the DOM the panel draws.
 *
 * Every quantity the panel shows declares itself (`data-cost-label`/`data-cost-value`), so a
 * scenario can assert a row's presence and value without matching translated prose. A closed
 * modal answers the empty reading — that is what lets a scenario step assert it closed again.
 */
export function readCostPanelReading(): ScenarioCostPanelReading {
  if (typeof document === 'undefined') {
    return { ...EMPTY_COST_PANEL_READING, segments: [], rows: [] };
  }
  const panel = document.querySelector('[data-testid="cost-panel"]');
  if (!(panel instanceof HTMLElement)) {
    return { ...EMPTY_COST_PANEL_READING, segments: [], rows: [] };
  }
  const rows = [...panel.querySelectorAll('[data-testid="cost-usage-row"]')].map((node) => ({
    label: node.getAttribute('data-cost-label') ?? '',
    value: node.getAttribute('data-cost-value') ?? '',
    role: node.getAttribute('data-cost-role'),
  }));
  const segments = [...panel.querySelectorAll('[data-cost-segment]')].map((node) => ({
    key: node.getAttribute('data-cost-segment') ?? '',
    percent: Number(node.getAttribute('data-cost-percent') ?? '0'),
  }));
  const note = panel.querySelector('[data-testid="cost-cache-accounting-note"]');
  const noteText = note instanceof HTMLElement ? note.textContent?.trim() ?? '' : '';
  const ratioRow = rows.find((row) => row.role === 'cache-hit-ratio');
  return {
    open: true,
    accountingNote: noteText === '' ? null : noteText,
    cacheHitRatio: ratioRow?.value ?? null,
    segments,
    rows,
  };
}

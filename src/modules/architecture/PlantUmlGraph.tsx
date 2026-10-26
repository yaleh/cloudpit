import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { DEFAULT_NODE_ID_SHAPE } from '@/modules/architecture/adaptiveGrouping';
import { ArchitectureMinimap } from '@/modules/architecture/ArchitectureMinimap';
import {
  BOTTOM_SLOT_GAP_PX,
  bottomCornerLayout,
  overlayLayoutDefect,
} from '@/modules/architecture/bottomSlotLayout';
import {
  archguardToPlantUml,
  DEFAULT_NEIGHBORHOOD_HOPS,
  memberDisplayLimits,
  parserSafePlantUml,
  type ArchitectureDiagramView,
} from '@/modules/architecture/archguardToPlantUml';
import { standardiseDrawnStereotypes } from '@/modules/architecture/plantUmlText';
import {
  createLayoutEngine,
  type ArchitectureLayoutEngineClass,
} from '@/modules/architecture/elkAspectEngine';
import {
  graphFingerprint,
  type LayoutOrientation,
  type OrientationSize,
} from '@/modules/architecture/layoutOrientation';
import {
  solveFitArea,
  semanticContentBounds,
  type FitAreaRect,
  type FitOverlayRect,
  type SemanticZoomLayout,
} from '@/modules/architecture/semanticZoomLayout';
import {
  createGraphLayoutPipeline,
  LAYOUT_STATUS_THRESHOLD_MS,
  type GraphLayoutCommit,
} from '@/modules/architecture/graphLayoutPipeline';
import { capDrawnMemberRows, drawnFitScaleOf } from '@/modules/architecture/drawnFit';
import {
  SEMANTIC_MIN_FONT_MOBILE_PX,
  SEMANTIC_MIN_FONT_PX,
} from '@/modules/architecture/semanticZoomPlan';
import {
  PORTRAIT_CONTROL_BAND_PX,
  TOUCH_CONTROL_GAP_PX,
  TOUCH_TARGET_STYLE,
  useCanvasHeaderSlot,
  useCompactToolbarSlot,
  useTouchLayout,
  ZOOM_CLUSTER_TARGET_STYLE,
} from '@/modules/architecture/hooks/useTouchLayout';
import { canvasIsTooWide } from '@/modules/architecture/readableZoom';
import type {
  ArchitectureDiffHighlight,
  ArchitectureRendererEdge,
  ArchitectureRendererNode,
  ArchitectureRendererProps,
} from '@/modules/architecture/rendererContract';
import {
  moveEntityFocus,
  PACKAGE_NAV_PREFIX,
  type EntityNavigationDirection,
  type EntityNavigationItem,
} from '@/modules/architecture/entityNavigation';
import { createGraphGestureController } from '@/modules/architecture/graphGestureController';
import { createGraphSelectionController } from '@/modules/architecture/graphSelectionController';
import {
  createGraphViewportController,
  type GraphZoom,
} from '@/modules/architecture/graphViewportController';
import {
  selectionsIntersectingBox,
  type ArchitectureSelection,
} from '@/modules/architecture/selectionModel';
import {
  centerElementInContainer,
  centeredScrollForDrawingRect,
  clampZoomScale,
  createSvgDragPan,
  createSvgTouchGestures,
  createSvgViewport,
  fitAreaInsets,
  fitPlacementAvoidingCorners,
  applyZoomScale,
  measureHostSize,
  measureViewportSize,
  MIN_READABLE_ZOOM_SCALE,
  MIN_ZOOM_SCALE,
  readSvgNaturalSize,
  ZOOM_STEP,
  type SvgCornerRect,
  type SvgFitPlacement,
  type SvgViewportSize,
} from '@/modules/architecture/svgViewport';
import {
  ENTITY_HIGHLIGHT_EVENT,
  GROUP_PREFIX,
  KEYBOARD_PAN_STEP,
  STUB_PREFIX,
  TOOLBAR_BUTTON_CLASS,
} from '@/modules/architecture/graphConstants';
import {
  addNodeHitTargets,
  annotateNodes,
  addEdgeHitTargets,
  announceSelection,
  applySelectionStyles,
  boxCandidates,
  captureSemanticDrawing,
  clearHighlight,
  defaultViewOf,
  drawSemanticLayout,
  drawStickyLabels,
  drawingKeyOf,
  drawnPackageFrame,
  edgeElement,
  highlightEdge,
  highlightRelations,
  highlightSelection,
  hideEdgeLabels,
  isEntityGraph,
  markDrawingUnselectable,
  measureLayoutAspect,
  nearestNodeHitId,
  nodeElement,
  positionOverviewHint,
  relationsOf,
  rendererOptionsFor,
  restoreEntityIds,
  reverseAliases,
  selectionOf,
  type PlantUmlApplyView,
  type PlantUmlRenderDetailed,
  type PlantUmlToPlantUml,
  type SemanticCapture,
} from '@/modules/architecture/graphDom';
import {
  CANVAS_UNSELECTABLE_STYLE,
  HIGHLIGHT_STYLE,
} from '@/modules/architecture/graphStyles';

/**
 * The marker-anchor geometry lives in `graphDom.ts` with the rest of the
 * drawing helpers; it stays exported from this module because the renderer is
 * where a reader (and the geometry test) expects to find it.
 */
export { markerAnchor } from '@/modules/architecture/graphDom';

/**
 * The DEV-only lever a control arm pulls to draw the SAME document with the
 * member caps genuinely ABSENT.
 *
 * `e2e/architecture-canvas-layout.spec.ts` has to prove its node-size guard can
 * go red on the defect it watches. Injecting a wide rect into the live SVG
 * would only imitate the symptom: the box was wide because the renderer's
 * layout used the untruncated member text, so the honest lever is to not pass
 * the options. DEV-gated exactly like the `?ui-scenario=1` semantic surface —
 * a production build does not contain this branch.
 */
const MEMBER_LIMITS_STORAGE_KEY = 'architecture-member-limits';

/** The member caps to hand the renderer: the shipped ones, or none for the control arm. */
function drawnMemberLimits(): { memberMaxChars?: number } {
  if (import.meta.env.DEV) {
    try {
      if (window.localStorage.getItem(MEMBER_LIMITS_STORAGE_KEY) === 'off') return {};
    } catch {
      // Private mode: the store is unreadable, so the shipped caps apply.
    }
  }
  return memberDisplayLimits();
}

/**
 * The DEV-only lever the orientation criterion's control arms pull: forcing a
 * direction is the only way to measure what the canvas looks like for the
 * direction the policy did NOT choose — laid out for real, through the same
 * reading. `down` is the pre-feature state; `right` is the losing candidate
 * once the fit comparison is post-reclaim.
 *
 * DEV-gated exactly like the member-limit lever above — a production build does
 * not contain this branch, so no reader can turn the feature off.
 */
const LAYOUT_ORIENTATION_STORAGE_KEY = 'architecture-layout-orientation';

/** Whether this build's control arm asked for one fixed direction. */
function forcedLayoutOrientation(): LayoutOrientation | null {
  if (import.meta.env.DEV) {
    try {
      const forced = window.localStorage.getItem(LAYOUT_ORIENTATION_STORAGE_KEY);
      if (forced === 'down') return 'DOWN';
      if (forced === 'right') return 'RIGHT';
    } catch {
      // Private mode: the store is unreadable, so the shipped policy applies.
    }
  }
  return null;
}

/** The natural size a finished layout reports, or `null` when it is unusable. */
function layoutSizeOf(detailed: { readonly layout: unknown }): OrientationSize | null {
  const layout = detailed.layout as { readonly width?: unknown; readonly height?: unknown } | null;
  const width = Number(layout?.width);
  const height = Number(layout?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

/**
 * The row-cap and drawn-fit readings live in `drawnFit.ts` (this panel is
 * size-ratcheted); `capDrawnMemberRows` stays re-exported here because the
 * renderer is where its consumers expect to find it.
 */
export { capDrawnMemberRows };

/**
 * The member detail every drawing is rendered with.
 *
 * The package's default picks a level from the entity count (`≤40` full,
 * `≤150` compact, else names). Compact replaces every box's tail with a
 * synthetic `… +N more (M members)` row and, more importantly, writes that row
 * into the drawn MODEL — so `renderDetailed(...).model`, which the text page
 * serializes, was already lossy on any diagram past 40 entities. The text the
 * reader copies, downloads or sends must carry every member, so the detail is
 * pinned here instead of left to the entity count. The on-screen row cap is the
 * semantic-zoom layout's job (`planMemberRows`), independent of this value.
 *
 * Consumers: `PlantUmlGraph.tsx` (the render call) and
 * `tests/plantUmlText.test.ts` (the completeness criteria).
 */
export const PLANTUML_MEMBER_DETAIL = 'full' as const;

/**
 * Call `renderDetailed` with {@link PLANTUML_MEMBER_DETAIL} added to its
 * options.
 *
 * `type PlantUmlRenderDetailed` in `graphDom.ts` models only the structural
 * subset the renderer needs (`layout`/`view`); the package's own `detail`
 * option is added here, once, so every drawing — and therefore every drawn
 * model the text page serializes — is complete. Kept as a named function so a
 * unit test can assert the option the real renderer receives without mounting
 * the component.
 *
 * Consumers: `PlantUmlGraph.tsx` (the only render call) and
 * `tests/plantUmlText.test.ts`.
 */
export function renderWithMemberDetail(
  render: PlantUmlRenderDetailed,
  puml: string,
  options: Partial<Parameters<PlantUmlRenderDetailed>[1]> = {},
): ReturnType<PlantUmlRenderDetailed> {
  // A variable, not a fresh literal: the structural options type deliberately
  // does not name `detail`, and an object with the extra key is assignable to
  // it (the package reads the key at runtime).
  const detailedOptions = { ...options, detail: PLANTUML_MEMBER_DETAIL };
  return render(puml, detailedOptions as Parameters<PlantUmlRenderDetailed>[1]);
}

/** The class the keyboard cursor paints on the drawn box it stands on. */
const NAV_FOCUS_CLASS = 'arch-nav-focus';
/** The class the focus RING carries (distinct from the selection class). */
const NAV_RING_CLASS = 'arch-nav-ring';
/** The id prefix the cursor's DOM elements carry, for `aria-activedescendant`. */
const NAV_DOM_ID_PREFIX = 'arch-nav-';
/** How far the focus ring sits outside the box, in SVG user units. */
const NAV_RING_GAP = 2;

/**
 * Resolve after the browser has had the chance to PAINT what React just
 * committed.
 *
 * The layout this guards is one blocking call on the main thread: once it
 * starts, nothing — not a status line, not an animation — can be committed or
 * painted until it returns. The status must therefore be in the document and
 * on screen BEFORE the layout is entered, which is what the frame + task pair
 * here buys: the frame callback runs after the commit, and the timeout yields
 * to the paint that follows it.
 */
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    window.requestAnimationFrame(() => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * The id `aria-activedescendant` names. Derived from the cursor id alone, so the
 * React attribute and the element's own `id` are written from one source and
 * cannot disagree.
 */
function navigationDomId(cursorId: string): string {
  return `${NAV_DOM_ID_PREFIX}${cursorId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/** A positive numeric attribute, or `null` when absent/unparseable. */
function numericAttribute(element: Element, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * The item's rectangle in the SVG's own user coordinates.
 *
 * The leading `rect` is read FIRST: the semantic pass rebuilds every group's
 * children in the mapped layout but leaves the group's original `data-x/y/w/h`
 * (published by the renderer before that rewrite) in place, so a ring painted
 * from those would sit at the pre-semantic position. A drawing the semantic
 * pass has not touched has the two in agreement, and the attributes remain the
 * fallback for a group without a rect.
 */
function navigationRectOf(element: Element): { x: number; y: number; width: number; height: number } | null {
  const rect = element.querySelector('rect');
  const x = (rect === null ? null : numericAttribute(rect, 'x')) ?? numericAttribute(element, 'data-x');
  const y = (rect === null ? null : numericAttribute(rect, 'y')) ?? numericAttribute(element, 'data-y');
  const width = (rect === null ? null : numericAttribute(rect, 'width')) ?? numericAttribute(element, 'data-w');
  const height = (rect === null ? null : numericAttribute(rect, 'height')) ?? numericAttribute(element, 'data-h');
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

/** The package a node id lives in, when the drawing did not publish one. */
function packageIdOfNodeId(id: string): string {
  const path = id.startsWith(GROUP_PREFIX) ? id.slice(GROUP_PREFIX.length) : id;
  const slash = path.lastIndexOf('/');
  if (slash === -1) return '';
  // An entity id is `<file path>.<Entity>`; its file's directory is the package.
  return path.slice(0, slash);
}

function normalizedPackageId(raw: string | null): string | null {
  if (raw === null) return null;
  const normalized = raw.trim().split('/').filter(Boolean).join('/');
  return normalized;
}

// ── the observation wall's structural diff ──────────────────────────────────

/** The attribute/class a diff-marked element carries; both are removed on clear. */
const DIFF_MARK_ATTRIBUTE = 'data-architecture-diff';
const DIFF_NODE_CLASS = 'arch-diff-node';
const DIFF_EDGE_CLASS = 'arch-diff-edge';

/** The marker's stylesheet: an amber dashed frame/line, distinct from selection blue. */
const DIFF_HIGHLIGHT_STYLE = `
  [data-architecture-plantuml] .${DIFF_NODE_CLASS} > rect { stroke: #c2410c; stroke-width: 2.5; stroke-dasharray: 5,3; }
  [data-architecture-plantuml] .${DIFF_EDGE_CLASS} path,
  [data-architecture-plantuml] .${DIFF_EDGE_CLASS} polyline,
  [data-architecture-plantuml] .${DIFF_EDGE_CLASS} line { stroke: #c2410c; stroke-width: 2.5; stroke-dasharray: 6,3; }
`;

/**
 * Whether a drawn package id is the declared package (or lives inside it).
 *
 * The two sides spell a package from different roots on purpose: the snapshot's ids are
 * project-relative (`server/modules/observation`), while the drawing publishes the scope's own
 * path (`modules/observation`, sometimes with the opaque scope key in front). Neither side is
 * wrong, so the match accepts a suffix on EITHER side at a path boundary rather than an exact
 * string — anything looser would mark a neighbour.
 */
function packageMatches(candidate: string | null, wanted: string): boolean {
  if (candidate === null) return false;
  const normalizedCandidate = candidate.replace(/^\/+|\/+$/g, '');
  const normalizedWanted = wanted.trim().replace(/^\/+|\/+$/g, '');
  if (normalizedCandidate === '' || normalizedWanted === '') return false;
  return normalizedCandidate === normalizedWanted
    || normalizedCandidate.endsWith(`/${normalizedWanted}`)
    || normalizedCandidate.startsWith(`${normalizedWanted}/`)
    || normalizedWanted.endsWith(`/${normalizedCandidate}`);
}

/** The package a drawn node id belongs to, as the drawing published it. */
function drawnPackageOf(host: HTMLElement, nodeId: string): string | null {
  const element = nodeElement(host, nodeId);
  const published = element === null ? null : normalizedPackageId(element.getAttribute('data-package-id'));
  return published ?? packageOfDrawnId(nodeId);
}

/**
 * The package a drawn id names, for a node that carries no `data-package-id`.
 *
 * A collapsed overview draws PACKAGE boxes (`grp::server/modules/observation`) rather than files;
 * that box IS the package, so its whole id is the package id. Everything else is a file/entity id
 * and its directory is the package.
 */
function packageOfDrawnId(nodeId: string): string | null {
  if (nodeId === '') return null;
  if (nodeId.startsWith(GROUP_PREFIX)) return normalizedPackageId(nodeId.slice(GROUP_PREFIX.length));
  return packageIdOfNodeId(nodeId);
}

/** Removes every diff marker from a drawing (a fresh SVG never carries any). */
function clearDiffStyles(host: HTMLElement): void {
  for (const element of host.querySelectorAll(`[${DIFF_MARK_ATTRIBUTE}]`)) {
    element.removeAttribute(DIFF_MARK_ATTRIBUTE);
    element.classList.remove(DIFF_NODE_CLASS, DIFF_EDGE_CLASS);
  }
}

/**
 * Marks the structural differences the observation tile passed in.
 *
 * Package ids mark their member nodes; package EDGES mark every drawn relation crossing that
 * pair; the exact `nodeIds`/`edges` forms mark the ids verbatim. With no highlight (or an empty
 * one) the drawing is left exactly as it was — the pre-highlight rendering.
 */
function applyDiffStyles(host: HTMLElement, highlight: ArchitectureDiffHighlight | null): void {
  clearDiffStyles(host);
  if (highlight === null) return;

  const exactNodeIds = new Set(highlight.nodeIds ?? []);
  const packageIds = (highlight.packageIds ?? []).filter((entry) => entry.trim() !== '');
  for (const element of host.querySelectorAll('.uml-node[data-entity-id]')) {
    const id = element.getAttribute('data-entity-id') ?? '';
    const packageId = normalizedPackageId(element.getAttribute('data-package-id'))
      ?? packageOfDrawnId(id);
    const marked = exactNodeIds.has(id)
      || packageIds.some((wanted) => packageMatches(packageId, wanted));
    if (!marked) continue;
    element.setAttribute(DIFF_MARK_ATTRIBUTE, 'node');
    element.classList.add(DIFF_NODE_CLASS);
  }

  const exactEdges = highlight.edges ?? [];
  const packageEdges = (highlight.packageEdges ?? []).filter(
    (entry) => entry.from.trim() !== '' && entry.to.trim() !== '',
  );
  for (const element of host.querySelectorAll('.uml-edge[data-edge-source]')) {
    const from = element.getAttribute('data-edge-source') ?? '';
    const to = element.getAttribute('data-edge-target') ?? '';
    const marked = exactEdges.some((entry) => entry.from === from && entry.to === to)
      || (packageEdges.length > 0 && packageEdges.some(
        (entry) => packageMatches(drawnPackageOf(host, from), entry.from)
          && packageMatches(drawnPackageOf(host, to), entry.to),
      ));
    if (!marked) continue;
    element.setAttribute(DIFF_MARK_ATTRIBUTE, 'edge');
    element.classList.add(DIFF_EDGE_CLASS);
  }
}

/**
 * Everything the keyboard can stand on in the drawing just laid out: its entity
 * boxes (group and stub nodes included, since `[`/`]` and Enter act on whatever
 * is drawn) and the package frames that contain them.
 *
 * Read from the DOM rather than the payload on purpose: the drawing is the
 * visible slice, and a node that the semantic tier hid must not be a keyboard
 * target the reader cannot see.
 */
function collectNavigationItems(host: HTMLElement): EntityNavigationItem[] {
  const items: EntityNavigationItem[] = [];
  for (const element of host.querySelectorAll('.uml-node[data-entity-id]')) {
    const id = element.getAttribute('data-entity-id') ?? '';
    if (id === '' || id.startsWith(STUB_PREFIX)) continue;
    if ((element as SVGElement).style?.display === 'none') continue;
    const rect = navigationRectOf(element);
    if (rect === null) continue;
    const packageId = normalizedPackageId(element.getAttribute('data-package-id'))
      ?? packageIdOfNodeId(id);
    items.push({ id, kind: 'entity', packageId, ...rect });
  }
  for (const element of host.querySelectorAll('.uml-package[data-package-id]')) {
    const packageId = normalizedPackageId(element.getAttribute('data-package-id'));
    if (packageId === null || packageId === '') continue;
    if ((element as SVGElement).style?.display === 'none') continue;
    const rect = navigationRectOf(element);
    if (rect === null) continue;
    items.push({ id: `${PACKAGE_NAV_PREFIX}${packageId}`, kind: 'package', packageId, ...rect });
  }
  return items;
}

/** The drawn element a cursor id names. */
function navigationElementOf(host: HTMLElement, cursorId: string): Element | null {
  if (!cursorId.startsWith(PACKAGE_NAV_PREFIX)) return nodeElement(host, cursorId);
  const packageId = cursorId.slice(PACKAGE_NAV_PREFIX.length);
  for (const frame of host.querySelectorAll('.uml-package[data-package-id]')) {
    if (normalizedPackageId(frame.getAttribute('data-package-id')) === packageId) return frame;
  }
  return null;
}

/**
 * Paint the keyboard cursor: remove the previous ring, mark the new element for
 * `aria-activedescendant`, and draw a 3px ring with a 2px gap around its box —
 * a shape cue, not a colour-only one. The ring is a separate SVG rect so a
 * reader (and the e2e guard) can read its screen rectangle.
 */
function paintNavigationFocus(host: HTMLElement, cursorId: string | null): void {
  for (const ring of host.querySelectorAll('[data-architecture-nav-ring]')) ring.remove();
  for (const marked of host.querySelectorAll(`.${NAV_FOCUS_CLASS}`)) {
    marked.classList.remove(NAV_FOCUS_CLASS);
    marked.removeAttribute('data-architecture-nav-focus');
  }
  if (cursorId === null) return;
  const element = navigationElementOf(host, cursorId);
  if (element === null) return;
  element.id = navigationDomId(cursorId);
  element.classList.add(NAV_FOCUS_CLASS);
  element.setAttribute('data-architecture-nav-focus', 'true');
  const rect = navigationRectOf(element);
  const svg = host.querySelector('svg');
  if (rect === null || svg === null) return;
  const ring = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  ring.setAttribute('data-architecture-nav-ring', 'true');
  // The ring's class is the FOCUS style. It is deliberately not the selection
  // class (`.arch-selected`): focus is an outer, dashed outline, selection is
  // the solid, thicker edge the renderer's own stylesheet paints. A reader can
  // therefore tell "where the keyboard is" from "what is selected" without
  // relying on colour alone.
  ring.setAttribute('class', NAV_RING_CLASS);
  ring.setAttribute('x', String(rect.x - NAV_RING_GAP));
  ring.setAttribute('y', String(rect.y - NAV_RING_GAP));
  ring.setAttribute('width', String(rect.width + NAV_RING_GAP * 2));
  ring.setAttribute('height', String(rect.height + NAV_RING_GAP * 2));
  ring.setAttribute('rx', '4');
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', '#1d4ed8');
  ring.setAttribute('stroke-width', '3');
  // Dashed: the visual half of the focus/selection split above.
  ring.setAttribute('stroke-dasharray', '5 3');
  ring.setAttribute('pointer-events', 'none');
  svg.appendChild(ring);
}

/** Remove every trace of the keyboard cursor from a drawing. */
function clearNavigationFocus(host: HTMLElement): void {
  paintNavigationFocus(host, null);
}

/**
 * The DEV-only lever the keyboard/a11y criterion's control arm pulls. Each
 * value restores one defect the shipped path removes, so the criterion's own
 * reading can be shown going red on the same code the main arm reads green:
 *
 *  · `farthest-start` — start the cursor on the entity FARTHEST from the
 *    viewport centre instead of the nearest one (an arbitrary start);
 *  · `verbose-announce` — restore the old whole-reading announcement
 *    (package name, outgoing/incoming counts) in the live region;
 *  · `keep-ring-on-blur` — keep the keyboard ring painted after the canvas
 *    loses focus.
 *
 * Production builds contain none of these branches.
 */
export type KeyboardA11yDefect = 'farthest-start' | 'verbose-announce' | 'keep-ring-on-blur';

/** The localStorage key the control arm writes. */
export const KEYBOARD_A11Y_STORAGE_KEY = 'architecture-keyboard-a11y';

/** Which defect the DEV lever restores, or `null` for the shipped behaviour. */
export function keyboardA11yDefect(): KeyboardA11yDefect | null {
  if (import.meta.env.DEV) {
    try {
      const stored = window.localStorage.getItem(KEYBOARD_A11Y_STORAGE_KEY);
      return stored === 'farthest-start' || stored === 'verbose-announce' || stored === 'keep-ring-on-blur'
        ? stored
        : null;
    } catch {
      // Private mode: the shipped behaviour applies.
    }
  }
  return null;
}

/** A point in the same space as a navigation item's rectangle. */
export type NavigationPoint = { readonly x: number; readonly y: number };

/**
 * The stable reading order the start tie-break uses: top to bottom, then left
 * to right, with the id last. It is a total order, so two runs over the same
 * rectangles always choose the same entity.
 */
function readingOrderLess(
  left: { readonly x: number; readonly y: number; readonly id: string },
  right: { readonly x: number; readonly y: number; readonly id: string },
): boolean {
  if (left.y !== right.y) return left.y < right.y;
  if (left.x !== right.x) return left.x < right.x;
  return left.id < right.id;
}

/**
 * The entity the keyboard cursor starts on when the canvas receives keyboard
 * focus.
 *
 * Contract:
 *  · the last entity the reader stood on (or the current selection) wins while
 *    it is still drawn — re-entering the canvas does not yank the cursor away;
 *  · otherwise the entity whose centre is NEAREST to `centre` (the viewport
 *    centre, in the same space as the rectangles) is chosen;
 *  · when the drawing has no entity box at all (the folded package map) the
 *    nearest FRAME is the start, so a keyboard user still gets a visible
 *    cursor on a canvas that answered the Tab;
 *  · equal distances are broken by {@link readingOrderLess}, so the choice is
 *    stable for identical input;
 *  · an empty drawing answers `null`.
 *
 * Pure: no DOM, no state. The caller measures the rectangles and the centre.
 */
export function pickNavigationStart(
  items: readonly EntityNavigationItem[],
  preferredId: string | null,
  centre: NavigationPoint,
): string | null {
  const entities = items.filter((item) => item.kind === 'entity');
  // With entities drawn, frames are places (reachable by `[`), never starts.
  const candidates = entities.length > 0 ? entities : [...items];
  if (candidates.length === 0) return null;
  if (preferredId !== null) {
    const preferred = candidates.find((item) => item.id === preferredId);
    if (preferred !== undefined) return preferred.id;
  }
  let best: EntityNavigationItem | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const dx = candidate.x + candidate.width / 2 - centre.x;
    const dy = candidate.y + candidate.height / 2 - centre.y;
    const distance = Math.hypot(dx, dy);
    if (
      best === null
      || distance < bestDistance
      || (distance === bestDistance && readingOrderLess(candidate, best))
    ) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best?.id ?? null;
}

/** The control arm's arbitrary start: the entity farthest from the centre. */
function farthestNavigationStart(
  items: readonly EntityNavigationItem[],
  centre: NavigationPoint,
): string | null {
  let best: EntityNavigationItem | null = null;
  let bestDistance = -1;
  for (const entity of items) {
    if (entity.kind !== 'entity') continue;
    const dx = entity.x + entity.width / 2 - centre.x;
    const dy = entity.y + entity.height / 2 - centre.y;
    const distance = Math.hypot(dx, dy);
    if (best === null || distance > bestDistance) {
      best = entity;
      bestDistance = distance;
    }
  }
  return best?.id ?? null;
}

/**
 * The renderer-local budget hints are accepted (the contract carries them) but
 * deliberately unused: the overview/group/neighbourhood views below derive what
 * is visible from the graph itself, which is this renderer's replacement for
 * the old maxHops/maxNodes truncation.
 */
type PlantUmlGraphProps = ArchitectureRendererProps & {
  /**
   * A node the panel asked this renderer to reveal (a search hit, or a match
   * that was outside the current detail range). The renderer centres the drawn
   * box on it and selects it. It does NOT change the view unless `focusDrill`
   * is set: the interaction review found that pressing Enter in the search box
   * replaced the whole drawing with the entity's neighbourhood, losing the
   * context the reader was searching in.
   */
  readonly focusNodeId?: string | null;
  /** Bumped on every request, so asking for the same node twice re-centres it. */
  readonly focusToken?: number;
  /**
   * Whether this focus request also opens the node's neighbourhood. Only the
   * explicit "view neighbourhood" command (Shift+Enter, or the result row's
   * secondary button) sets it.
   */
  readonly focusDrill?: boolean;
  /**
   * Reports the view currently drawn (overview/group/neighbourhood/hierarchy)
   * so the panel's export menu can rebuild the document that is on screen.
   * Optional: a renderer embedded without a panel has no menu to feed.
   */
  readonly onViewChange?: (view: ArchitectureDiagramView) => void;
  /**
   * Manual curation. Optional as a group so a renderer embedded without a
   * curation store keeps drawing exactly as before (no menu, no key handling).
   */
  readonly canCurate?: boolean;
  readonly pinnedNodeIds?: readonly string[];
  readonly onPinNode?: (node: ArchitectureRendererNode) => void;
  readonly onUnpinNode?: (node: ArchitectureRendererNode) => void;
  readonly onRemoveNode?: (node: ArchitectureRendererNode) => void;
  readonly onHideRelation?: (edge: ArchitectureRendererEdge) => void;
  /** "Only show this pinned item": the panel narrows the drawing to one node. */
  readonly onSoloNode?: (node: ArchitectureRendererNode) => void;
  /**
   * The context menu's "Put in chat input": the panel composes the message.
   * Optional so a renderer embedded without a chat keeps drawing as before.
   */
  readonly onPutNodeInChat?: (node: ArchitectureRendererNode) => void;
  /** Ctrl/Cmd+Z while the canvas is focused: undo the latest adjustment. */
  readonly onUndo?: () => void;
  /**
   * Additive click: Shift/Ctrl/Cmd on a fine pointer, or any tap while the touch
   * multi-select mode is on. The panel toggles that member of the set; without
   * this callback the click keeps the contract's replace semantics.
   */
  readonly onToggleNodeClick?: (node: ArchitectureRendererNode) => void;
  readonly onToggleEdgeClick?: (edge: ArchitectureRendererEdge) => void;
  /**
   * The whole selection set, used to style every member. The contract's
   * `selectedNodeId`/`selectedRelation` stay the primary reading, so a renderer
   * embedded without the panel keeps exactly its old props.
   */
  readonly selectedNodeIds?: readonly string[];
  readonly selectedRelations?: readonly {
    readonly from: string;
    readonly to: string;
    readonly relationType: string;
  }[];
  /** Whether the touch multi-select mode is on (taps become toggles). */
  readonly multiSelectMode?: boolean;
  /**
   * A 500ms press on an entity on a coarse pointer. The panel turns multi-select
   * mode on and adds that node; a press anywhere else keeps the curation menu.
   */
  readonly onMultiSelectStart?: (node: ArchitectureRendererNode) => void;
  /**
   * Shift+drag marquee result (the drawn entities and relations the rectangle
   * hit). Absent keeps the canvas's old pan-only drag, which is what a renderer
   * embedded without a tray wants.
   */
  readonly onBoxSelect?: (selections: readonly ArchitectureSelection[]) => void;
  /**
   * The project whose graph is drawn. Retained for embedders that still pass
   * it; the readable-mode choice it used to key is retired, so nothing reads it.
   */
  readonly projectId?: string | null;
  /**
   * How many pixels at the bottom of the canvas are covered by chrome drawn
   * OVER it (the coarse tier's inspector drawer). The drawing reserves that
   * band — so a fitted drawing is centred above the drawer instead of behind
   * it — and a selected box is scrolled clear of it. 0 everywhere else.
   */
  readonly bottomObscuredPx?: number;
  /**
   * Whether the panel is currently the page-internal fullscreen overlay (not
   * the standalone page, whose Fit must keep the ordinary readings).
   *
   * On the overlay the host IS the viewport, so Fit's available area is the
   * host less the measured chrome painted over it — the non-fullscreen
   * reserved margin (the host's own padding) must not be carried over.
   */
  readonly fullscreen?: boolean;
};

/**
 * The pixel the overlay's Fit leaves for the semantic writer's `Math.ceil`.
 * See `fullscreenFitBox` — it is rounding allowance, not a reserved margin.
 */
const FULLSCREEN_FIT_ROUNDING_ALLOWANCE_PX = 1;

/**
 * The DEV-only lever the e2e control arm pulls to re-create the retired
 * fit-time CSS factor. It makes every semantic Fit multiply the semantic scale
 * by a factor the same way the shipped defect did, so the arm can prove its
 * min-font reading lands on the failing side. DEV-gated like the other levers:
 * a production build does not contain this branch.
 */
const FIT_CSS_FACTOR_STORAGE_KEY = 'architecture-fit-css-factor';

/** The control-arm CSS factor, or `null` when the shipped path runs. */
function forcedFitCssFactor(): number | null {
  if (import.meta.env.DEV) {
    try {
      const stored = window.localStorage.getItem(FIT_CSS_FACTOR_STORAGE_KEY);
      if (stored === null) return null;
      const value = Number.parseFloat(stored);
      return Number.isFinite(value) && value > 0 && value < 1 ? value : null;
    } catch {
      // Private mode: the shipped path applies.
    }
  }
  return null;
}

/**
 * The DEV-only lever that restores the retired "unreadable fit opens focused"
 * rule: the drawing opens at the readable floor instead of the solved fit, the
 * state the control arm measures as overflow on the Quay fixture.
 */
const DEFAULT_FOCUS_STORAGE_KEY = 'architecture-default-focus';

/** Whether this build's control arm asked for the retired focus default. */
function forcedDefaultFocus(): boolean {
  if (import.meta.env.DEV) {
    try {
      return window.localStorage.getItem(DEFAULT_FOCUS_STORAGE_KEY) === 'on';
    } catch {
      // Private mode: the shipped path applies.
    }
  }
  return false;
}

/**
 * The DEV-only lever that suppresses the `auto` re-solve, so the control arm can
 * prove the resize criterion goes red when the ResizeObserver path is off.
 */
const AUTO_FIT_STORAGE_KEY = 'architecture-auto-fit';

/** Whether this build's control arm disabled auto refit. */
function autoFitDisabled(): boolean {
  if (import.meta.env.DEV) {
    try {
      return window.localStorage.getItem(AUTO_FIT_STORAGE_KEY) === 'off';
    } catch {
      // Private mode: auto refit stays on.
    }
  }
  return false;
}

/**
 * The DEV-only lever the fullscreen-fit criterion's control arm pulls: it
 * restores the retired rule that Fit kept using the NON-fullscreen canvas
 * (the `flex-1` region it came from) after the overlay made the host the whole
 * viewport. That is the defect the fullscreen fit exists to remove — the L
 * drawing was measured at 788×480 in a 1440×765 overlay. DEV-gated like the
 * other levers: a production build does not contain this branch.
 */
const FULLSCREEN_FIT_MARGIN_STORAGE_KEY = 'architecture-fullscreen-fit-margins';

/** Whether this build's control arm asked for the retired reserved margins. */
function forcedFullscreenReservedMargins(): boolean {
  if (import.meta.env.DEV) {
    try {
      return window.localStorage.getItem(FULLSCREEN_FIT_MARGIN_STORAGE_KEY) === 'reserved';
    } catch {
      // Private mode: the measured overlay area applies.
    }
  }
  return false;
}

/**
 * Renders one architecture neighbourhood as a lazily loaded PlantUML/ELK
 * layered diagram.
 *
 * Used by ArchitecturePanel. THREE views replace the old maxHops/maxNodes
 * truncation, and all of them slice the payload already in hand:
 *  · overview — the whole graph folded into path groups (`groupByPathPrefix`);
 *  · group — clicking an overview group expands just that group;
 *  · neighbourhood — clicking an entity drills into it, and clicking the
 *    centred entity again adds one hop.
 * Hovering a node highlights its in/out edges and dims the rest; clicking an
 * entity pins that highlight and announces the entity with its JSON in/out
 * neighbours on `architecture:entity-selected`, while a sibling panel can ask
 * for one by id through `architecture:highlight-entity`. Every view is local:
 * nothing here re-enters the fetch. The renderer package is imported
 * dynamically, so elkjs never enters the first-screen bundle.
 */
export function PlantUmlGraph({
  graph,
  idShape = DEFAULT_NODE_ID_SHAPE,
  diffHighlight = null,
  detailReading,
  onNodeClick,
  onEdgeClick,
  onSelectionClear,
  onNodeHover,
  onEscapeSelection,
  selectedNodeId = null,
  selectedRelation = null,
  relayoutLocked = false,
  fitRequest = null,
  onZoomModeChange,
  onExport,
  onDrawnPlantUmlChange,
  focusNodeId = null,
  focusToken,
  focusDrill = false,
  onViewChange,
  canCurate = false,
  pinnedNodeIds = [],
  onPinNode,
  onUnpinNode,
  onRemoveNode,
  onHideRelation,
  onSoloNode,
  onPutNodeInChat,
  onUndo,
  onToggleNodeClick,
  onToggleEdgeClick,
  selectedNodeIds,
  selectedRelations,
  multiSelectMode = false,
  onMultiSelectStart,
  onBoxSelect,
  bottomObscuredPx = 0,
  topObscuredPx = 0,
  fullscreen = false,
}: PlantUmlGraphProps) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The structural diff to mark on the NEXT drawing; a repaint reads this ref.
  const diffHighlightRef = useRef<ArchitectureDiffHighlight | null>(diffHighlight);
  // The pointer/size tier: coarse pointers get 44px hit areas, narrow screens
  // collect the toolbar into one overflow menu (see `useTouchLayout`).
  const {
    touchUi,
    coarsePointer,
    compactToolbar,
    portraitControlsOverlay,
    portraitPhone,
    shortTouch,
  } = useTouchLayout();
  // The semantic layout runs from imperative callbacks; the pointer tier that
  // picks the minimum font size is read from the gesture owner at call time
  // (`isCoarsePointer()`), which is what the mirrored ref used to provide.
  // On the compact tier the panel owns the single toolbar row and lends its
  // overflow menu as the slot these controls are drawn into; `null` (menu shut)
  // means this renderer has no chrome on screen at all.
  const compactToolbarSlot = useCompactToolbarSlot();
  const touchTargetStyle = touchUi ? TOUCH_TARGET_STYLE : undefined;
  // Which slice of the payload is drawn. Local by construction: the payload is
  // fetched whole, so switching views must never re-request it. The class view
  // starts on the whole hierarchy (entities in package frames); the file view
  // starts on the directory-grouped overview.
  const entityGraph = isEntityGraph(idShape);
  const [view, setView] = useState<ArchitectureDiagramView>(() => defaultViewOf(idShape));
  // What the last render actually drew; drives the visible-count readout and
  // lets a test tell a stale SVG from the new view's SVG.
  const [drawn, setDrawn] = useState<{ view: ArchitectureDiagramView; nodes: number; edges: number } | null>(null);
  // A failed render is shown instead of the previous (now stale) diagram.
  const [failure, setFailure] = useState<string | null>(null);
  // How long the drawing on screen took to lay out and render, in ms. Exposed
  // as `data-architecture-layout-ms` for the DoD's readings; deliberately not
  // shown as UI text (a number the reader cannot act on is noise).
  const [layoutMs, setLayoutMs] = useState<number | null>(null);
  // Read inside the delegated DOM listeners without re-registering them: the
  // listeners are registered once per mount, while these values change as the
  // parent re-renders (hover key, graph swap).
  const viewRef = useRef(view);
  const graphRef = useRef(graph);
  // Gestures are ONE owned slice. The ten callback slots this component used to
  // mirror into refs are now a single `setHandlers` write path, and the marquee
  // rectangle, the Shift reading, the touch multi-select mode and the one-click
  // suppression live in the controller (see `graphGestureController.ts`). Its
  // DOM measurements are injected so the rules are testable without React.
  const gestureController = useMemo(() => createGraphGestureController({
    canvasOrigin: () => {
      const rect = hostRef.current?.parentElement?.getBoundingClientRect();
      return { left: rect?.left ?? 0, top: rect?.top ?? 0 };
    },
    boxHitTest: (box) => {
      const host = hostRef.current;
      return host === null ? [] : selectionsIntersectingBox(boxCandidates(host), box);
    },
    nodeHitTest: (clientX, clientY) => {
      const host = hostRef.current;
      return host === null ? null : nearestNodeHitId(host, clientX, clientY);
    },
  }), []);
  const gestureSnapshot = useSyncExternalStore(
    gestureController.subscribe,
    gestureController.getSnapshot,
    gestureController.getSnapshot,
  );
  // Selection and keyboard navigation are ONE owned slice. Every reading the
  // delegated listeners, the async draw and the render need lives in the
  // controller (see `graphSelectionController.ts`); this component renders its
  // snapshot and forwards events. The controller is created once per mount:
  // listeners read `getSnapshot()` at fire time, which is what the mirrored
  // refs used to provide.
  const selectionController = useMemo(() => createGraphSelectionController(), []);
  const selectionSnapshot = useSyncExternalStore(
    selectionController.subscribe,
    selectionController.getSnapshot,
    selectionController.getSnapshot,
  );
  /** Leave the navigation state; the selection and the drawing stay unchanged. */
  const exitEntityNavigation = (host: HTMLElement): void => {
    selectionController.exitNavigation();
    clearNavigationFocus(host);
  };
  const pinnedSet = useMemo(() => new Set(pinnedNodeIds), [pinnedNodeIds]);
  useEffect(() => {
    viewRef.current = view;
    graphRef.current = graph;
    diffHighlightRef.current = diffHighlight;
  }, [view, graph, selectedNodeId, selectedRelation, selectedNodeIds, selectedRelations, diffHighlight]);
  // The one write path that hands the gesture owner the current props: its
  // callbacks, the touch multi-select mode and the pointer tier. Listeners read
  // `getHandlers()` at fire time instead of each mirroring a ref.
  useEffect(() => {
    gestureController.setHandlers({
      onNodeHover,
      onNodeClick,
      onEdgeClick,
      onSelectionClear,
      onEscapeSelection,
      onToggleNodeClick,
      onToggleEdgeClick,
      onMultiSelectStart,
      onBoxSelect,
      onDrawnChange: onDrawnPlantUmlChange,
    });
    gestureController.setMultiSelectMode(multiSelectMode);
    gestureController.setCoarsePointer(coarsePointer);
  }, [gestureController, coarsePointer, multiSelectMode, onNodeHover, onNodeClick, onEdgeClick, onSelectionClear, onEscapeSelection, onDrawnPlantUmlChange, onToggleNodeClick, onToggleEdgeClick, onMultiSelectStart, onBoxSelect]);

  /**
   * Paint the panel's selection AND publish it as a `data-*` state. The class
   * (`.arch-selected`) is the style; the attribute is the state the keyboard
   * focus reading (`data-architecture-nav-focus`) is distinguishable from — a
   * different class AND a different data attribute for each.
   */
  const paintSelectionStyles = (
    host: HTMLElement,
    nodeIds: readonly string[],
    relations: readonly { readonly from: string; readonly to: string }[],
  ): void => {
    applySelectionStyles(host, nodeIds, relations);
    for (const marked of host.querySelectorAll('[data-architecture-selected]')) {
      marked.removeAttribute('data-architecture-selected');
    }
    for (const selected of host.querySelectorAll('.arch-selected')) {
      selected.setAttribute('data-architecture-selected', 'true');
    }
  };

  // Repaint the selection whenever the panel changes it. The draw effect below
  // applies the same styles to a fresh SVG; this one covers a selection made
  // without a re-layout. The whole set is styled; `selectedNodeId` stays the
  // primary reading the pinned highlight and Delete follow.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const nodeIds = selectedNodeIds ?? (selectedNodeId === null ? [] : [selectedNodeId]);
    const relationList = selectedRelations ?? (selectedRelation === null ? [] : [selectedRelation]);
    selectionController.syncPanelSelection({
      nodeId: selectedNodeId,
      relation: selectedRelation,
      nodeIds,
      relations: relationList,
    });
    paintSelectionStyles(host, nodeIds, relationList);
    if (selectedNodeId !== null) highlightSelection(host, selectedNodeId);
    else if (relationList.length === 0) clearHighlight(host);
  }, [selectedNodeId, selectedRelation, selectedNodeIds, selectedRelations, selectionController]);

  // Tell the panel which slice is on screen. The export menu rebuilds exactly
  // this view; a remount (session/scope change resets `view`) reports the
  // overview again, so the panel never exports a stale drill-down.
  useEffect(() => {
    onViewChange?.(view);
  }, [onViewChange, view]);

  // Zoom, the SVG viewport and the auto-fit rules are ONE owned slice (see
  // `graphViewportController.ts`). This component renders the snapshot and
  // forwards the host's measurements; the owner decides when a resize re-fits,
  // which scale survives a manual zoom, and how a Fit token is answered.
  const viewportController = useMemo(() => createGraphViewportController({
    autoFitDisabled,
  }), []);
  const viewportSnapshot = useSyncExternalStore(
    viewportController.subscribe,
    viewportController.getSnapshot,
    viewportController.getSnapshot,
  );
  const {
    zoom,
    packageFocus,
    fullscreenInsets,
    fitViewport: fitViewportReading,
  } = viewportSnapshot;
  // The semantic tier, the aspect debounce, the orientation cache and the
  // relayout lock are ONE owned slice (see `graphLayoutPipeline.ts`): this
  // component renders its snapshot and supplies the two DOM-bound actions
  // (solve, and write the solved layout) it cannot do itself.
  const layoutPipeline = useMemo(() => createGraphLayoutPipeline(), []);
  const layoutSnapshot = useSyncExternalStore(
    layoutPipeline.subscribe,
    layoutPipeline.getSnapshot,
    layoutPipeline.getSnapshot,
  );
  useEffect(() => () => layoutPipeline.dispose(), [layoutPipeline]);
  // At the package-only tiers the drawing is a map of frames, not selectable
  // entities: clicks zoom into a package and coarse hit rectangles are unused.
  const packageOnlyTier = useCallback(
    (): boolean => {
      const tier = layoutPipeline.getSnapshot().semanticTier;
      return tier === 'C' || tier === 'D';
    },
    [layoutPipeline],
  );
  /**
   * The drawing's ORIGINAL size for every fit computation.
   *
   * Semantic zoom rewrites the SVG's width/height to the mapped layout's size,
   * so `readSvgNaturalSize` would feed the fit a size that already contains the
   * zoom and the stretch — a feedback loop. The controller keeps the base size
   * the engine was built from; the ordinary scaled mode has none and reads the
   * element as before.
   */
  const naturalOfDrawing = useCallback((drawing: SVGSVGElement | null): SvgViewportSize | null => {
    // The folded tier is the exception the rule above does not cover: its
    // packed drawing is NOT the original geometry times a scale (`x`/`y` are
    // identity maps), so measuring a fit against the original bounds would ask
    // for a scale of a fraction of a percent and then render the fold at 1:1
    // anyway. Here the drawing on screen IS its own natural size.
    const folded = layoutPipeline.getSnapshot().appliedLayout;
    if (folded !== null && folded.foldDepth !== null) {
      return { width: Math.max(1, folded.content.width), height: Math.max(1, folded.content.height) };
    }
    const semanticBase = viewportController.viewport()?.semanticBaseSize() ?? null;
    if (semanticBase !== null) return semanticBase;
    return drawing === null ? null : readSvgNaturalSize(drawing);
  }, [layoutPipeline, viewportController]);
  /** The one write path for a scale solved by Fit, the semantic engine or a gesture. */
  const applyZoom = useCallback((next: GraphZoom): boolean => viewportController.setZoom(next), [viewportController]);
  /** The owner's reading at call time; async handlers run outside the last render. */
  const controllerZoom = useCallback(
    (): GraphZoom => viewportController.getSnapshot().zoom,
    [viewportController],
  );

  // The package the reader zoomed into from the too-small overview hint (the
  // "tap a package" gesture) lives in the viewport owner's snapshot with the
  // zoom; it keeps the hint row visible and gives that row its action.


  /** The viewBox origin of the drawing on screen, in user units (usually 0,0). */
  const drawingOrigin = useCallback((): { x: number; y: number } => {    const parts = (hostRef.current?.querySelector('svg')?.getAttribute('viewBox') ?? '')
      .trim().split(/[\s,]+/).map(Number);
    return parts.length === 4 && parts.every(Number.isFinite)
      ? { x: parts[0], y: parts[1] }
      : { x: 0, y: 0 };
  }, []);

  // The panel's chrome-row cell this renderer draws the zoom tier into, or null
  // when the renderer is not inside a panel (see `CanvasHeaderSlotContext`).
  const canvasHeaderSlot = useCanvasHeaderSlot();

  // The overlay's measured insets and the box the last Fit solved against are
  // part of the viewport owner's snapshot: the host padding is render output,
  // and `data-architecture-fit-viewport` must state the area the solve used.

  /**
   * The chrome rectangles the overlay paints OVER its viewport-sized host, in
   * the host's border-box coordinates.
   *
   * Measured, never assumed: the toolbar/readout band comes from the panel's
   * own measurement (`topObscuredPx`), the drawer band from
   * `bottomObscuredPx`, and the floating corner slot / selection tray from
   * their live `getBoundingClientRect`. An unlaid-out element (jsdom, a hidden
   * tab) reports a zero-area rect and is dropped, so "not measured" can never
   * read as "covers everything".
   */
  const fullscreenOverlays = useCallback((): FitOverlayRect[] => {
    const host = hostRef.current;
    if (host === null) return [];
    const hostRect = host.getBoundingClientRect();
    const originLeft = hostRect.left + host.clientLeft;
    const originTop = hostRect.top + host.clientTop;
    // The SAME reading the solve uses (`measureHostSize`): the client box when
    // the browser has laid it out, else the rect. Using `clientWidth` directly
    // here would build a zero-wide top band in a host that only reports a rect
    // (jsdom), and `solveFitArea` drops zero-area overlays — the chrome would
    // silently vanish from the deduction.
    const hostSize = measureHostSize(host);
    const width = hostSize?.width ?? 0;
    const height = hostSize?.height ?? 0;
    const rects: FitOverlayRect[] = [];
    if (topObscuredPx > 0) {
      rects.push({ left: 0, top: 0, width, height: Math.min(height, topObscuredPx) });
    }
    if (bottomObscuredPx > 0) {
      rects.push({
        left: 0,
        top: Math.max(0, height - bottomObscuredPx),
        width,
        height: Math.min(height, bottomObscuredPx),
      });
    }
    const canvas = host.parentElement;
    if (canvas !== null) {
      // The panel's provenance footer stays in flow at the bottom of the
      // viewport-sized overlay, so it covers the canvas' bottom band unless it
      // is measured here too (the short landscape tier has none).
      const panel = host.closest('[data-architecture-panel]');
      const elements = [
        ...canvas.querySelectorAll('[data-architecture-canvas-overlays] > *'),
        // The tray ROOT is a `pointer-events: none` container covering the
        // whole canvas; only its visible surfaces (the collapsed pill, the
        // expanded panel, the multi-select bar) are chrome.
        ...canvas.querySelectorAll(
          '[data-architecture-tray-pill], [data-architecture-tray-expanded-panel], '
            + '[data-architecture-multiselect-bar]',
        ),
        ...(panel === null
          ? []
          : [
              ...panel.querySelectorAll('[data-architecture-source-footer]'),
              // On the overlay the fine-pointer Inspector is a floating
              // right-hand column (`absolute inset-y-0 right-0`), not an
              // in-flow dock; it covers the drawing exactly like the corner
              // slot does.
              ...panel.querySelectorAll('[data-architecture-fullscreen-dock]'),
            ]),
      ];
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        rects.push({
          left: rect.left - originLeft,
          top: rect.top - originTop,
          width: rect.width,
          height: rect.height,
        });
      }
    }
    return rects;
  }, [topObscuredPx, bottomObscuredPx]);

  /**
   * The overlay's measured Fit area: the host less its measured chrome. The
   * control-arm lever restores the retired non-fullscreen box instead, so the
   * same reading can be shown landing on its failing side.
   */
  const fullscreenFitArea = useCallback((): FitAreaRect | null => {
    const host = hostRef.current;
    if (host === null) return null;
    const hostSize = measureHostSize(host);
    if (hostSize === null) return null;
    return solveFitArea(hostSize, fullscreenOverlays());
  }, [fullscreenOverlays]);

  /**
   * The box the overlay's Fit solves against.
   *
   * One pixel smaller than the measured area: the semantic writer rounds the
   * mapped extent UP to the next CSS pixel (`Math.ceil`), and the solve itself
   * allows half a pixel of float slack, so a drawing solved exactly to the area
   * can paint one pixel over its edge — under the corner slot. The allowance is
   * not a margin: the published `data-architecture-fit-viewport` states this
   * solve box (one pixel inside the measured area), which is what the criterion
   * compares against.
   */
  const fullscreenFitBox = useCallback((): SvgViewportSize | null => {
    const host = hostRef.current;
    if (host === null) return null;
    if (forcedFullscreenReservedMargins()) return viewportController.lastFlowViewport() ?? measureHostSize(host);
    const area = fullscreenFitArea();
    if (area === null) return null;
    return {
      width: Math.max(1, area.width - FULLSCREEN_FIT_ROUNDING_ALLOWANCE_PX),
      height: Math.max(1, area.height - FULLSCREEN_FIT_ROUNDING_ALLOWANCE_PX),
    };
  }, [fullscreenFitArea, viewportController]);

  /** The reading every Fit/fold/sticky solve measures against. */
  const currentFitViewport = useCallback((host: HTMLElement): SvgViewportSize | null => {
    if (fullscreen) {
      const box = fullscreenFitBox();
      if (box !== null) return box;
    }
    return measureViewportSize(host);
  }, [fullscreen, fullscreenFitBox]);

  /** Publish the box the solve used; the owner ignores an unchanged reading. */
  const recordFitViewport = useCallback((box: SvgViewportSize | null): void => {
    viewportController.reportFitViewport(box);
  }, [viewportController]);

  /**
   * The floating corner chrome rectangles — the minimap and the zoom cluster —
   * in the canvas content box's coordinates (the box `measureViewportSize`
   * returns: host border box minus its padding). An unlaid-out element (jsdom,
   * a hidden tab) reports a zero-area box and is dropped, so a missing
   * measurement can never be read as "the chrome covers everything".
   */
  const cornerRects = useCallback((): SvgCornerRect[] => {
    const host = hostRef.current;
    const canvas = host?.parentElement ?? null;
    const overlays = canvas?.querySelector<HTMLElement>('[data-architecture-canvas-overlays]') ?? null;
    if (host === null || overlays === null) return [];
    const hostRect = host.getBoundingClientRect();
    const style = typeof getComputedStyle === 'function' ? getComputedStyle(host) : null;
    const paddingLeft = Number.parseFloat(style?.paddingLeft ?? '') || 0;
    const paddingTop = Number.parseFloat(style?.paddingTop ?? '') || 0;
    const originLeft = hostRect.left + paddingLeft;
    const originTop = hostRect.top + paddingTop;
    const rects: SvgCornerRect[] = [];
    for (const child of overlays.children) {
      const rect = child.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      rects.push({
        left: rect.left - originLeft,
        top: rect.top - originTop,
        width: rect.width,
        height: rect.height,
      });
    }
    return rects;
  }, []);

  /**
   * The whole-graph fit placement for a CSS-scaled (non-semantic) drawing: the
   * geometric fit, moved off-centre when the floating corner chrome would
   * otherwise cover it. The semantic path never uses a CSS factor, so this is
   * only consulted when no semantic capture exists.
   */
  const fitPlacementFor = useCallback(
    (natural: SvgViewportSize, box: SvgViewportSize): SvgFitPlacement =>
      fitPlacementAvoidingCorners(natural, box, cornerRects(), MIN_ZOOM_SCALE),
    [cornerRects],
  );

  /**
   * Apply a fit placement to the drawing through its own margins. The host is a
   * flex column with `align-items: flex-start`; an explicit left/top margin
   * pins the drawing at the placement's offset, while `margin-bottom: auto`
   * keeps it from being stretched. `null` restores the stylesheet's centring.
   */
  const applyPlacement = useCallback((drawing: SVGSVGElement | null, placement: SvgFitPlacement | null): void => {
    if (drawing === null) return;
    if (placement === null) {
      drawing.style.marginLeft = 'auto';
      drawing.style.marginRight = 'auto';
      drawing.style.marginTop = 'auto';
      drawing.style.marginBottom = 'auto';
      return;
    }
    drawing.style.marginLeft = placement.offsetX > 0 ? `${placement.offsetX}px` : '0';
    drawing.style.marginRight = 'auto';
    drawing.style.marginTop = placement.offsetY > 0 ? `${placement.offsetY}px` : '0';
    drawing.style.marginBottom = 'auto';
  }, []);

  /**
   * Zoom the viewport onto one drawn package frame and centre it.
   *
   * Occurrences: the overview hint's "tap a package" gesture while the whole
   * graph is too small to read. The target scale is the one that makes the
   * frame fill most of the content box, lifted to the readable floor so the
   * gesture always lands on text a reader can use; the offsets come from the
   * drawing's own user units, so the frame is centred without waiting for a
   * layout pass. A package the drawing has no frame for is a no-op.
   */
  const zoomToPackage = useCallback((packageId: string): void => {
    const host = hostRef.current;
    const viewport = viewportController.viewport();
    if (host === null || viewport === null) return;
    const frame = drawnPackageFrame(host, packageId);
    const box = measureViewportSize(host);
    if (frame === null || box === null) return;
    const multiplier = Math.min(
      (box.width * 0.9) / frame.width,
      (box.height * 0.9) / frame.height,
    );
    if (layoutPipeline.getSnapshot().semanticCapture !== null) {
      // The frame's attributes are already in the CURRENT map's screen units,
      // so the multiplier is relative to the scale on screen. The new scale is
      // solved by the same engine as Fit (its floor-font rule keeps every label
      // readable), and the geometry is rewritten now rather than 200 ms later.
      const current = layoutPipeline.getSnapshot().appliedLayout?.scale ?? controllerZoom().scale;
      const solved = clampZoomScale(Math.max(current * multiplier, MIN_ZOOM_SCALE));
      applyZoom({ scale: solved, fit: 'manual' });
      layoutPipeline.requestPackageCenter(packageId);
      layoutPipeline.applySemantic({ fit: false, scale: solved });
      viewportController.setPackageFocus(packageId);
      return;
    }
    const scale = clampZoomScale(Math.max(multiplier, MIN_READABLE_ZOOM_SCALE));
    const applied = viewport.zoomTo(scale);
    applyZoom({ scale: applied, fit: 'manual' });
    // The fit placement pins explicit margins; a zoomed package is centred by
    // the scroll offsets below instead, so hand the drawing back to `auto`.
    applyPlacement(host.querySelector('svg'), null);
    const origin = drawingOrigin();
    const offsets = centeredScrollForDrawingRect(box, {
      left: frame.x - origin.x,
      top: frame.y - origin.y,
      width: frame.width,
      height: frame.height,
    }, applied);
    host.scrollLeft = offsets.left;
    host.scrollTop = offsets.top;
    viewportController.setPackageFocus(packageId);
  }, [applyPlacement, applyZoom, controllerZoom, drawingOrigin, viewportController]);

  // Set when a drawing was too wide for its container and was collapsed to the
  // directory overview; the notice stays until the user asks for the explosion
  // view again.
  const [collapsedNotice, setCollapsedNotice] = useState(false);

  /**
   * The navigation command, kept separate from the gesture that triggers it:
   * a desktop click runs it immediately, while a touch tap selects first and
   * reaches it through a double-tap or the "Drill in" button.
   */
  const drillInto = useCallback((id: string): void => {
    if (id.startsWith(STUB_PREFIX)) return;
    if (id.startsWith(GROUP_PREFIX)) {
      setView({ kind: 'group', prefix: id.slice(GROUP_PREFIX.length) });
      return;
    }
    const current = viewRef.current;
    const hops = current.kind === 'neighborhood' && current.entityId === id
      ? current.hops + 1
      : DEFAULT_NEIGHBORHOOD_HOPS;
    setView({ kind: 'neighborhood', entityId: id, hops });
  }, []);

  const drillSelected = useCallback((): void => {
    const id = selectionController.getSnapshot().primaryNodeId;
    if (id !== null) drillInto(id);
  }, [drillInto]);

  /**
   * A panel-level focus request (a search hit / an inspector "centre" action).
   * It selects the named node and centres it — the drawing stays on the view
   * the reader was working in, so the context a search was asked from survives.
   * Only an explicit `focusDrill` (Shift+Enter / "View neighbourhood") opens the
   * node's own neighbourhood. Keyed by `focusToken` so choosing the same node
   * twice re-centres it.
   */
  useEffect(() => {
    if (focusNodeId === null) return;
    selectionController.focusNode(focusNodeId);
    if (focusDrill) setView({ kind: 'neighborhood', entityId: focusNodeId, hops: DEFAULT_NEIGHBORHOOD_HOPS });
  }, [focusNodeId, focusToken, focusDrill, selectionController]);

  // Switching the class/file subgraph is a new drawing, so a drill-down state
  // from the previous one must not be carried over: a neighbourhood opened in
  // the class diagram used to reappear after switching to the file graph and
  // back. The default view is the discriminator (hierarchy vs. overview).
  useEffect(() => {
    if (!layoutPipeline.observeIdShape(idShape)) return;
    setView(defaultViewOf(idShape));
  }, [idShape, layoutPipeline]);

  // Repaint the structural diff whenever the panel hands a new set in, and after every draw:
  // the two subgraphs (and the drill-down views) each rewrite the SVG, and a marker applied to
  // the previous drawing is gone with it.
  useEffect(() => {
    diffHighlightRef.current = diffHighlight;
    const host = hostRef.current;
    if (host !== null) applyDiffStyles(host, diffHighlight);
  }, [diffHighlight, layoutSnapshot.drawnRevision]);

  /**
   * Write one semantic layout onto the captured drawing, INCLUDING the folded
   * tier's omissions.
   *
   * The scale is the drawing's ONLY scale: `drawSemanticLayout` bakes the
   * engine's map into the geometry and sizes the SVG to the mapped content, so
   * the element is shown 1:1 (`k = 1`). No CSS factor is ever applied on top —
   * the retired Fit path multiplied the already-mapped drawing by
   * `min(1, canvas ÷ content)`, which is what made a 17 % map print 74 % and
   * push 10 px floor text down to 7.4 px.
   *
   * `drawSemanticLayout` also hands the folded tier the drawings it owns (it
   * drops whole sub-packages and every relation); those consequences live here
   * rather than in the DOM writer because they are the CALLER's view of the
   * layout.
   */
  const applySemanticLayout = useCallback((
    host: HTMLElement,
    capture: SemanticCapture,
    layout: SemanticZoomLayout,
    fontPx: number,
  ): void => {
    drawSemanticLayout(host, capture, layout, fontPx);
    // The rewritten drawing rebuilds every node group's children, so the
    // coarse-pointer hit rectangles are laid down again on the geometry that is
    // actually on screen (they are not part of `capture.inner`, which stays the
    // undecorated snapshot).
    addNodeHitTargets(host, gestureController.isCoarsePointer());
    // The renderer's own `.uml-canvas` rectangle is a paper-coloured fill sized
    // to the mapped CONTENT. Once the geometry pass reshapes the drawing, that
    // leaves a white rectangle around the content with the panel's own
    // background showing outside it — the seam the review found on both
    // viewports. The rectangle is made transparent, so the canvas background IS
    // the panel's background; no second colour is painted anywhere.
    for (const canvasRect of host.querySelectorAll<SVGRectElement>('svg .uml-canvas')) {
      canvasRect.setAttribute('fill', 'none');
    }
    if (layout.foldDepth !== null) {
      const drawnPackages = new Set(layout.packages.map((entry) => entry.id));
      for (const group of host.querySelectorAll('.uml-package[data-package-id]')) {
        if (!drawnPackages.has(group.getAttribute('data-package-id') ?? '')) {
          (group as SVGGElement).style.display = 'none';
        }
      }
      // The folded tier draws packages only: the entity relations were mapped
      // for a geometry that no longer exists.
      for (const group of host.querySelectorAll('.uml-edge[data-edge-source]')) {
        (group as SVGGElement).style.display = 'none';
      }
    }
    // The DEV-only control-arm lever. Production builds do not contain this
    // branch; when an arm asks for it, the retired CSS factor is re-applied so
    // the arm can prove its min-font reading lands on the failing side.
    const controlFactor = forcedFitCssFactor();
    if (controlFactor !== null) applyZoomScale(capture.svg, controlFactor);
  }, [gestureController]);

  /**
   * Write a layout the pipeline solved onto the drawing, in the same order as
   * the old inline application: geometry first, then the viewport scale, then
   * the DOM readings that depend on the rewritten elements, and the sticky
   * labels LAST because they are positioned from the scroll offset written
   * just above them.
   */
  const commitSemantic = useCallback((commit: GraphLayoutCommit): void => {
    const host = hostRef.current;
    if (host === null) return;
    const { capture, layout, fontPx } = commit;
    applySemanticLayout(host, capture, layout, fontPx);
    applyZoom({ scale: commit.scale, fit: commit.fit ? 'auto' : 'manual' });
    // A rewritten SVG is a fresh set of elements: re-pin the selection and the
    // unselectable declaration, exactly as the render effect does.
    const selection = selectionController.getSnapshot();
    paintSelectionStyles(host, selection.panel.nodeIds, selection.panel.relations);
    highlightSelection(host, selection.primaryNodeId);
    markDrawingUnselectable(host);
    applyDiffStyles(host, diffHighlightRef.current);
    const center = layoutPipeline.getSnapshot().neighborCenter;
    if (center !== null) nodeElement(host, center)?.classList.add('arch-center');
    // The zoom anchor is the densest window of the mapped layout, not the
    // bounding-box centre: on a sparse drawing the centre is blank space. A
    // "tap a package" request overrides it with that package's frame.
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width > 0 && height > 0) {
      const target = commit.centerPackage === null
        ? null
        : layout.packages.find((entry) => entry.id === commit.centerPackage) ?? null;
      if (target === null) {
        host.scrollLeft = Math.max(0, layout.anchor.x - width / 2);
        host.scrollTop = Math.max(0, layout.anchor.y - height / 2);
      } else {
        const centreX = target.frame.x - layout.content.x + target.frame.width / 2;
        const centreY = target.frame.y - layout.content.y + target.frame.height / 2;
        host.scrollLeft = Math.max(0, centreX - width / 2);
        host.scrollTop = Math.max(0, centreY - height / 2);
      }
    }
    // The sticky labels and the hint are POSITIONED FROM the applied scroll
    // offset, so they are drawn after it is written. Drawing them inside the
    // layout pass measured the previous offset and left the ghosts one zoom
    // behind (the defect this task fixes).
    drawStickyLabels(host, layout, fontPx);
    positionOverviewHint(host);
  }, [applySemanticLayout, applyZoom, layoutPipeline, selectionController]);

  // The pipeline owns WHICH layout is drawn and WHEN; these actions are the
  // DOM-bound half it cannot do itself. Re-registered per render so a callback
  // identity change reaches the owner without re-creating it.
  useEffect(() => {
    layoutPipeline.setActions({
      fitViewport: () => (hostRef.current === null ? null : currentFitViewport(hostRef.current)),
      recordFitViewport,
      semanticFontPx: () =>
        gestureController.isCoarsePointer() ? SEMANTIC_MIN_FONT_MOBILE_PX : SEMANTIC_MIN_FONT_PX,
      commitSemantic,
      measureAspect: () => (hostRef.current === null ? null : measureLayoutAspect(hostRef.current)),
      forcedDefaultFocus,
    });
  }, [layoutPipeline, commitSemantic, currentFitViewport, recordFitViewport, gestureController]);
  // The viewport controller lives in the owner: it survives the renderer
  // replacing the SVG (each render re-attaches), so the mode and scale outlive
  // a single drawing, while the owner clears its debounce timer on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    viewportController.attachViewport(createSvgViewport(host));
    return () => {
      viewportController.attachViewport(null);
    };
  }, [viewportController]);
  useEffect(() => () => viewportController.dispose(), [viewportController]);

  // A sticky package name belongs to the VIEWPORT, not to the drawing: panning
  // must move the ghost labels with the reader, and must never leave one over a
  // class name it no longer clears. Re-place them (and the hint) on the settled
  // frame after each scroll, from the layout last applied.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    let frame: number | null = null;
    const repaint = (): void => {
      frame = null;
      const applied = layoutPipeline.getSnapshot();
      if (applied.appliedLayout === null || applied.semanticCapture === null) return;
      drawStickyLabels(host, applied.appliedLayout, applied.appliedFontPx);
      positionOverviewHint(host);
    };
    const onScroll = (): void => {
      if (frame !== null) return;
      if (typeof window.requestAnimationFrame !== 'function') {
        repaint();
        return;
      }
      frame = window.requestAnimationFrame(repaint);
    };
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      host.removeEventListener('scroll', onScroll);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [layoutPipeline]);

  // Touch gestures ride on the SAME controller the toolbar and Ctrl+wheel use,
  // so pinch never introduces a second zoom model. The host's `touch-action:
  // none` (below) is what suppresses the browser's own page pan/zoom; that is
  // also why the single-finger drag has to pan the container here.
  useEffect(() => {
    const host = hostRef.current;
    const viewport = viewportController.viewport();
    if (host === null || viewport === null) return;
    const gestures = createSvgTouchGestures(host, viewport, {
      onZoom: (scale) => applyZoom({ scale, fit: 'manual' }),
    });
    return () => gestures.destroy();
  }, [applyZoom, viewportController]);

  // Mouse/pen panning rides on the same scroll container the touch gestures
  // pan: left-drag from the blank canvas and middle-drag from anywhere scroll
  // it. Presses on a node are refused so they stay selection/drill gestures,
  // and fingers are left to `createSvgTouchGestures` — one pan, two input
  // families, never two competing drag states.
  // Shift+drag is the marquee (below): refusing a pan while Shift is held is
  // what keeps the two drag readings from running at the same time.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const pan = createSvgDragPan(host, {
      canPanFrom: (target) => !gestureController.isShiftHeld()
        && !(target instanceof Element && target.closest('[data-entity-id]') !== null),
    });
    return () => pan.destroy();
  }, [gestureController]);

  // A press inside the drawing never starts the browser's own text selection.
  // The `user-select` rules already refuse it, but a drag can begin on a label
  // the browser treats as selectable content (and a selection that started
  // OUTSIDE the canvas survives a drag over it), so the primary-button default
  // is cancelled too — `mousedown`'s default action IS "begin a selection".
  // Cancelling it does not cancel the `click` the drawing's own select/drill
  // handlers ride on, and the wheel is a different event family entirely.
  //
  // The refusal is read from the PRESS TARGET's computed policy rather than
  // assumed: only an element declared `user-select: none` has a selection worth
  // refusing. A canvas whose policy is switched back to `auto` (the e2e control
  // arm, or a future selectable-drawing mode) keeps the browser's own
  // behaviour, which is what makes the criterion able to read a false.
  //
  // `preventDefault` also suppresses the focus a press would give the scroll
  // host, so the host is focused explicitly: click-then-arrow-keys keeps
  // panning the way it did before this guard existed.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || typeof window === 'undefined') return;
    const onMouseDown = (event: MouseEvent): void => {
      // Right/middle presses have their own browser meanings (context menu,
      // autoscroll) and never start a selection.
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target === null || window.getComputedStyle(target).userSelect !== 'none') return;
      event.preventDefault();
      const selection = window.getSelection();
      if (selection !== null && selection.rangeCount > 0) selection.removeAllRanges();
      if (document.activeElement !== host) host.focus({ preventScroll: true });
      // A pointer press is not the keyboard: leaving the navigation state
      // clears the ring and the active descendant. The modality gate above
      // keeps the focus this press just gave the host from re-entering it.
      if (selectionController.getSnapshot().navigationActive) exitEntityNavigation(host);
    };
    host.addEventListener('mousedown', onMouseDown);
    return () => host.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Whether Shift is held, kept fresh by a window CAPTURE listener: the capture
  // phase runs before the canvas's own bubble listeners, so the drag-pan
  // predicate reads the modifier of the very press that starts the gesture.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const record = (event: KeyboardEvent | PointerEvent): void => {
      gestureController.recordModifier(event.shiftKey);
    };
    window.addEventListener('keydown', record, true);
    window.addEventListener('keyup', record, true);
    window.addEventListener('pointerdown', record, true);
    return () => {
      window.removeEventListener('keydown', record, true);
      window.removeEventListener('keyup', record, true);
      window.removeEventListener('pointerdown', record, true);
    };
  }, [gestureController]);

  // Which input modality is about to move focus. Read by the host's focus
  // handler: Tab (a keydown) is the only way into entity navigation; a press
  // focuses the host for click-then-arrow panning and must not paint a ring.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromPointer = (): void => selectionController.setFocusModality('pointer');
    const fromKeyboard = (): void => selectionController.setFocusModality('keyboard');
    window.addEventListener('pointerdown', fromPointer, true);
    window.addEventListener('keydown', fromKeyboard, true);
    return () => {
      window.removeEventListener('pointerdown', fromPointer, true);
      window.removeEventListener('keydown', fromKeyboard, true);
    };
  }, []);

  // Shift+drag marquee: the gesture owner keeps the rectangle (in canvas
  // coordinates, so the overlay follows the pointer exactly), decides whether a
  // release travelled far enough to be a marquee, and reports the hit set. This
  // effect only binds the pointer family and forwards it.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || typeof window === 'undefined') return;
    const onDown = (event: PointerEvent): void => {
      if (gestureController.pointerDown({
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        button: event.button,
        shiftKey: event.shiftKey,
        clientX: event.clientX,
        clientY: event.clientY,
      })) event.preventDefault();
    };
    const onMove = (event: PointerEvent): void => {
      if (gestureController.pointerMove({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      })) event.preventDefault();
    };
    const onUp = (event: PointerEvent): void => {
      gestureController.pointerUp({
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };
    const onCancel = (event: PointerEvent): void => {
      gestureController.pointerCancel(event.pointerId);
    };

    host.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      host.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [gestureController]);

  // The panel owns the lock (it knows when a dock/split transition starts); the
  // pipeline owns what the lock suppresses and how lifting it re-bases the
  // container ratio, so the component only forwards the prop.
  useEffect(() => {
    if (relayoutLocked) layoutPipeline.lockRelayout();
    else layoutPipeline.unlockRelayout();
  }, [relayoutLocked, layoutPipeline]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    let cancelled = false;
    const viewKey = drawingKeyOf(view);
    // A pending application belongs to the drawing being replaced; the new one
    // is applied synchronously below.
    layoutPipeline.beginDrawing();
    setFailure(null);
    gestureController.getHandlers().onNodeHover?.(null);
    // A reloaded graph may not contain the previously selected entity.
    const previousSelection = selectionController.getSnapshot().primaryNodeId;
    if (previousSelection !== null && !graph.nodes.some((node) => node.id === previousSelection)) {
      selectionController.clearSelection();
    }

    void (async () => {
      try {
        // The only plantuml-js/elkjs import in the module graph: Vite emits it
        // as its own async chunk, so the first-screen bundle stays untouched.
        const { renderDetailed, toPlantUml, applyView, ElkLayoutEngine } =
          (await import('@yalehwang/plantuml-js/elk')) as unknown as {
            renderDetailed: PlantUmlRenderDetailed;
            toPlantUml: PlantUmlToPlantUml;
            applyView: PlantUmlApplyView;
            ElkLayoutEngine: ArchitectureLayoutEngineClass;
          };
        if (cancelled) return;

        // The container's shape is a LAYOUT input, not a post-render scale: the
        // engine is CONSTRUCTED with it so ELK draws for this container instead
        // of for its own default proportions.
        const drawnAspect = layoutSnapshot.layoutAspect ?? measureLayoutAspect(host);
        // The panel is the adaptive consumer for the FILE graph: the bridge
        // collapses its directory layers itself (the renderer's
        // `groupByPathPrefix` would count a file name as a layer, which is the
        // bug this view exists to avoid). The CLASS graph is never folded: its
        // entities are what the reader asked to see, and the layout budget —
        // not a directory fold — keeps the drawing inside the node bound. The
        // panel also states how this subgraph's ids are shaped, so a file graph
        // keeps its top directory in every group prefix and label.
        const diagram = archguardToPlantUml(graph, {
          view,
          grouping: entityGraph ? 'raw' : 'adaptive',
          idShape,
        });
        // Layout + render is the expensive, blocking part (ELK runs on the main
        // thread); its duration is the DoD's per-view reading. `renderDetailed`
        // runs the same pipeline but hands back the model that was actually
        // drawn, which the text page serializes (see `onDrawnPlantUmlChange`).
        //
        // The layout cannot be interrupted or progressed: once it starts, the
        // main thread belongs to ELK until it returns. So the reading it is
        // ABOUT to cost (this drawing's entity count times the last layout of
        // the same kind, see `estimateLayoutMs`) is taken first, and a layout
        // expected to take more than a second announces itself and yields a
        // frame, so the status is ON SCREEN before the block begins. The
        // previous drawing stays in the host throughout: nothing replaces it
        // until the new SVG is ready.
        const layoutNodes = graph.nodes.length;
        const estimate = layoutPipeline.estimateLayoutMs(idShape, layoutNodes);
        const announce = estimate > LAYOUT_STATUS_THRESHOLD_MS;
        if (announce) {
          layoutPipeline.setLayoutStatus(layoutNodes);
          await afterPaint();
          if (cancelled) {
            layoutPipeline.setLayoutStatus(null);
            return;
          }
        }

        /**
         * One complete layout + render in one direction. The engine comes from
         * the single factory either way, so `direction` is a LAYOUT input (an
         * `elk.direction` option) and never a post-render transform.
         */
        const renderOnce = (direction?: LayoutOrientation): ReturnType<typeof renderWithMemberDetail> => {
          const engine = createLayoutEngine({
            aspectRatio: drawnAspect,
            ...(direction === undefined ? {} : { direction }),
            Engine: ElkLayoutEngine,
          });
          return renderWithMemberDetail(
            renderDetailed,
            // The document the reader copies uses real stereotypes
            // (`class "X" as n0 <<function>>`); the bundled parser needs that
            // token before the alias, so the DRAWING gets the parser-safe
            // spelling. `standardiseDrawnStereotypes` reverses it when the drawn
            // model is serialized for the text page.
            parserSafePlantUml(diagram.puml),
            {
              ...rendererOptionsFor(view, diagram, engine),
              // The box is sized from the text the renderer will PAINT: a member
              // line longer than MEMBER_MAX_CHARS is drawn with a trailing `…`,
              // BEFORE layout, so the width follows what the screen shows. Only
              // the LINES are capped here — the row cap (`MEMBER_MAX_ROWS`) is a
              // drawing rule applied after render, so no folded row ever enters
              // the model. `raw` keeps the full declaration for the Text page,
              // copy and Inspector.
              ...drawnMemberLimits(),
            },
          );
        };

        // The direction policy (see `layoutOrientation.ts`) lives in the
        // pipeline owner: draw the graph downward, and — only for a small graph
        // on a canvas clearly wider than that drawing — draw it once more to
        // the RIGHT, keeping whichever the canvas can show larger. The decision
        // is cached per graph + canvas band, so a shape-driven re-layout reuses
        // it instead of laying the graph out twice again.
        const canvasBox = measureViewportSize(host);
        const outcome = await layoutPipeline.orientLayout({
          fingerprint: graphFingerprint(graph, viewKey, idShape),
          canvas: canvasBox,
          entities: layoutNodes,
          forced: forcedLayoutOrientation(),
          render: async (direction) => {
            const startedAt = performance.now();
            const rendered = await renderOnce(direction === 'DOWN' ? undefined : direction);
            const renderedMs = Math.round(performance.now() - startedAt);
            return {
              size: layoutSizeOf(rendered),
              // Paid only when a second candidate exists (see the pipeline).
              drawnFitScale: () => {
                if (canvasBox === null) return null;
                const fontPx = gestureController.isCoarsePointer()
                  ? SEMANTIC_MIN_FONT_MOBILE_PX
                  : SEMANTIC_MIN_FONT_PX;
                return drawnFitScaleOf(rendered, graph, canvasBox, fontPx);
              },
              elapsedMs: renderedMs,
              drawn: { rendered, elapsedMs: renderedMs },
            };
          },
        });
        if (cancelled) return;
        const detailed = outcome.drawn.rendered;
        const elapsedMs = outcome.drawn.elapsedMs;
        // The next layout of this kind is estimated from this one: the sample is
        // the drawing kind's own, never another kind's. The orientation itself
        // is published by the policy as part of the layout reading, so a reader
        // (and the criterion's control arm) can tell the two layouts apart.
        layoutPipeline.recordLayoutSample(idShape, { nodes: layoutNodes, ms: elapsedMs });

        const { svg, model } = detailed;
        host.innerHTML = svg;
        // The row cap is a DRAWING rule (`MEMBER_MAX_ROWS`): it removes the
        // surplus rows from the DOM and paints the app's own fold label, so the
        // model the text page serializes keeps every authored member.
        capDrawnMemberRows(host);
        // The renderer's own `.uml-canvas` rectangle paints a paper colour
        // sized to the drawing. Against the panel's background that reads as a
        // second background with a seam around it, on every view — not only the
        // semantically rewritten one (which re-applies this after each pass).
        for (const canvasRect of host.querySelectorAll<SVGRectElement>('svg .uml-canvas')) {
          canvasRect.setAttribute('fill', 'none');
        }
        setLayoutMs(elapsedMs);
        // The new drawing is in the host, so the layout the status described is
        // over: it is cleared in this same commit. A state write here is safe
        // because the drawing the reader now sees is already the new one.
        layoutPipeline.setLayoutStatus(null);
        // The text page reads this: the model just drawn, plus the upstream
        // functions that serialize and scope it. `diagram.aliasOf` is the
        // graph-id (and overview `grp::` group) → drawn entity id map.
        gestureController.getHandlers().onDrawnChange?.({
          model,
          entityIdOf: diagram.aliasOf,
          // The drawn model names each function `<<function>> Name` (the
          // parser-safe spelling it was rendered from); the copied document
          // must carry the stereotype as a real token instead.
          toPlantUml: (drawnModel) => standardiseDrawnStereotypes(toPlantUml(drawnModel)),
          applyView,
        });
        restoreEntityIds(host, diagram.aliasOf);
        // Labels are off until a node is hovered/selected, and every entity
        // box carries its source file + seed marker (see `annotateNodes`).
        hideEdgeLabels(host);
        annotateNodes(host, graph, idShape);
        // Relations get their enlarged, invisible hit bands; the panel's
        // selection is repainted on top of the fresh drawing.
        addEdgeHitTargets(host, coarsePointer);
        // A drawing that is semantically zoomed is captured BEFORE any
        // selection decoration: every later application restores this snapshot,
        // so no decoration can accumulate. The grouped overview (a directory
        // map, not a UML drawing) keeps the ordinary CSS-scaled viewport.
        const semanticEligible = !diagram.grouped && !(view.kind === 'overview' && !entityGraph);
        const capture = semanticEligible ? captureSemanticDrawing(host, graph) : null;
        // One write path: the owner drops the replaced drawing's applied layout,
        // tier, status and neighbourhood centre, and records the ratio this
        // drawing was laid out with.
        layoutPipeline.markDrawn({ viewKey, capture, aspect: drawnAspect });
        const viewportForMode = viewportController.viewport();
        // The semantic base size is the SAME boundary the canvas will draw
        // (`semanticContentBounds`), not the renderer's pre-semantic viewBox:
        // the fit reading and the minimap must measure what is on screen.
        viewportForMode?.setSemanticMode(
          capture === null ? null : semanticContentBounds(capture.geometry),
        );
        paintSelectionStyles(
          host,
          selectionController.getSnapshot().panel.nodeIds,
          selectionController.getSnapshot().panel.relations,
        );
        applyDiffStyles(host, diffHighlightRef.current);
        // Every view has its own natural size, so the scale is re-derived here
        // rather than carried over; the fit/custom MODE survives so the resize
        // observer keeps following the container only for a fit user.
        //
        // The default is not "fit everything" any more: a fit below the
        // readable floor would draw sub-pixel labels, so the readable policy
        // focuses the densest seeded package at a legible scale instead. The
        // overview toggle still offers the explicit whole-graph fit.
        const drawing = host.querySelector('svg');
        if (drawing !== null) {
          // Vertical centring lives here, not in the CSS sheet: the host is a
          // flex column and the drawing owns the auto block margins, so a short
          // drawing is centred while a taller one (negative free space) starts
          // at the top and scrolls. `flex: none` keeps the explicit width/height
          // the viewport writes from being shrunk along the column's main axis.
          drawing.style.marginTop = 'auto';
          drawing.style.marginBottom = 'auto';
          drawing.style.flex = 'none';
        }
        const viewport = viewportController.viewport();
        if (drawing !== null && viewport !== null) {
          viewport.attach(drawing);
          const natural = naturalOfDrawing(drawing);
          const box = measureViewportSize(host);
          // A canvas several times wider than its container is a band, not a
          // diagram: collapse it to the directory overview and say so. Only the
          // file graph's explosion view can reach this — its overview is the
          // coarser drawing. The class view has NO coarser drawing to fall back
          // to, so it keeps its hierarchy.
          const aspectBounds = capture === null ? natural : semanticContentBounds(capture.geometry);
          if (view.kind === 'hierarchy' && !entityGraph
            && aspectBounds !== null && box !== null && canvasIsTooWide(aspectBounds, box)) {
            setCollapsedNotice(true);
            setView({ kind: 'overview' });
          } else if (view.kind === 'hierarchy') {
            setCollapsedNotice(false);
          }
          if (capture === null) {
            // The ordinary CSS-scaled drawing (a grouped directory map). `auto`
            // fits the whole drawing down to the manual floor; `manual` keeps
            // the reader's own scale. Either way the placement re-centres it.
            const placement = natural === null ? null : fitPlacementFor(natural, box ?? { width: 0, height: 0 });
            const drawnScale = controllerZoom().fit === 'auto'
              ? viewport.zoomTo(placement?.scale ?? controllerZoom().scale)
              : viewport.zoomTo(controllerZoom().scale);
            applyPlacement(drawing, placement);
            applyZoom({ scale: drawnScale, fit: controllerZoom().fit });
            // A fresh drawing is a new whole-graph view; a package zoom from
            // the previous one no longer names a frame on screen.
            viewportController.setPackageFocus(null);
          }
        }
        // A fresh SVG has no highlight classes; re-pin the current selection.
        highlightSelection(host, selectionController.getSnapshot().primaryNodeId);
        if (view.kind === 'neighborhood') {
          const center = diagram.rendererEntity;
          if (center !== null) {
            const id = reverseAliases(diagram.aliasOf).get(center);
            if (id !== undefined) {
              layoutPipeline.setNeighborCenter(id);
              nodeElement(host, id)?.classList.add('arch-center');
            }
          }
        }
        // A new drawing gets its semantic layout applied synchronously, so it
        // never flashes at the wrong detail before the debouncer fires. The
        // sticky fit state decides how: `auto` re-solves the scale against the
        // new drawing's canvas, `manual` keeps the reader's scale.
        if (capture === null) {
          // A drawing with no semantic pass still needs its coarse-pointer hit
          // rectangles; the captured path lays them down inside
          // `applySemanticLayout`, after the rewrite rebuilt the nodes.
          addNodeHitTargets(host, coarsePointer);
        } else {
          // The new drawing is applied through ONE path, so the draw and the
          // settled-zoom/resize paths can never disagree about which scale is
          // on screen.
          layoutPipeline.applySemantic({ fit: controllerZoom().fit === 'auto', scale: controllerZoom().scale });
        }
        // A focus request (search hit) is centred LAST: the reader asked for
        // THIS node, so it wins.
        // The marker is what tests and sibling panels read; the scroll is the
        // actual "jump to it".
        if (focusNodeId !== null) {
          const focused = nodeElement(host, focusNodeId);
          if (focused !== null) {
            focused.classList.add('arch-focus');
            focused.setAttribute('data-architecture-focus-target', focusNodeId);
            centerElementInContainer(host, focused);
          }
        }
        // Every scroll above has landed: place the sticky package names and the
        // overview hint against the viewport the reader will actually see.
        const applied = layoutPipeline.getSnapshot();
        if (applied.appliedLayout !== null && applied.semanticCapture !== null) {
          drawStickyLabels(host, applied.appliedLayout, applied.appliedFontPx);
          positionOverviewHint(host);
        }
        setDrawn({
          view,
          nodes: host.querySelectorAll('[data-entity-id]').length,
          edges: host.querySelectorAll('[data-edge-source]').length,
        });
        // LAST DOM write of the drawing: every label, badge and hit band is in
        // place, so the unselectable declaration covers the finished drawing.
        markDrawingUnselectable(host);
      } catch (error) {
        if (cancelled) return;
        host.innerHTML = '';
        setDrawn(null);
        setLayoutMs(null);
        // The layout ended — badly — so the status that described it must not
        // outlive it; the failure line below is the reader's explanation.
        layoutPipeline.failDrawing();
        // The previous drawing is gone; the text page must not keep describing it.
        gestureController.getHandlers().onDrawnChange?.(null);
        setFailure(error instanceof Error ? error.message : 'unknown render error');
      }
    })();

    return () => {
      cancelled = true;
      // A superseded/unmounted drawing no longer describes the page's canvas.
      // The text page debounces its rebuild, so a redraw settling quickly never
      // flashes the bridge fallback.
      gestureController.getHandlers().onDrawnChange?.(null);
      // A status belongs to the layout that set it; the run replacing this one
      // decides again whether to announce (and clears it again when it ends).
      layoutPipeline.setLayoutStatus(null);
    };
  }, [applyPlacement, applyZoom, controllerZoom, coarsePointer, entityGraph, fitPlacementFor, focusNodeId, gestureController, graph, idShape, layoutPipeline, layoutSnapshot.layoutAspect, naturalOfDrawing, view, viewportController]);

  /**
   * Keep the SELECTED box inside the visible canvas.
   *
   * Two states need this and they are the same reading: the coarse drawer is an
   * overlay, so its bottom band must not hide the box (the host's padding
   * reserves it, see the host style above); and the landscape-phone side column
   * NARROWS the canvas, which in a focus-mode drawing does not re-fit the
   * geometry (only `fit` mode does). A box that sat near the old right edge
   * would otherwise end up outside the host — or under the side column.
   *
   * The correction is re-asserted for a moment rather than applied once: the
   * fit/placement machinery may re-centre the drawing a few frames later, and
   * that re-centre would otherwise undo it. Each step is a no-op once the box
   * is clear, so a settled page stops scrolling. `scrollLeft/scrollTop` pan the
   * drawing without changing its scale.
   */
  const revealSelectedRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || selectedNodeId === null) {
      revealSelectedRef.current = null;
      return;
    }
    const revealSelected = (): void => {
      const selected = nodeElement(host, selectedNodeId);
      if (selected === null) return;
      const hostRect = host.getBoundingClientRect();
      const nodeRect = selected.getBoundingClientRect();
      // The uncovered part of the host: the overlay drawer's band is not
      // visible ground for the selection.
      const visibleBottom = hostRect.bottom - Math.min(bottomObscuredPx, hostRect.height);
      const margin = 8;
      let dx = 0;
      let dy = 0;
      if (nodeRect.left < hostRect.left + margin) {
        dx = nodeRect.left - hostRect.left - margin;
      } else if (nodeRect.right > hostRect.right - margin) {
        dx = nodeRect.right - hostRect.right + margin;
      }
      if (nodeRect.top < hostRect.top + margin) {
        dy = nodeRect.top - hostRect.top - margin;
      } else if (nodeRect.bottom > visibleBottom - margin) {
        dy = nodeRect.bottom - visibleBottom + margin;
      }
      if (dx !== 0) host.scrollLeft += dx;
      if (dy !== 0) host.scrollTop += dy;
    };
    revealSelectedRef.current = revealSelected;
    const frame = requestAnimationFrame(revealSelected);
    const timers = [250, 600, 1000].map((delay) => setTimeout(revealSelected, delay));
    return () => {
      revealSelectedRef.current = null;
      cancelAnimationFrame(frame);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [bottomObscuredPx, selectedNodeId, layoutSnapshot.drawnRevision]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const nodeFrom = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target.closest('[data-entity-id]') : null;

    const onMouseOver = (event: MouseEvent): void => {
      const node = nodeFrom(event.target);
      const id = node?.getAttribute('data-entity-id') ?? null;
      if (id === null) return;
      highlightRelations(host, id);
      // The contract's hovered node is the one the panel handed over. Group and
      // stub nodes are view scaffolding, not entities, so they have none and
      // report no hover (their highlight still works).
      const hoveredNode = graphRef.current.nodes.find((candidate) => candidate.id === id);
      if (hoveredNode !== undefined) {
        gestureController.getHandlers().onNodeHover?.({ node: hoveredNode, relations: relationsOf(host, id) });
      }
    };

    const onMouseOut = (event: MouseEvent): void => {
      const node = nodeFrom(event.target);
      if (node === null) return;
      const next = event.relatedTarget;
      if (next instanceof Node && node.contains(next)) return;
      // Hover is transient; a pinned selection is restored when the pointer leaves.
      highlightSelection(host, selectionController.getSnapshot().primaryNodeId);
      gestureController.getHandlers().onNodeHover?.(null);
    };

    // The pin/remove menu: right click on a fine pointer, a 500ms press on a
    // touch pointer. Coordinates are relative to the canvas's positioned
    // parent, which is where the menu element is rendered.
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    const cancelLongPress = (): void => {
      if (longPressTimer === null) return;
      clearTimeout(longPressTimer);
      longPressTimer = null;
    };
    const openMenuAt = (clientX: number, clientY: number, target: EventTarget | null): boolean => {
      const canvas = host.parentElement;
      if (canvas === null) return false;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, clientX - rect.left);
      const y = Math.max(0, clientY - rect.top);
      const edgeHit = target instanceof Element
        ? target.closest('[data-architecture-edge-hit]')
        : null;
      if (edgeHit !== null) {
        const from = edgeHit.getAttribute('data-architecture-edge-source');
        const to = edgeHit.getAttribute('data-architecture-edge-target');
        const relationType = edgeHit.getAttribute('data-architecture-edge-type') ?? '';
        if (from === null || to === null) return false;
        selectionController.openContextMenu({ x, y, edge: { from, to, relationType } });
        return true;
      }
      const id = nodeFrom(target)?.getAttribute('data-entity-id') ?? null;
      if (id === null || id.startsWith(GROUP_PREFIX) || id.startsWith(STUB_PREFIX)) return false;
      if (!graphRef.current.nodes.some((candidate) => candidate.id === id)) return false;
      selectionController.openContextMenu({ x, y, nodeId: id });
      return true;
    };

    // Record how the press that produces the next click was made. Mouse clicks
    // keep the original single-click navigation; a touch tap only selects.
    //
    // A 500ms press on a real entity enters the touch multi-select mode (the
    // panel turns the mode on and adds that node); a press on a relation or the
    // blank canvas keeps opening the curation menu. `navigator.vibrate` is the
    // optional acknowledgement — guarded because jsdom and some browsers lack it.
    const onPointerDown = (event: PointerEvent): void => {
      selectionController.recordPointerType(event.pointerType ?? null);
      cancelLongPress();
      if (event.pointerType !== 'touch') return;
      const target = event.target;
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        const id = nodeFrom(target)?.getAttribute('data-entity-id') ?? null;
        const node = id === null
          ? null
          : graphRef.current.nodes.find((candidate) => candidate.id === id) ?? null;
        if (
          node !== null
          && !id?.startsWith(GROUP_PREFIX)
          && !id?.startsWith(STUB_PREFIX)
        ) {
          // The owner suppresses the click the browser sends on release, so it
          // cannot undo the toggle the long press just performed. False means
          // no multi-select handler is installed: keep the curation menu path.
          if (!gestureController.startMultiSelect(node)) {
            if (canCurate) openMenuAt(event.clientX, event.clientY, target);
            return;
          }
          if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            navigator.vibrate(10);
          }
          return;
        }
        if (canCurate) openMenuAt(event.clientX, event.clientY, target);
      }, 500);
    };
    const onPointerMove = (): void => cancelLongPress();
    const onPointerUp = (): void => cancelLongPress();
    const onContextMenu = (event: MouseEvent): void => {
      if (!canCurate) return;
      if (openMenuAt(event.clientX, event.clientY, event.target)) event.preventDefault();
      else selectionController.closeContextMenu();
    };

    /** Pin an entity's highlight and announce it to sibling panels. */
    const selectEntity = (id: string, isTouchTap: boolean): void => {
      selectionController.selectNode(id, isTouchTap);
      highlightRelations(host, id);
      const clickedNode = graphRef.current.nodes.find((candidate) => candidate.id === id);
      if (clickedNode === undefined) return;
      // The JSON lookup is what sibling panels receive, independent of the
      // hops the drill gesture expands.
      announceSelection(graphRef.current, id);
      gestureController.getHandlers().onNodeClick?.(clickedNode);
    };

    const onClick = (event: MouseEvent): void => {
      const isTouchTap = selectionController.consumePointerType() === 'touch';
      // A gesture already acted on release (long-press multi-select, marquee):
      // the browser's trailing click is not a second command.
      if (gestureController.consumeSuppressedClick()) return;
      // Additive = the platform's add-to-selection modifier, or any tap while
      // the touch multi-select mode is on.
      const additive = gestureController.isAdditiveClick(event);
      // Any ordinary click on the drawing closes the pin menu. A click on the
      // menu itself never reaches this listener (the menu is a sibling).
      selectionController.closeContextMenu();

      // At the package-only levels (`C`, and the folded `D` it deepens into)
      // the drawing is a map of frames, not selectable entities: a click on one
      // zooms into it — the "tap a package" gesture the too-small overview hint
      // offers, on every pointer tier. It runs before the background-clear
      // branch because a frame carries no `data-entity-id` of its own.
      if (packageOnlyTier()) {
        const frame = event.target instanceof Element
          ? event.target.closest('.uml-package[data-package-id]')
          : null;
        const packageId = frame?.getAttribute('data-package-id') ?? null;
        if (packageId !== null) {
          zoomToPackage(packageId);
          return;
        }
      }

      // On a coarse pointer a node's visible shape is far smaller than a
      // finger: the drawing scales with the zoom, so even a fitted overview can
      // paint a file box ~10px tall. Resolve the tap against the 44px hit
      // rectangles instead, and let the NEAREST centre win when a dense
      // drawing's rectangles overlap (the topmost rectangle would otherwise
      // hand the tap to a neighbour). The package-only tiers draw no entities,
      // so they keep their frame-zoom path untouched.
      const packageOnly = packageOnlyTier();
      const coarseNodeId = packageOnly
        ? null
        : gestureController.resolveCoarseNodeHit(event.clientX, event.clientY);

      // A relation's enlarged hit band sits ON TOP of the drawing, so it is
      // checked before the ordinary node lookup: clicking a line selects the
      // relation, not whatever box the line starts on. A coarse tap inside a
      // node's touch target is a node press (the finger aimed at the box, and
      // the band is wider than the visible line anyway).
      let id = coarseNodeId;
      if (id === null) {
        const edgeHit = event.target instanceof Element
          ? event.target.closest('[data-architecture-edge-hit]')
          : null;
        if (edgeHit !== null) {
          const from = edgeHit.getAttribute('data-architecture-edge-source');
          const to = edgeHit.getAttribute('data-architecture-edge-target');
          const relationType = edgeHit.getAttribute('data-architecture-edge-type') ?? '';
          if (from === null || to === null) return;
          const edge = { from, to, relationType };
          const toggleEdge = gestureController.getHandlers().onToggleEdgeClick;
          if (additive && toggleEdge !== undefined) {
            toggleEdge(edge);
            return;
          }
          selectionController.selectRelation(edge);
          highlightEdge(host, edgeElement(host, from, to));
          gestureController.getHandlers().onEdgeClick?.(edge);
          return;
        }
        id = nodeFrom(event.target)?.getAttribute('data-entity-id') ?? null;
      }
      if (id === null) {
        // Clicking the background is the "clear the pinned selection" gesture.
        selectionController.clearSelection();
        clearHighlight(host);
        gestureController.getHandlers().onNodeHover?.(null);
        gestureController.getHandlers().onSelectionClear?.();
        return;
      }
      if (id.startsWith(STUB_PREFIX)) return;

      if (id.startsWith(GROUP_PREFIX)) {
        // A group is view scaffolding: selecting it marks the node but does not
        // announce an entity to sibling panels.
        selectionController.selectNode(id, isTouchTap);
        highlightRelations(host, id);
      } else {
        const node = graphRef.current.nodes.find((candidate) => candidate.id === id);
        if (node === undefined) return;
        // Additive clicks toggle the member without touching the drill machinery
        // (a multi-select gesture is not a request to open the neighbourhood).
        const toggleNode = gestureController.getHandlers().onToggleNodeClick;
        if (additive && toggleNode !== undefined) {
          selectionController.addToSelection(id);
          highlightRelations(host, id);
          announceSelection(graphRef.current, id);
          toggleNode(node);
          return;
        }
        selectEntity(id, isTouchTap);
      }

      if (!isTouchTap) {
        // Desktop: a single click only SELECTS and opens the inspector. Drilling
        // one hop deeper is the double-click gesture below.
        return;
      }
      // Touch: the first tap only selects — the drawing must not re-lay out
      // under the finger. A second tap on the same node inside the double-tap
      // window is the explicit drill command.
      if (selectionController.registerTap(id)) drillInto(id);
    };

    // Desktop drill-down: two clicks on the same node. The click handler above
    // has already selected it (and opened the inspector); this only navigates.
    const onDoubleClick = (event: MouseEvent): void => {
      const id = nodeFrom(event.target)?.getAttribute('data-entity-id') ?? null;
      if (id === null || id.startsWith(STUB_PREFIX)) return;
      drillInto(id);
    };

    host.addEventListener('pointerdown', onPointerDown);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerup', onPointerUp);
    host.addEventListener('pointercancel', onPointerUp);
    host.addEventListener('mouseover', onMouseOver);
    host.addEventListener('mouseout', onMouseOut);
    host.addEventListener('click', onClick);
    host.addEventListener('dblclick', onDoubleClick);
    host.addEventListener('contextmenu', onContextMenu);
    return () => {
      cancelLongPress();
      host.removeEventListener('pointerdown', onPointerDown);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerup', onPointerUp);
      host.removeEventListener('pointercancel', onPointerUp);
      host.removeEventListener('mouseover', onMouseOver);
      host.removeEventListener('mouseout', onMouseOut);
      host.removeEventListener('click', onClick);
      host.removeEventListener('dblclick', onDoubleClick);
      host.removeEventListener('contextmenu', onContextMenu);
    };
  }, [canCurate, drillInto, gestureController, packageOnlyTier, zoomToPackage]);

  // The other direction of the cross-panel linkage: a sibling panel selects an
  // entity by its stable id (e.g. a file referenced in chat). The graph pins the
  // selection and drills into that entity's neighbourhood, all from the payload
  // already in hand — no request.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onExternalHighlight = (event: Event): void => {
      const id = (event as CustomEvent<{ id?: unknown }>).detail?.id;
      if (typeof id !== 'string' || id.length === 0) return;
      const node = graphRef.current.nodes.find((candidate) => candidate.id === id);
      if (node === undefined) return;
      selectionController.focusNode(id);
      const host = hostRef.current;
      if (host !== null) highlightSelection(host, id);
      const current = viewRef.current;
      const hops = current.kind === 'neighborhood' && current.entityId === id
        ? current.hops + 1
        : DEFAULT_NEIGHBORHOOD_HOPS;
      setView({ kind: 'neighborhood', entityId: id, hops });
    };

    window.addEventListener(ENTITY_HIGHLIGHT_EVENT, onExternalHighlight);
    return () => window.removeEventListener(ENTITY_HIGHLIGHT_EVENT, onExternalHighlight);
  }, []);

  // The canvas is the wheel's ONLY consumer: a wheel turn zooms around the
  // pointer, whether or not Ctrl/Cmd is held (a trackpad pinch arrives as a
  // ctrlKey wheel, so that form keeps working unchanged). A wheel outside the
  // canvas — the toolbar, the chat behind it — never reaches this listener, so
  // scrolling the page elsewhere is untouched.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    const onWheel = (event: WheelEvent): void => {
      if (viewportController.viewport() === null) return;
      // The drawing never scrolls under the wheel any more; the zoom below is
      // the whole response, so the browser's own scroll/page zoom must not run.
      event.preventDefault();
      // deltaMode 1 is lines and 2 is pages; normalise so a mouse wheel and a
      // trackpad zoom at comparable rates.
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const factor = Math.exp(-event.deltaY * unit * 0.0015);
      viewportController.zoomBy(factor, { clientX: event.clientX, clientY: event.clientY });
    };

    // `passive: false` is needed because a passive wheel listener may not call
    // preventDefault — without it the browser's own page zoom would also fire.
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [viewportController]);

  // The auto-fit re-solve. The debounce, the `auto`-mode gate and the control
  // arm's "refit off" reading live in the viewport owner; this is only the
  // drawing-bound half (semantic rewrite vs. CSS resize + placement).
  const runAutoFit = useCallback((): void => {
    if (layoutPipeline.getSnapshot().semanticCapture !== null) {
      layoutPipeline.applySemantic({ fit: true, scale: controllerZoom().scale });
      return;
    }
    const host = hostRef.current;
    const viewport = viewportController.viewport();
    if (host === null || viewport === null) return;
    const drawing = host.querySelector('svg');
    const natural = naturalOfDrawing(drawing);
    const box = currentFitViewport(host);
    recordFitViewport(box);
    if (natural === null || box === null) return;
    const placement = fitPlacementFor(natural, box);
    const scale = viewport.zoomTo(placement.scale);
    applyPlacement(drawing, placement);
    applyZoom({ scale, fit: 'auto' });
  }, [applyPlacement, applyZoom, controllerZoom, currentFitViewport, fitPlacementFor, layoutPipeline, naturalOfDrawing, recordFitViewport, viewportController]);

  // Every canvas size change — window resize, fullscreen, the inspector/drawer/
  // tray opening, a phone rotation, a re-layout — reaches this observer. Under
  // `auto` it re-solves the fit; under `manual` the reader's scale is kept and
  // only the selected box is panned back into view.
  //
  // The same observer notices a SHAPE change: a resize that only re-fits is
  // cheap, but one that turns the container landscape/portrait makes the
  // drawing's proportions wrong, which only a new layout fixes. That path is
  // behind `shouldRelayoutForAspect`'s threshold and its own debounce.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      // The owner holds the threshold, the lock and the debounce: this only
      // reports what the container now measures.
      layoutPipeline.reportAspect(measureLayoutAspect(host));
      revealSelectedRef.current?.();
      viewportController.scheduleAutoFit();
    });
    observer.observe(host);
    // The corner chrome decides the CSS-scaled fit, and the minimap mounts a
    // beat after the drawing does (it needs the drawn node rectangles).
    // Observing the overlay column re-runs the fit once that chrome has a size.
    const overlays = host.parentElement?.querySelector<HTMLElement>('[data-architecture-canvas-overlays]');
    if (overlays !== undefined && overlays !== null) observer.observe(overlays);
    return () => observer.disconnect();
  }, [layoutPipeline, viewportController]);

  // Remember the box the ordinary (non-fullscreen) layout fits against. The
  // control arm's lever reads it to restore the retired defect; the shipped
  // path never does. A no-dependency effect runs on every render, which is
  // exactly the cadence "the last box this canvas had" needs.
  useEffect(() => {
    if (fullscreen) return;
    const host = hostRef.current;
    if (host === null) return;
    viewportController.reportFlowViewport(measureViewportSize(host));
  });

  // The overlay's Fit area: the viewport-sized host less the chrome actually
  // painted over it. Its insets become the host's padding, so the flex
  // centring, the scroll extent and `measureViewportSize` all describe the same
  // overlay-free rectangle the solve used.
  //
  // Re-measured whenever the top/bottom chrome changes AND whenever the corner
  // slot (the minimap mounts a beat after the drawing) or the selection tray
  // resizes; the latter re-solves through the SAME 150 ms debounce a canvas
  // resize uses, which is what makes opening/closing an overlay re-fit.
  useEffect(() => {
    if (!fullscreen) {
      viewportController.setFullscreenInsets(null);
      return;
    }
    const host = hostRef.current;
    if (host === null) return;
    const measure = (): void => {
      const hostSize = measureHostSize(host);
      if (hostSize === null) return;
      if (forcedFullscreenReservedMargins()) {
        // The control arm keeps the retired rule: no chrome is deducted, so no
        // inset is written and the drawing is centred in the whole overlay.
        viewportController.setFullscreenInsets({ top: 0, right: 0, bottom: 0, left: 0 });
        return;
      }
      const area = solveFitArea(hostSize, fullscreenOverlays());
      // The owner ignores a sub-half-pixel-unchanged reading, so a re-measure
      // that found the same chrome is not a second re-fit.
      viewportController.setFullscreenInsets(fitAreaInsets(hostSize, area));
    };
    measure();
    // One frame after the overlay mounts, its chrome rows are laid out.
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measure) : null;
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
          measure();
          viewportController.scheduleAutoFit();
        })
      : null;
    if (observer !== null) {
      // The host itself is observed so a browser-fullscreen resize (or a phone
      // rotation) re-reads where the absolute chrome now sits; its content box
      // also changes when the insets below are applied, and re-measuring the
      // same numbers is a no-op.
      observer.observe(host);
      const canvas = host.parentElement;
      const panel = host.closest('[data-architecture-panel]');
      const surfaces = [
        canvas?.querySelector<HTMLElement>('[data-architecture-canvas-overlays]') ?? null,
        canvas?.querySelector<HTMLElement>('[data-architecture-tray-root]') ?? null,
        panel?.querySelector<HTMLElement>('[data-architecture-source-footer]') ?? null,
        panel?.querySelector<HTMLElement>('[data-architecture-fullscreen-dock]') ?? null,
      ];
      for (const surface of surfaces) if (surface !== null) observer.observe(surface);
    }
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [fullscreen, fullscreenOverlays, viewportController]);

  // The scale is read from the owner at FIRE time, so a burst of wheel updates
  // coalesces into one rewrite rather than walking every intermediate level.
  // Auto-fit re-solves are driven by the resize path above; this effect only
  // answers explicit (manual) scales.
  useEffect(() => {
    if (zoom.fit !== 'manual') return;
    layoutPipeline.scheduleSemanticApply(() => ({ fit: false, scale: controllerZoom().scale }));
  }, [controllerZoom, layoutPipeline, zoom.fit, zoom.scale]);

  const zoomToScale = (scale: number): void => {
    if (layoutPipeline.getSnapshot().semanticCapture !== null) {
      const applied = clampZoomScale(scale);
      applyZoom({ scale: applied, fit: 'manual' });
      layoutPipeline.applySemantic({ fit: false, scale: applied });
      return;
    }
    // The owner applies the CSS scale through the viewport and clamps it.
    viewportController.zoomTo(scale);
  };

  const zoomByStep = (factor: number): void => {
    if (layoutPipeline.getSnapshot().semanticCapture !== null) {
      const applied = clampZoomScale(controllerZoom().scale * factor);
      applyZoom({ scale: applied, fit: 'manual' });
      layoutPipeline.applySemantic({ fit: false, scale: applied });
      return;
    }
    viewportController.zoomBy(factor);
  };

  /**
   * Fit: return to the sticky `auto` state and solve the largest scale whose
   * mapped content fits the canvas. A semantic drawing never takes a CSS factor
   * here — the solved scale is written into the geometry and shown 1:1.
   */
  const fitDiagram = (): void => {
    // A fit is the whole-graph reading: the package zoom the hint offered is
    // over, and its row must not keep asking the reader to go back.
    viewportController.setPackageFocus(null);
    if (layoutPipeline.getSnapshot().semanticCapture !== null) {
      applyZoom({ scale: controllerZoom().scale, fit: 'auto' });
      layoutPipeline.applySemantic({ fit: true, scale: controllerZoom().scale });
      return;
    }
    const host = hostRef.current;
    const viewport = viewportController.viewport();
    if (host === null || viewport === null) {
      applyZoom({ scale: 1, fit: 'auto' });
      return;
    }
    const drawing = host.querySelector('svg');
    const natural = naturalOfDrawing(drawing);
    const box = currentFitViewport(host);
    recordFitViewport(box);
    if (natural === null || box === null) {
      applyZoom({ scale: viewport.fitAll(), fit: 'auto' });
      return;
    }
    const placement = fitPlacementFor(natural, box);
    const scale = viewport.zoomTo(placement.scale);
    applyPlacement(drawing, placement);
    applyZoom({ scale, fit: 'auto' });
  };

  // The owner publishes the mode the panel needs (the condition under which a
  // fullscreen toggle may re-fit): a new parent render identity is just a new
  // callback slot, never a second write path. The two drawing-bound actions are
  // re-bound every render so they close over the latest props and refs.
  useEffect(() => {
    viewportController.setActions({
      fit: fitDiagram,
      autoFit: runAutoFit,
      onZoomModeChange,
    });
  });

  // A fit request comes from the PANEL's own size change (the fullscreen
  // overlay swaps the region's `flex-1` for `fixed; inset: 0`). The owner
  // answers each token once, and only while it is in Fit mode: the overlay must
  // not undo a manual zoom. `force` is the fresh-analysis case: the content the
  // reader had zoomed is gone, so the panel asks for a fit.
  useEffect(() => {
    viewportController.requestFit(fitRequest);
  }, [fitRequest, viewportController]);

  /**
   * The node a cursor id names, when it names an entity that is in the payload.
   * Package frames and overview group nodes have no payload node.
   */
  const navigationNodeOf = (cursorId: string | null): ArchitectureRendererNode | null => {
    if (cursorId === null || cursorId.startsWith(PACKAGE_NAV_PREFIX)) return null;
    return graphRef.current.nodes.find((candidate) => candidate.id === cursorId) ?? null;
  };

  /** The spoken kind of an entity: the payload's kind, translated. */
  const navigationKindLabel = (node: ArchitectureRendererNode | null): string => {
    switch (node?.kind) {
      case 'class':
        return t('architecture.nav.kindClass', { defaultValue: 'class' });
      case 'interface':
        return t('architecture.nav.kindInterface', { defaultValue: 'interface' });
      case 'enum':
        return t('architecture.nav.kindEnum', { defaultValue: 'enum' });
      case 'abstract':
        return t('architecture.nav.kindAbstract', { defaultValue: 'abstract class' });
      case 'function':
        return t('architecture.nav.kindFunction', { defaultValue: 'function' });
      default:
        return t('architecture.nav.kindEntity', { defaultValue: 'entity' });
    }
  };

  /** The label a cursor id reads as: the payload label, the drawn label, or the id. */
  const navigationLabelOf = (host: HTMLElement, cursorId: string): string => {
    const node = navigationNodeOf(cursorId);
    if (node !== null) return node.label;
    const element = navigationElementOf(host, cursorId);
    const drawn = element?.querySelector('[data-architecture-label]')?.getAttribute('data-architecture-label');
    if (drawn !== undefined && drawn !== null && drawn !== '') return drawn;
    const text = element?.querySelector('text')?.textContent ?? '';
    return text === '' ? cursorId : text;
  };

  /**
   * The polite sentence for a cursor position: the entity's label, its kind,
   * and its position among the drawn items of that kind (`OrderService, class,
   * 3/55`). Deliberately SHORT — the inspector owns the package, the relations
   * and the members, and repeating them here made every arrow press read a
   * paragraph. The DEV control arm can restore the retired long reading.
   */
  const navigationAnnouncementFor = (host: HTMLElement, cursorId: string): string => {
    const items = collectNavigationItems(host);
    if (keyboardA11yDefect() === 'verbose-announce') {
      // Control arm only: the retired whole-reading announcement.
      if (cursorId.startsWith(PACKAGE_NAV_PREFIX)) {
        const packageId = cursorId.slice(PACKAGE_NAV_PREFIX.length);
        const prefix = `${packageId}/`;
        const count = items
          .filter((item) => item.kind === 'entity'
            && (item.packageId === packageId || item.packageId.startsWith(prefix)))
          .length;
        return t('architecture.nav.announcePackage', {
          defaultValue: 'Package {{package}}, {{count}} entities',
          package: packageId,
          count,
        });
      }
      const node = navigationNodeOf(cursorId);
      const element = navigationElementOf(host, cursorId);
      const packageId = (element === null ? null : normalizedPackageId(element.getAttribute('data-package-id')))
        ?? packageIdOfNodeId(cursorId);
      const selection = selectionOf(graphRef.current, cursorId);
      return t('architecture.nav.announceEntity', {
        defaultValue: '{{label}}, {{kind}}, package {{package}}, {{outgoing}} outgoing, {{incoming}} incoming',
        label: navigationLabelOf(host, cursorId),
        kind: navigationKindLabel(node),
        package: packageId === ''
          ? t('architecture.nav.rootPackage', { defaultValue: 'the root package' })
          : packageId,
        outgoing: selection.outgoing.length,
        incoming: selection.incoming.length,
      });
    }
    const isFrame = cursorId.startsWith(PACKAGE_NAV_PREFIX);
    const ordered = [...items].sort(
      (left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id),
    );
    const kindKey = isFrame ? 'package' : 'entity';
    const sameKind = ordered.filter((item) => item.kind === kindKey);
    const index = sameKind.findIndex((item) => item.id === cursorId);
    const label = isFrame ? cursorId.slice(PACKAGE_NAV_PREFIX.length) : navigationLabelOf(host, cursorId);
    const kind = isFrame
      ? t('architecture.nav.kindPackage', { defaultValue: 'package' })
      : navigationKindLabel(navigationNodeOf(cursorId));
    return t('architecture.nav.announceItem', {
      defaultValue: '{{label}}, {{kind}}, {{position}}/{{total}}',
      label,
      kind,
      position: index === -1 ? 0 : index + 1,
      total: sameKind.length,
    });
  };

  /** Repaint the ring and scroll the current box into the viewport. */
  const paintCurrentNavigationItem = (host: HTMLElement): void => {
    const cursorId = selectionController.getSnapshot().navigationCursorId;
    paintNavigationFocus(host, cursorId);
    if (cursorId === null) return;
    const element = navigationElementOf(host, cursorId);
    if (element === null) return;
    centerElementInContainer(host, element);
  };

  /**
   * The drawn items' boxes in CLIENT pixels — the space the viewport centre is
   * measured in. A drawing with no layout (jsdom) keeps the user-unit boxes,
   * where the distance rule is still deterministic.
   */
  const navigationClientItems = (
    host: HTMLElement,
    items: readonly EntityNavigationItem[],
  ): EntityNavigationItem[] => items.map((item) => {
    const element = navigationElementOf(host, item.id);
    const rect = element === null ? null : element.getBoundingClientRect();
    return rect === null || (rect.width <= 0 && rect.height <= 0)
      ? item
      : { ...item, x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });

  /** The centre of the canvas's visible box, in client pixels. */
  const navigationViewportCentre = (host: HTMLElement): NavigationPoint => {
    const rect = host.getBoundingClientRect();
    const width = host.clientWidth > 0 ? host.clientWidth : rect.width;
    const height = host.clientHeight > 0 ? host.clientHeight : rect.height;
    return { x: rect.left + width / 2, y: rect.top + height / 2 };
  };

  /**
   * Enter the entity-navigation state on the last entity the reader stood on
   * (or the current selection) when it is still drawn, otherwise on the entity
   * nearest the viewport centre. Paints the ring and announces the landing.
   * False when the drawing has nothing to stand on.
   */
  const enterEntityNavigation = (host: HTMLElement): boolean => {
    const items = collectNavigationItems(host);
    const snapshot = selectionController.getSnapshot();
    const preferred = snapshot.primaryNodeId ?? snapshot.keyboardFocusId;
    const centre = navigationViewportCentre(host);
    const clientItems = navigationClientItems(host, items);
    const startId = keyboardA11yDefect() === 'farthest-start'
      ? farthestNavigationStart(clientItems, centre)
      : pickNavigationStart(clientItems, preferred, centre);
    if (startId === null) return false;
    selectionController.enterNavigation(startId, navigationAnnouncementFor(host, startId));
    paintCurrentNavigationItem(host);
    return true;
  };

  /**
   * The canvas's focus handler. Keyboard focus starts entity navigation on the
   * nearest entity; a pointer press focuses the host too (so click-then-arrow
   * panning keeps working) and must not paint a keyboard ring.
   */
  const onCanvasFocus = (): void => {
    const host = hostRef.current;
    const snapshot = selectionController.getSnapshot();
    if (host === null || snapshot.navigationActive) return;
    if (snapshot.focusModality === 'pointer') return;
    enterEntityNavigation(host);
  };

  /** Leaving the canvas clears the keyboard ring and its active descendant. */
  const onCanvasBlur = (): void => {
    const host = hostRef.current;
    if (host === null) return;
    // Control arm: keep the ring painted after focus leaves.
    if (keyboardA11yDefect() === 'keep-ring-on-blur') return;
    if (selectionController.getSnapshot().navigationActive) exitEntityNavigation(host);
  };

  /** Move the cursor one step and announce the landing (or "nothing there"). */
  const moveNavigationCursor = (host: HTMLElement, direction: EntityNavigationDirection): void => {
    const currentId = selectionController.getSnapshot().navigationCursorId;
    const next = moveEntityFocus(collectNavigationItems(host), currentId, direction);
    if (next === null) return;
    if (next === currentId) {
      selectionController.moveNavigationCursor(currentId, t('architecture.nav.noNeighbour', {
        defaultValue: 'No entity in that direction',
      }), false);
      return;
    }
    selectionController.moveNavigationCursor(
      next,
      navigationAnnouncementFor(host, next),
      !next.startsWith(PACKAGE_NAV_PREFIX),
    );
    paintCurrentNavigationItem(host);
  };

  /**
   * Keyboard navigation once the canvas has focus: arrows pan, `+`/`-` zoom,
   * `0` fits and `1` returns to natural size.
   *
   * `Enter` enters the entity-navigation state on the current selection (or the
   * first drawn entity). In that state arrows move by screen position, Home/End
   * go to the top-left/bottom-right entity, PageUp/PageDown walk one package,
   * `[`/`]` walk to the enclosing frame and back to its first entity, `Enter`
   * selects (opening the inspector), `Shift+Enter`/Space toggles multi-select,
   * `A` pins and `X` removes through the same callbacks the context menu uses.
   * `Escape` leaves the state and calls `stopPropagation`, so the chat page's
   * global abort never sees it; outside the state Escape keeps its old
   * selection-clearing behaviour, and with no selection at all it is not
   * consumed.
   *
   * Modified presses are left to the browser and the app's shortcuts (Ctrl/Cmd
   * + key), except the curation undo.
   */
  const onCanvasKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const host = hostRef.current;
    if (host === null) return;

    // Ctrl/Cmd+Z is the curation undo, but only while the canvas owns focus
    // (this is the canvas's own key handler).
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && onUndo !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      onUndo();
      return;
    }
    if (event.ctrlKey || event.metaKey) return;

    if (event.key === 'Escape') {
      const snapshot = selectionController.getSnapshot();
      if (snapshot.contextMenu !== null) {
        event.preventDefault();
        event.stopPropagation();
        selectionController.closeContextMenu();
        return;
      }
      // In the entity-navigation state Escape leaves that state and nothing
      // else: `stopPropagation` keeps the chat page's global abort out of it.
      if (snapshot.navigationActive) {
        event.preventDefault();
        event.stopPropagation();
        exitEntityNavigation(host);
        return;
      }
      if (snapshot.primaryNodeId === null && snapshot.panel.relation === null) return;
      event.preventDefault();
      event.stopPropagation();
      gestureController.getHandlers().onEscapeSelection?.();
      return;
    }

    // Delete/Backspace removes the selected entity (or hides the selected
    // relation) through the panel's curation store. `stopPropagation` keeps the
    // key away from the chat page's global abort — the drawing owns it only
    // while a selection exists AND a curation callback can act on it.
    if (event.key === 'Delete' || event.key === 'Backspace') {
      const snapshot = selectionController.getSnapshot();
      const edge = snapshot.panel.relation;
      const nodeId = snapshot.primaryNodeId;
      if (edge === null && nodeId === null) return;
      if (edge !== null) {
        if (onHideRelation === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        onHideRelation({ from: edge.from, to: edge.to, relationType: edge.relationType });
        return;
      }
      if (onRemoveNode === undefined || nodeId === null) return;
      const node = graphRef.current.nodes.find((candidate) => candidate.id === nodeId);
      if (node === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      onRemoveNode(node);
      return;
    }

    /** The entity the cursor stands on, or null on a frame / nowhere. */
    const cursorNode = (): ArchitectureRendererNode | null =>
      navigationNodeOf(selectionController.getSnapshot().navigationCursorId);

    /** Enter's selection: an entity opens the inspector, a frame zooms into it. */
    const selectCursorItem = (): boolean => {
      const cursorId = selectionController.getSnapshot().navigationCursorId;
      if (cursorId === null) return false;
      if (cursorId.startsWith(PACKAGE_NAV_PREFIX)) {
        // A frame is a place, not an entity: the same gesture a tap gives it.
        zoomToPackage(cursorId.slice(PACKAGE_NAV_PREFIX.length));
        selectionController.announce(t('architecture.nav.enteredPackage', {
          defaultValue: 'Entered package {{package}}',
          package: cursorId.slice(PACKAGE_NAV_PREFIX.length),
        }));
        return true;
      }
      const node = cursorNode();
      if (node === null) return false;
      selectionController.addToSelection(cursorId);
      highlightRelations(host, cursorId);
      announceSelection(graphRef.current, cursorId);
      gestureController.getHandlers().onNodeClick?.(node);
      selectionController.announce(t('architecture.nav.selected', {
        defaultValue: '{{label}} selected',
        label: navigationLabelOf(host, cursorId),
      }));
      return true;
    };

    /** Shift+Enter / Space: toggle the cursor's entity in the multi-select set. */
    const toggleCursorSelection = (): boolean => {
      const node = cursorNode();
      const snapshot = selectionController.getSnapshot();
      const cursorId = snapshot.navigationCursorId;
      if (node === null || cursorId === null) return false;
      const wasSelected = snapshot.panel.nodeIds.includes(cursorId) || snapshot.primaryNodeId === cursorId;
      selectionController.addToSelection(cursorId);
      highlightRelations(host, cursorId);
      announceSelection(graphRef.current, cursorId);
      const toggleNode = gestureController.getHandlers().onToggleNodeClick;
      if (toggleNode !== undefined) toggleNode(node);
      else gestureController.getHandlers().onNodeClick?.(node);
      selectionController.announce(wasSelected
        ? t('architecture.nav.deselected', {
            defaultValue: '{{label}} removed from the selection',
            label: node.label,
          })
        : t('architecture.nav.selectedIntoSet', {
            defaultValue: '{{label}} added to the selection',
            label: node.label,
          }));
      return true;
    };

    if (selectionController.getSnapshot().navigationActive) {
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'up');
          return;
        case 'ArrowDown':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'down');
          return;
        case 'ArrowLeft':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'left');
          return;
        case 'ArrowRight':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'right');
          return;
        case 'Home':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'home');
          return;
        case 'End':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'end');
          return;
        case 'PageUp':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'pageUp');
          return;
        case 'PageDown':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'pageDown');
          return;
        case '[':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'parent');
          return;
        case ']':
          event.preventDefault();
          event.stopPropagation();
          moveNavigationCursor(host, 'child');
          return;
        case 'Enter':
          if (event.shiftKey) {
            if (!toggleCursorSelection()) return;
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          if (event.altKey) {
            const drillId = selectionController.getSnapshot().navigationCursorId;
            if (drillId === null || drillId.startsWith(PACKAGE_NAV_PREFIX)) return;
            event.preventDefault();
            drillInto(drillId);
            return;
          }
          if (!selectCursorItem()) return;
          event.preventDefault();
          event.stopPropagation();
          return;
        case ' ':
        case 'Spacebar':
          if (!toggleCursorSelection()) return;
          event.preventDefault();
          event.stopPropagation();
          return;
        case 'a':
        case 'A': {
          const node = cursorNode();
          if (node === null) return;
          const action = pinnedSet.has(node.id) ? onUnpinNode : onPinNode;
          if (action === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          action(node);
          return;
        }
        case 'x':
        case 'X': {
          const node = cursorNode();
          if (node === null || onRemoveNode === undefined) return;
          event.preventDefault();
          event.stopPropagation();
          onRemoveNode(node);
          return;
        }
        default:
          // `+`/`-`/`0`/`1` keep working below; everything else is default.
          break;
      }
    } else {
      // Enter enters the navigation state on the current selection or the first
      // drawn entity. Arrows keep panning until then (requirement 4).
      if (event.key === 'Enter') {
        if (enterEntityNavigation(host)) event.preventDefault();
        return;
      }
      if (event.key === '[' || event.key === ']') {
        if (!enterEntityNavigation(host)) return;
        event.preventDefault();
        moveNavigationCursor(host, event.key === '[' ? 'parent' : 'child');
        return;
      }
    }

    if (event.altKey) return;
    switch (event.key) {
      case 'ArrowLeft':
        if (selectionController.getSnapshot().navigationActive) return;
        host.scrollLeft -= KEYBOARD_PAN_STEP;
        break;
      case 'ArrowRight':
        if (selectionController.getSnapshot().navigationActive) return;
        host.scrollLeft += KEYBOARD_PAN_STEP;
        break;
      case 'ArrowUp':
        if (selectionController.getSnapshot().navigationActive) return;
        host.scrollTop -= KEYBOARD_PAN_STEP;
        break;
      case 'ArrowDown':
        if (selectionController.getSnapshot().navigationActive) return;
        host.scrollTop += KEYBOARD_PAN_STEP;
        break;
      case '+':
      case '=':
        zoomByStep(ZOOM_STEP);
        break;
      case '-':
      case '_':
        zoomByStep(1 / ZOOM_STEP);
        break;
      case '0':
        fitDiagram();
        break;
      case '1':
        zoomToScale(1);
        break;
      default:
        // Anything else keeps its default behaviour.
        return;
    }
    event.preventDefault();
  };

  // The keyboard cursor lives in the DOM (a class, an element id and a drawn
  // ring), so a drawing that was replaced — a new view, or a semantic rewrite —
  // loses it. Repaint it from the settled state; the cursor's own moves paint
  // synchronously in the key handler, and this is the restoring half.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    if (!selectionSnapshot.navigationActive) {
      clearNavigationFocus(host);
      return;
    }
    paintCurrentNavigationItem(host);
  }, [drawn, layoutSnapshot.drawnRevision, selectionSnapshot.navigationActive, selectionSnapshot.navigationCursorId]);

  const viewLabel = view.kind === 'overview'
    ? t('architecture.plantuml.overview', { defaultValue: 'Overview' })
    : view.kind === 'group'
      ? t('architecture.plantuml.group', { defaultValue: 'Group: {{group}}', group: view.prefix })
      : view.kind === 'hierarchy'
        ? t('architecture.plantuml.explosion', { defaultValue: 'Explosion view' })
        : t('architecture.plantuml.neighborhood', {
            defaultValue: '{{entity}} · {{hops}} hop(s)',
            entity: view.entityId,
            hops: view.hops,
          });
  /**
   * What the reader is looking at while a neighbourhood is open, said in the
   * toolbar on BOTH tiers.
   *
   * Double-clicking an entity replaces the drawing with a smaller one and used
   * to state nothing: the only new chrome was "Back to Class diagram" and
   * "Explosion view", which name where the reader could go, never where they
   * were. The status names the entity — and the entity is named the way the
   * panel names it everywhere else: the payload's own label, falling back to
   * the id's last segment so an opaque scope prefix never reaches a reader.
   */
  const neighbourhoodStatus = (() => {
    if (view.kind !== 'neighborhood') return null;
    const node = graph.nodes.find((candidate) => candidate.id === view.entityId);
    const label = node === undefined ? '' : node.label.trim();
    const name = label !== '' && label !== view.entityId
      ? label
      : view.entityId.slice(view.entityId.lastIndexOf('.') + 1);
    return t('architecture.plantuml.neighbourhoodStatus', {
      defaultValue: 'Neighbourhood of {{entity}} · {{hops}} hop(s)',
      entity: name,
      hops: view.hops,
    });
  })();

  // The explicit drill command is offered only for a touch selection that has
  // not already opened its own view: a desktop click navigated on its own, and
  // a selection whose neighbourhood is on screen has nothing left to drill.
  const drillNodeId = selectionSnapshot.drillNodeId;
  const selectedPrefix = drillNodeId !== null && drillNodeId.startsWith(GROUP_PREFIX)
    ? drillNodeId.slice(GROUP_PREFIX.length)
    : null;
  const selectionAlreadyOpen = drillNodeId === null
    || (selectedPrefix !== null
      ? view.kind === 'group' && view.prefix === selectedPrefix
      : view.kind === 'neighborhood' && view.entityId === drillNodeId);
  const canDrill = selectionSnapshot.selectedByTouch && drillNodeId !== null && !selectionAlreadyOpen;

  const zoomGroupLabel = t('architecture.plantuml.zoomGroup', { defaultValue: 'Diagram zoom' });
  /**
   * The percentage every surface states. For a semantic drawing this is the
   * engine's own scale `s` — the ONE proportion, baked into the geometry and
   * shown 1:1 — so it equals the SVG's `data-architecture-semantic-scale`.
   * For a grouped directory map it is the CSS scale the viewport applied.
   */
  const displayScale = zoom.scale;

  /** The collapsed-to-overview notice: the only reading banner the canvas keeps. */
  const readableNotice = collapsedNotice ? (
    <span data-architecture-readable-collapsed="true" className="text-amber-600 dark:text-amber-400">
      {t('architecture.plantuml.readable.collapsed', {
        defaultValue: 'The graph is too wide, so it was collapsed to the directory overview.',
      })}
    </span>
  ) : null;

  /**
   * Where the ONE scale reading is drawn.
   *
   * The desktop tier draws the in-flow row above the canvas, so the reading
   * belongs there beside the zoom tier. The compact tier has no visible
   * in-flow row (the tier is portaled into the Adjust sheet, which is shut by
   * default), so the reading rides in the on-canvas zoom cluster instead —
   * always drawn, always exactly once. Rendering it in both places is the
   * defect the task removed: two percentages for one drawing.
   */
  const readoutInCluster = compactToolbar;
  /** The DEV control arm's second reading; `null` in the shipped build. */
  const duplicateReadout = overlayLayoutDefect() === 'duplicate-readout';

  /** The single place the actual scale is stated, so fit (e.g. 42%) and 100% are distinguishable. */
  const zoomReadout = (
    <span
      data-architecture-zoom-level
      // The zoom readout carries the same orientation reading as the layout
      // row: the scale on screen and the direction that produced it are one
      // statement about the drawing.
      data-architecture-layout-direction={layoutSnapshot.layoutDirection ?? undefined}
      data-architecture-layout-direction-reason={layoutSnapshot.layoutDirectionReason ?? undefined}
      className="min-w-9 text-center tabular-nums"
    >
      {Math.round(displayScale * 100)}%
    </span>
  );

  // The default drawing of this graph (see `defaultViewOf`): the class view's
  // hierarchy, or the file overview. "Back" returns HERE, so the entity graph
  // goes back to the full class drawing rather than to a document it never
  // renders.
  const defaultView = defaultViewOf(idShape);
  // The breadcrumb is offered ONLY from a real drill-down (a neighbourhood or
  // an expanded group). It used to follow `!atDefaultView`, which also counted
  // the explosion view — so "Back to overview" appeared when nothing had been
  // drilled at all.
  const inDrillView = view.kind === 'neighborhood' || view.kind === 'group';
  const backTargetLabel = isEntityGraph(idShape)
    ? t('architecture.plantuml.classDiagram', { defaultValue: 'Class diagram' })
    : t('architecture.plantuml.overview', { defaultValue: 'Overview' });
  const backButton = inDrillView
    ? (
      <button
        type="button"
        onClick={() => setView(defaultView)}
        data-architecture-back="true"
        style={touchTargetStyle}
        className={`${TOOLBAR_BUTTON_CLASS} text-left`}
      >
        {t('architecture.plantuml.backTo', {
          defaultValue: 'Back to {{view}}',
          view: backTargetLabel,
        })}
      </button>
    )
    : null;

  // The explosion view draws the whole graph as one nested hierarchy; zooming it
  // then switches visibility levels instead of re-laying it.
  const explosionButton = view.kind === 'hierarchy'
    ? null
    : (
      <button
        type="button"
        onClick={() => {
          // Asking for the explosion view again re-evaluates the aspect guard;
          // the notice returns only if the canvas is still a band.
          setCollapsedNotice(false);
          setView({ kind: 'hierarchy' });
        }}
        data-architecture-explosion="true"
        // The label alone never said what the view is; the tooltip does, in the
        // same words a hover anywhere else on this canvas would use.
        title={t('architecture.plantuml.explosionHint', {
          defaultValue: 'Draw every entity as its own box, the whole graph at once',
        })}
        style={touchTargetStyle}
        className={`${TOOLBAR_BUTTON_CLASS} text-left`}
      >
        {t('architecture.plantuml.explosion', { defaultValue: 'Explosion view' })}
      </button>
    );

  // The zoom controls live in the on-canvas cluster (bottom right of the
  // drawing), not in the toolbar: they act on the drawing, so they belong on
  // it. 32px targets on a fine pointer, 44px on a coarse one.
  const clusterTargetStyle = touchUi ? TOUCH_TARGET_STYLE : ZOOM_CLUSTER_TARGET_STYLE;
  /** The corner slot's direction and insets: the same model the pill's slot uses. */
  const cornerLayout = bottomCornerLayout({ touchUi, shortTouch });
  /**
   * The bottom band the portrait phone keeps clear for its corner controls.
   * Zero on every other tier (and for the DEV arm that restores the pre-task
   * floating controls), so the existing fit is unchanged there.
   */
  const portraitControlBandPx = portraitPhone && !portraitControlsOverlay && !shortTouch
    ? PORTRAIT_CONTROL_BAND_PX
    : 0;
  /** The portrait cluster's shipped form is the one 44px button. */
  const portraitClusterCollapsed = portraitPhone && !layoutSnapshot.clusterExpanded && !portraitControlsOverlay;

  /**
   * The canvas pill. It has two reasons to exist, and neither is a Focus notice:
   *  · the folded tier always states what the reader is looking at — a map of
   *    collapsed package tabs — because the drawing no longer shows entities;
   *  · after the reader taps a package the row carries the "back to the whole
   *    graph" action.
   *
   * The retired "whole graph at N % — tap a package" hint is gone with Focus:
   * `auto` fit always shows the whole graph on purpose, so a sentence telling
   * the reader it is too small had no action to offer that the palette did not.
   */
  const foldedDepth = layoutSnapshot.foldDepth;
  const showOverviewHint = foldedDepth !== null || packageFocus !== null;
  const overviewHintText = foldedDepth !== null
    ? t('architecture.plantuml.readable.folded', {
        defaultValue: 'Collapsed to {{depth}} levels — tap a package to zoom in',
        depth: foldedDepth,
      })
    : null;
  // The pill may only cover the drawing where no package tab is painted. It is
  // measured after every commit that can move either side (the drawing was
  // rewritten, the pill's wording changed, or a package zoom re-scrolled).
  useEffect(() => {
    const host = hostRef.current;
    if (host === null || !showOverviewHint) return;
    positionOverviewHint(host);
  }, [showOverviewHint, layoutSnapshot.drawnRevision, zoom.scale, packageFocus, foldedDepth]);

  const zoomOutButton = (
    <button
      type="button"
      onClick={() => zoomByStep(1 / ZOOM_STEP)}
      aria-label={t('architecture.plantuml.zoomOut', { defaultValue: 'Zoom out' })}
      data-architecture-zoom-out="true"
      style={clusterTargetStyle}
      className={TOOLBAR_BUTTON_CLASS}
    >
      −
    </button>
  );

  const zoomInButton = (
    <button
      type="button"
      onClick={() => zoomByStep(ZOOM_STEP)}
      aria-label={t('architecture.plantuml.zoomIn', { defaultValue: 'Zoom in' })}
      data-architecture-zoom-in="true"
      style={clusterTargetStyle}
      className={TOOLBAR_BUTTON_CLASS}
    >
      +
    </button>
  );

  const fitButton = (
    <button
      type="button"
      onClick={fitDiagram}
      aria-pressed={zoom.fit === 'auto'}
      data-architecture-zoom-fit="true"
      style={clusterTargetStyle}
      className={TOOLBAR_BUTTON_CLASS}
    >
      {t('architecture.plantuml.zoomFit', { defaultValue: 'Fit to view' })}
    </button>
  );

  const drillButton = canDrill
    ? (
      <button
        type="button"
        onClick={drillSelected}
        data-architecture-drill-in="true"
        style={touchTargetStyle}
        className={TOOLBAR_BUTTON_CLASS}
      >
        {t('architecture.plantuml.drillIn', { defaultValue: 'Drill in' })}
      </button>
    )
    : null;

  // The single zoom-tier group: ONE scale reading plus the breadcrumb/drill
  // actions. The Focus | Overview switch that used to sit here is retired with
  // the focus policy itself.
  const zoomTierGroup = (
    <div
      data-architecture-zoom-tier="true"
      role="group"
      aria-label={t('architecture.plantuml.zoomTier', { defaultValue: 'Zoom level' })}
      style={{ gap: touchUi ? TOUCH_CONTROL_GAP_PX : 4 }}
      className="pointer-events-auto flex max-w-full flex-wrap items-center rounded-lg border border-border/60 bg-background/90 p-1 text-[11px] text-muted-foreground shadow-sm"
    >
      {!readoutInCluster && zoomReadout}
      {neighbourhoodStatus !== null && (
        <span
          data-architecture-neighbourhood-status="true"
          className="min-w-0 max-w-full truncate"
        >
          {neighbourhoodStatus}
        </span>
      )}
      {backButton}
      {explosionButton}
      {drillButton}
    </div>
  );

  const exportButton = onExport === undefined
    ? null
    : (
      <button
        type="button"
        // The panel owns the menu this button is drawn into, so closing it is
        // the panel's job too (its `onExport` closes the menu after writing).
        onClick={() => onExport()}
        data-architecture-overflow-export="true"
        style={touchTargetStyle}
        className={`${TOOLBAR_BUTTON_CLASS} text-left`}
      >
        {t('architecture.exportMmd', { defaultValue: 'Export .mmd' })}
      </button>
    );

  // When the panel has a detail knob above this renderer it hands over the two
  // numbers the reader asked about (retained vs. in-scope). Without one — this
  // component rendered directly — the summary stays the local drawn/total
  // reading it always was.
  const visibleSummary = detailReading === undefined ? (
    t('architecture.visibleNodes', {
      defaultValue: '{{visible}} of {{total}} nodes',
      visible: drawn?.view === view ? drawn.nodes : 0,
      total: graph.nodes.length,
    })
  ) : (
    t('architecture.controls.detailReading', {
      defaultValue: 'Showing {{shown}} of {{total}} related nodes',
      shown: detailReading.shown,
      total: detailReading.totalInScope,
    })
  );

  // The row above the canvas: the zoom tier and the scale it is at. The panel
  // owns the row itself (the one-line readout sits on its left) and hands this
  // renderer the right-hand cell; standalone, the renderer draws the row.
  const headerControls = (
    <span
      data-architecture-graph-header-controls="true"
      // Desktop pins the tier to the header's right edge; the compact tier's
      // Adjust sheet stacks its sections, so the same row is left-aligned
      // there (right-aligned, it left a strip of empty space down the left).
      className={`flex min-w-0 max-w-full flex-wrap items-center gap-1 ${
        compactToolbar ? 'w-full justify-start' : 'justify-end'
      }`}
    >
      {zoomTierGroup}
    </span>
  );

  // The marquee overlay's rectangle, read from the gesture owner's snapshot
  // (canvas coordinates, so it follows the pointer exactly).
  const marqueeRect = gestureSnapshot.marquee;

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-architecture-plantuml-graph="true"
      data-architecture-view={view.kind}
      data-architecture-hops={view.kind === 'neighborhood' ? view.hops : undefined}
      data-architecture-visible-nodes={drawn?.view === view ? drawn.nodes : 0}
      data-architecture-visible-edges={drawn?.view === view ? drawn.edges : 0}
      // `fit`/`custom` keeps the panel's existing vocabulary: `auto` is the
      // sticky fit that follows the canvas, `manual` is a scale the reader set.
      data-architecture-zoom-mode={zoom.fit === 'auto' ? 'fit' : 'custom'}
      data-architecture-fit={zoom.fit}
      // The ONE proportion on screen. For a semantic drawing it equals the
      // SVG's own `data-architecture-semantic-scale`; there is no CSS factor.
      data-architecture-zoom-scale={displayScale}
      data-architecture-semantic-scale={layoutSnapshot.semanticCapture !== null ? displayScale : undefined}
      // The box the last Fit solved against, as `WxH`. On the overlay that is
      // the host less its measured chrome (not the non-fullscreen margin),
      // minus the one pixel the semantic writer rounds up — the reading a
      // criterion compares the drawn size against.
      data-architecture-fit-viewport={fitViewportReading === null
        ? undefined
        : `${Math.round(fitViewportReading.width)}x${Math.round(fitViewportReading.height)}`}
      data-architecture-fold-depth={layoutSnapshot.foldDepth ?? undefined}
      data-architecture-lod-depth={layoutSnapshot.lodDepth ?? undefined}
      data-architecture-layout-ms={layoutMs ?? undefined}
      // The layout readout's direction and reason: WHICH orientation the
      // drawing was laid out in, and why the policy chose it.
      data-architecture-layout-direction={layoutSnapshot.layoutDirection ?? undefined}
      data-architecture-layout-direction-reason={layoutSnapshot.layoutDirectionReason ?? undefined}
    >
      <style>{HIGHLIGHT_STYLE}</style>
      <style data-architecture-diff-highlight-style="true">{DIFF_HIGHLIGHT_STYLE}</style>
      <style data-architecture-canvas-selection-style="true">{CANVAS_UNSELECTABLE_STYLE}</style>
      {/* The renderer's own legend is NOT part of the semantic rewrite, so its
          fixed 10px text would be the one label below the phone floor. The
          floor is stated here, in screen pixels, because k = 1. */}
      <style data-architecture-legend-floor="true">
        {`[data-architecture-plantuml] svg .uml-legend text { font-size: ${touchUi ? SEMANTIC_MIN_FONT_MOBILE_PX : SEMANTIC_MIN_FONT_PX}px; }`}
      </style>
      {canvasHeaderSlot !== null ? (
        createPortal(headerControls, canvasHeaderSlot)
      ) : compactToolbar ? null : (
        // The compact tier has no in-flow chrome row: when the panel has not
        // mounted a slot (the bottom sheet is shut), drawing one would put a
        // second row back between the header and the drawing.
        <div
          data-architecture-graph-header="true"
          className="flex shrink-0 flex-wrap items-center justify-end gap-1 px-1 pb-1"
        >
          {headerControls}
        </div>
      )}
      {compactToolbar ? (
        // On the compact tier the panel already spends the one row it has on
        // the title, granularity and "…"; the rest of this renderer's controls
        // (view label, export, visible summary) are drawn inside that menu at
        // the same 44px targets. The zoom tier is NOT here: it lives in the
        // in-flow row above the canvas on every tier, so no popover floats it
        // over the drawing.
        compactToolbarSlot !== null && createPortal(
          <span data-architecture-compact-controls="true" className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span data-architecture-view-label>{viewLabel}</span>
            </span>
            {exportButton}
            <span
              data-architecture-visible-summary
              data-architecture-detail-shown={detailReading?.shown}
              data-architecture-detail-total={detailReading?.totalInScope}
            >
              {visibleSummary}
            </span>
          </span>,
          compactToolbarSlot,
        )
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col" data-architecture-canvas="true">
        <div
          ref={hostRef}
          // The canvas is an image until the reader enters entity navigation;
          // then it is an application whose active descendant is the entity the
          // keyboard cursor stands on (the ring is drawn inside the drawing).
          role={selectionSnapshot.navigationActive ? 'application' : 'img'}
          aria-label={t('architecture.graphAria', { defaultValue: 'Architecture neighbourhood graph' })}
          aria-activedescendant={
            selectionSnapshot.navigationActive && selectionSnapshot.navigationCursorId !== null
              ? navigationDomId(selectionSnapshot.navigationCursorId)
              : undefined
          }
          // The canvas is its own keyboard target: Tab starts entity navigation
          // on the entity nearest the viewport centre, arrows then move the
          // cursor, `+`/`-` zoom, `0` fits and `1` is natural size (see
          // `onCanvasKeyDown`). The focus cue is the dashed ring drawn around
          // that entity, so the host itself draws no outline: a second blue
          // frame around the whole canvas was the stale focus residue.
          tabIndex={0}
          // The phone tier spends only 4px a side on padding: the task wants
          // the fitted drawing at ≥95% of the canvas width, and a 12px inset
          // already costs 6.5% of a 366px canvas. The fine-pointer tier keeps
          // the roomier p-3.
          className={`h-full w-full overflow-auto outline-none ${fullscreen ? '' : touchUi ? 'p-1' : 'p-3'}`}
          // The gestures own every touch on the drawing: without this the browser
          // would pan/zoom the page and the pinch would never reach the controller.
          // The flex column is the vertical-centring mechanism: the injected SVG
          // gets `margin-block: auto` (set where it is inserted), so a drawing
          // shorter than the canvas sits in the middle instead of hugging the top.
          // The selection declarations are stated inline as well as in the
          // injected rule above: this host is where a drag starts, and
          // `markDrawingUnselectable` repeats them on the drawing itself.
          style={{
            touchAction: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            // On the overlay the host IS the viewport, and the ONLY ground it
            // loses is the chrome measured over it: the padding is exactly the
            // overlay-free rectangle the Fit solved against (computed by the
            // effect below from `topObscuredPx`/`bottomObscuredPx` and the
            // corner slot's live rects). The non-fullscreen reserved margin
            // (`p-3`/`p-1`) is deliberately NOT carried over — that margin
            // existed for the in-flow layout, and inheriting it is what left
            // the fullscreen drawing small. No overlay measured yet means no
            // padding: the first frame uses the whole host, then settles.
            ...(fullscreen
              ? (fullscreenInsets === null
                  ? {}
                  : {
                      paddingTop: `${fullscreenInsets.top}px`,
                      paddingRight: `${fullscreenInsets.right}px`,
                      paddingBottom: `${fullscreenInsets.bottom}px`,
                      paddingLeft: `${fullscreenInsets.left}px`,
                    })
              : {
                  // The coarse drawer overlays the canvas' bottom band.
                  // Reserving it as padding makes the flex centring use the
                  // area ABOVE the drawer, so a fitted drawing is never
                  // half-hidden behind it. The portrait phone reserves its
                  // collapsible zoom controls' band in the SAME bottom region:
                  // the controls float over the canvas, so the drawing is
                  // fitted ABOVE them instead of under them. The two bands are
                  // measured from the same bottom edge, so they compose as a
                  // maximum rather than a sum — an open drawer already covers
                  // the controls' footprint, and reserving both would lift the
                  // drawing 80px higher than either surface needs. Padding (not
                  // a chrome row) is deliberate — `clientHeight` still counts
                  // it, so the canvas-share reading loses nothing.
                  ...(bottomObscuredPx + portraitControlBandPx > 0
                    ? {
                      paddingBottom: `${(touchUi ? 4 : 12)
                        + Math.max(bottomObscuredPx, portraitControlBandPx)}px`,
                    }
                    : {}),
                  // The standalone page's chrome (toolbar + readout rows) is
                  // drawn OVER its viewport-sized canvas; the in-tab layout
                  // keeps those rows in flow. Reserving the band as padding
                  // makes the flex centring — and `measureViewportSize`'s fit
                  // box — use the area BELOW the chrome.
                  ...(topObscuredPx > 0
                    ? { paddingTop: `${(touchUi ? 4 : 12) + topObscuredPx}px` }
                    : {}),
                }),
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitTouchCallout: 'none',
          }}
          onKeyDown={onCanvasKeyDown}
          onFocus={onCanvasFocus}
          onBlur={onCanvasBlur}
          data-testid="plantuml-host"
          data-architecture-plantuml="true"
        />
        {/* The keyboard cursor's polite reading: the entity it stands on (label,
            kind, package, in/out counts) and the last selection action. Sibling
            of the host so the drawing's imperative innerHTML never wipes it. */}
        <span
          role="status"
          aria-live="polite"
          data-architecture-nav-announcer="true"
          className="sr-only"
        >
          {selectionSnapshot.navigationAnnouncement}
        </span>
        {layoutSnapshot.layoutStatusNodes !== null && (
          // An overlay, deliberately: a status drawn in flow would change the
          // canvas' height, and therefore the very fit the drawing after it is
          // laid out for. It sits above the drawing the reader is still looking
          // at, not in place of it — the host keeps the previous SVG until the
          // new one is ready.
          <div
            data-architecture-layout-status={layoutSnapshot.layoutStatusNodes}
            role="status"
            aria-live="polite"
            style={{ position: 'absolute', zIndex: 26, left: 12, top: 12, maxWidth: '78%' }}
            className="pointer-events-none flex items-center gap-2 rounded-md border border-border/60 bg-background/95 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm"
          >
            <span aria-hidden="true" className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="min-w-0 truncate">
              {t('architecture.plantuml.layoutProgress', {
                defaultValue: 'Laying out {{count}} entities…',
                count: layoutSnapshot.layoutStatusNodes,
              })}
            </span>
          </div>
        )}
        {/* The Focus / collapsed explanation, drawn as an OVERLAY: it must not
            take a row from the toolbar (that moved the canvas' top edge every
            time Focus was pressed) and it must be readable in full, so it
            wraps inside a bounded width instead of truncating. */}
        {readableNotice !== null && (
          <div
            data-architecture-readable-notice="true"
            role="status"
            style={{ position: 'absolute', zIndex: 24, left: 8, top: 8, maxWidth: 'min(78%, 520px)' }}
            className="pointer-events-none rounded-md border border-border/60 bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm"
          >
            {readableNotice}
          </div>
        )}
        {showOverviewHint && (
          <div
            data-architecture-readable-hint="true"
            role="status"
            // An overlay pill, not a row: it must never take height from the
            // drawing (which would move the very fit it is talking about). Its
            // left/top are written by `positionOverviewHint` after the drawing
            // is laid out, so it never covers a package tab; leaving them out of
            // the style object keeps React from resetting the placement on a
            // later render.
            style={{ position: 'absolute', zIndex: 25, maxWidth: '78%' }}
            className="pointer-events-auto flex items-center gap-2 rounded-md border border-border/60 bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm"
          >
            <span className="min-w-0 truncate">{overviewHintText}</span>
            {packageFocus !== null && (
              <button
                type="button"
                data-architecture-readable-back="true"
                onClick={fitDiagram}
                style={clusterTargetStyle}
                className={TOOLBAR_BUTTON_CLASS}
              >
                {t('architecture.plantuml.readable.backToWhole', {
                  defaultValue: 'Back to whole graph',
                })}
              </button>
            )}
          </div>
        )}
        {marqueeRect !== null && (
          <div
            data-architecture-marquee="true"
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
              zIndex: 35,
              pointerEvents: 'none',
              border: '1px dashed #1d4ed8',
              background: 'rgba(29, 78, 216, 0.08)',
            }}
          />
        )}
        {selectionSnapshot.contextMenu !== null && (() => {
          const menu = selectionSnapshot.contextMenu;
          const menuNode = 'nodeId' in menu
            ? graph.nodes.find((candidate) => candidate.id === menu.nodeId) ?? null
            : null;
          const menuEdge = 'edge' in menu ? menu.edge : null;
          const isPinned = menuNode !== null && pinnedSet.has(menuNode.id);
          if (menuNode === null && menuEdge === null) return null;
          return (
            <div
              data-architecture-context-menu="true"
              role="menu"
              aria-label={t('architecture.curation.heading', { defaultValue: 'Adjust' })}
              style={{ position: 'absolute', left: menu.x, top: menu.y, zIndex: 40 }}
              className="flex min-w-40 flex-col rounded-lg border border-border bg-popover p-1 shadow-lg"
            >
              {menuNode !== null && (
                <>
                  {isPinned ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-architecture-context-unpin={menuNode.id}
                      onClick={() => {
                        selectionController.closeContextMenu();
                        onUnpinNode?.(menuNode);
                      }}
                      className="rounded px-2 py-1 text-left text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      {t('architecture.curation.unpin', { defaultValue: 'Unpin' })}
                    </button>
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      data-architecture-context-pin={menuNode.id}
                      onClick={() => {
                        selectionController.closeContextMenu();
                        onPinNode?.(menuNode);
                      }}
                      className="rounded px-2 py-1 text-left text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      {t('architecture.curation.pin', { defaultValue: 'Pin to graph' })}
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    data-architecture-context-remove={menuNode.id}
                    onClick={() => {
                      selectionController.closeContextMenu();
                      onRemoveNode?.(menuNode);
                    }}
                    className="rounded px-2 py-1 text-left text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
                  >
                    {t('architecture.curation.removeEntity', { defaultValue: 'Remove from graph' })}
                  </button>
                  {onPutNodeInChat !== undefined && (
                    <button
                      type="button"
                      role="menuitem"
                      data-architecture-context-put-in-chat={menuNode.id}
                      onClick={() => {
                        selectionController.closeContextMenu();
                        onPutNodeInChat(menuNode);
                      }}
                      className="rounded px-2 py-1 text-left text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      {t('architecture.curation.putInChat', { defaultValue: 'Put in chat input' })}
                    </button>
                  )}
                  {isPinned && onSoloNode !== undefined && (
                    <button
                      type="button"
                      role="menuitem"
                      data-architecture-context-solo={menuNode.id}
                      onClick={() => {
                        selectionController.closeContextMenu();
                        onSoloNode(menuNode);
                      }}
                      className="rounded px-2 py-1 text-left text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      {t('architecture.curation.solo', { defaultValue: 'Show only this' })}
                    </button>
                  )}
                </>
              )}
              {menuEdge !== null && (
                <button
                  type="button"
                  role="menuitem"
                  data-architecture-context-hide={menuEdge.from}
                  onClick={() => {
                    selectionController.closeContextMenu();
                    onHideRelation?.(menuEdge);
                  }}
                  className="rounded px-2 py-1 text-left text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
                >
                  {t('architecture.curation.hideRelation', { defaultValue: 'Hide relation' })}
                </button>
              )}
            </div>
          );
        })()}
        <div
          data-architecture-canvas-overlays="true"
          data-architecture-bottom-corner={cornerLayout.direction}
          // The arrangement is stated inline rather than in utility classes:
          // "one absolute slot, positive gap, map before cluster" is what
          // makes the two boxes unable to intersect, and a test can read it
          // without a laid-out browser (the same reason the zoom targets carry
          // inline sizes). The inset/direction come from the shared
          // `bottomCornerLayout` the selection pill's slot is measured against.
          style={{
            position: 'absolute',
            bottom: cornerLayout.inset,
            right: cornerLayout.inset,
            display: 'flex',
            // A phone spends one ROW on the corner chrome: the collapsed
            // minimap button and the zoom cluster sit side by side, bottom
            // aligned, so the pair takes ~52px of height instead of a 204px
            // column covering the drawing's right edge. The fine-pointer tier
            // keeps its stacked column.
            flexDirection: cornerLayout.direction,
            alignItems: 'flex-end',
            rowGap: BOTTOM_SLOT_GAP_PX,
            columnGap: cornerLayout.direction === 'row' ? cornerLayout.gap : 0,
          }}
          className="z-20 pointer-events-none"
        >
          <ArchitectureMinimap
            hostRef={hostRef}
            // A new drawing, and every semantic rewrite, is a new set of node
            // rectangles; the same drawing re-fitted or panned only moves the
            // range frame.
            revision={`${layoutSnapshot.drawnRevision}:${layoutSnapshot.semanticTier ?? ''}`}
            // In semantic mode the SVG is already sized in mapped screen
            // units, so the drawing's scale is 1 — the non-linear map lives in
            // the geometry, not in the minimap's arithmetic.
            scale={layoutSnapshot.semanticCapture !== null ? 1 : zoom.scale}
          />
          {/* The zoom cluster floats at the bottom right OF the drawing: the
              three controls act on it, so they stay next to it instead of in
              the toolbar. The scale reading and the semantic tier live in the
              row above the canvas, not here — the cluster is only buttons. */}
          <div
            role="group"
            aria-label={zoomGroupLabel}
            data-architecture-zoom-cluster="true"
            // A phone draws ONE horizontal row (+, −, Fit, then the scale and
            // the level label as small text): 44px buttons + 4px padding a side
            // make the row exactly 52px tall. The fine-pointer tier keeps the
            // compact vertical cluster beside the drawing. The landscape-phone
            // tier trims the row to the 44px targets themselves (no extra
            // band) because its height budget is the whole point of the tier.
            style={{
              gap: shortTouch ? 4 : touchUi ? TOUCH_CONTROL_GAP_PX : 4,
              flexDirection: touchUi ? 'row' : 'column',
              height: portraitClusterCollapsed
                ? '44px'
                : shortTouch
                  ? '44px'
                  : touchUi
                    ? '52px'
                    : undefined,
            }}
            className={`pointer-events-auto flex items-center rounded-lg border border-border/60 bg-background/90 shadow-sm ${touchUi ? 'p-0' : 'flex-col p-1'}`}
          >
            {portraitClusterCollapsed ? (
              // ONE 44px button by default. It states the same percentage the
              // expanded row does, so the collapsed form is still a reading,
              // and it is the only corner control that can touch the drawing —
              // which the host's reserved band keeps it from doing.
              <button
                type="button"
                aria-expanded={false}
                aria-label={t('architecture.plantuml.zoomControls.show', {
                  defaultValue: 'Show zoom controls',
                })}
                onClick={() => layoutPipeline.expandCluster()}
                data-architecture-zoom-cluster-toggle="true"
                // The collapsed form IS the cluster's percentage reading on the
                // portrait tier; state it under the same attribute the expanded
                // span uses so a reading never depends on which form is shown.
                data-architecture-zoom-cluster-level="true"
                style={TOUCH_TARGET_STYLE}
                className={TOOLBAR_BUTTON_CLASS}
              >
                {Math.round(displayScale * 100)}%
              </button>
            ) : (
              <>
                {zoomInButton}
                {zoomOutButton}
                {fitButton}
                {/* On the compact tier the tier bar above the canvas is not on
                    screen, so the cluster IS the one place the scale is stated.
                    On the desktop tier the in-flow row states it and this span
                    is not drawn at all — one drawing, one percentage. */}
                {(readoutInCluster || duplicateReadout) && (
                  <span
                    data-architecture-zoom-cluster-level="true"
                    className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground"
                  >
                    {Math.round(displayScale * 100)}%
                  </span>
                )}
                {layoutSnapshot.lodDepth !== null && (
                  <span data-architecture-lod-label className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground">
                    {layoutSnapshot.lodDepth === 2
                      ? t('architecture.plantuml.lod.tierNames', { defaultValue: 'Names' })
                      : layoutSnapshot.lodDepth === 1
                        ? t('architecture.plantuml.lod.tierFrames', { defaultValue: 'Frames' })
                        : t('architecture.plantuml.lod.tierPackages', { defaultValue: 'Packages' })}
                  </span>
                )}
                {portraitPhone && (
                  // The way back to the small form, stated as its own 44px
                  // target so it is never mistaken for a zoom-out step.
                  <button
                    type="button"
                    aria-expanded
                    aria-label={t('architecture.plantuml.zoomControls.hide', {
                      defaultValue: 'Hide zoom controls',
                    })}
                    onClick={() => layoutPipeline.collapseCluster()}
                    data-architecture-zoom-cluster-collapse="true"
                    style={TOUCH_TARGET_STYLE}
                    className={TOOLBAR_BUTTON_CLASS}
                  >
                    ▾
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {failure !== null && (
        <p data-architecture-plantuml-error="true" role="alert" className="px-4 pb-2 text-xs text-destructive">
          {t('architecture.plantuml.error', { defaultValue: 'The diagram could not be rendered: {{message}}', message: failure })}
        </p>
      )}
    </div>
  );
}

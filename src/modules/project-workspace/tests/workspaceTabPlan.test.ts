import assert from 'node:assert/strict';

import { test } from 'vitest';

import { planWorkspaceTabs } from '@/modules/project-workspace/utils/workspaceTabPlan';
import type { WorkspaceTabMeasure } from '@/modules/project-workspace/utils/workspaceTabPlan';

/** A tab 100px wide with its word, 34px as an icon. */
const tab = (id: string): WorkspaceTabMeasure => ({ id, fullWidth: 100, iconWidth: 34 });

const BUILT_INS = ['chat', 'quay', 'architecture', 'files', 'git', 'browser', 'tasks', 'shell'].map(tab);
const WITH_PLUGINS = [...BUILT_INS, tab('plugin:a'), tab('plugin:b')];

test('a room wider than every tab spelled keeps the full layout', () => {
  // 8 tabs: 8 chrome + 800 + 14 gaps = 822, plus the 4px slack.
  const plan = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'chat', available: 826 }, null);
  assert.equal(plan.level, 'full');
  assert.equal(plan.overflowIds.length, 0);
  assert.equal(plan.labelledIds.length, 8);
});

test('labels return in fixed priority order, never by display order', () => {
  // Icons with the active label = 8 + 100 + 7*34 + 14 = 360; each label adds 66.
  const plan = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'architecture', available: 360 + 66 * 2 + 4 }, null);
  assert.equal(plan.level, 'partial');
  // Active first, then chat and quay by priority — not the tabs that happen to sit next to it.
  assert.deepEqual(plan.labelledIds, ['chat', 'quay', 'architecture']);
});

test('the labelled set is a priority prefix: a label that does not fit stops the fill', () => {
  // Room for one extra label only: chat, not the cheaper-to-fit later tabs.
  const plan = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'shell', available: 360 + 66 + 4 }, null);
  assert.deepEqual(plan.labelledIds, ['chat', 'shell']);
});

test('only the active tab is spelled when there is room for icons but no extra label', () => {
  const plan = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'git', available: 360 + 4 }, null);
  assert.equal(plan.level, 'icon');
  assert.deepEqual(plan.labelledIds, ['git']);
});

test('tabs leave for the overflow from the least important end and the active tab never does', () => {
  // 3 visible: 8 + (100 + 34 + 34) + 3 slots' gaps 6 + overflow trigger 34 = 216.
  const plan = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'shell', available: 216 + 4 }, null);
  assert.equal(plan.level, 'overflow');
  assert.deepEqual(plan.labelledIds, ['shell']);
  // Visible: shell (active), chat, quay. Everything else is named in the menu.
  assert.deepEqual(plan.overflowIds, ['architecture', 'files', 'git', 'browser', 'tasks']);
});

test('the active tab stays on the strip even when it alone does not fit', () => {
  const plan = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'tasks', available: 50 }, null);
  assert.equal(plan.overflowIds.includes('tasks'), false);
  assert.equal(plan.overflowIds.length, 7);
});

test('plugin tabs rank after every built-in tab and keep their display order', () => {
  // Icons with the active label, everything visible, plus the divider (9) = 8 + 100 + 9*34 + 18 + 9 = 441.
  const plan = planWorkspaceTabs({ tabs: WITH_PLUGINS, activeId: 'chat', available: 441 - 1 }, null);
  assert.equal(plan.level, 'overflow');
  assert.deepEqual(plan.overflowIds.at(-1), 'plugin:b');
  assert.ok(!plan.overflowIds.includes('chat'));
});

test('an unmeasured room or unmeasured tabs is "not laid out yet", never "no room"', () => {
  assert.equal(planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'chat', available: 0 }, null).level, 'full');
  const zero = BUILT_INS.map((t) => ({ ...t, fullWidth: 0, iconWidth: 0 }));
  assert.equal(planWorkspaceTabs({ tabs: zero, activeId: 'chat', available: 300 }, null).level, 'full');
});

test('a richer layout than the one on screen needs 12px more room; a poorer one applies at once', () => {
  const full = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'chat', available: 826 }, null);
  const narrower = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'chat', available: 825 }, full);
  assert.notEqual(narrower.level, 'full', 'one pixel short of the full strip downgrades immediately');

  const held = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'chat', available: 826 }, narrower);
  assert.notEqual(held.level, 'full', 'the boundary again must not flip straight back');
  const upgraded = planWorkspaceTabs({ tabs: BUILT_INS, activeId: 'chat', available: 826 + 12 }, narrower);
  assert.equal(upgraded.level, 'full');
});

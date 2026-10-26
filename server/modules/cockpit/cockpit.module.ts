/**
 * The cockpit module's composition entry: the hub wired to the two seams it cannot own.
 *
 * `server/index.ts` builds this ONCE and hands the returned hub to the websocket gateway; the
 * hub is then the process-wide cockpit state, the same way the UI-client registry is the
 * process-wide device listing. The seams live at the composition root because the hub is a
 * leaf: it must not import the session-send or fleet-registry modules (AC-394 keeps new
 * feature directories as leaves), so those are injected instead of reached.
 */

import express, { type Router } from 'express';

import { createCockpitCardActions } from '@/modules/cockpit/cockpit-card-actions.js';
import type { CockpitCardActions } from '@/modules/cockpit/cockpit-card-actions.js';
import { createCockpitCardRegistry } from '@/modules/cockpit/cockpit-card-registry.js';
import type { CockpitCardRegistry } from '@/modules/cockpit/cockpit-card-registry.js';
import { createCockpitFixtureCardProvider } from '@/modules/cockpit/cockpit-fixture-card-provider.js';
import { createCockpitHub } from '@/modules/cockpit/cockpit-hub.service.js';
import type { CockpitHub, CockpitHubDeps } from '@/modules/cockpit/cockpit-hub.service.js';
import type { ICockpitActionExecutor, ICockpitCardProvider } from '@/shared/interfaces.js';

/** Everything the composition root can supply to the cockpit hub. */
export type CockpitModuleDeps = CockpitHubDeps;

/**
 * Builds the process-wide cockpit hub. Consumed by `server/index.ts`, which binds the target
 * lookup to the fleet registry + last-opened pointer and the send to the shared chat control
 * service, then hands the hub to `createWebSocketServer`.
 */
export function createCockpitModule(deps: CockpitModuleDeps = {}): CockpitHub {
  return createCockpitHub(deps);
}

/**
 * Everything the composition root supplies to the card module.
 *
 * `fixtureCards` is the server settings file's `cockpit.fixtureCards` switch; it
 * is REQUIRED so a caller states the feature's state instead of inheriting a
 * default that could expose fixture data by omission. Extra providers and
 * executors are injected (the fleet adapter will arrive that way), which is what
 * keeps this module a leaf that never imports a sibling feature directory.
 */
export type CockpitCardsModuleDeps = {
  fixtureCards: boolean;
  providers?: readonly ICockpitCardProvider[];
  executors?: readonly ICockpitActionExecutor[];
};

/** The card module's three readings: the registry, the action channel, and its thin router. */
export type CockpitCardsModule = {
  registry: CockpitCardRegistry;
  actions: CockpitCardActions;
  router: Router;
};

/**
 * Builds the card registry, its action channel and the HTTP face.
 *
 *   GET  /api/cockpit/cards          — every open card, in provider order
 *   POST /api/cockpit/cards/confirm  — { cardId, revision, optionId | replyText }
 *
 * The routes only parse transport input and forward errors; every guard lives in
 * `cockpit-card-actions.ts`, and every ordering/visibility rule in
 * `cockpit-card-registry.ts`. The router is mounted by `server/index.ts` under
 * the same authenticated `/api` tree as the rest of the cockpit's surfaces.
 */
export function createCockpitCardsModule(deps: CockpitCardsModuleDeps): CockpitCardsModule {
  const providers: ICockpitCardProvider[] = [...(deps.providers ?? [])];
  const executors: ICockpitActionExecutor[] = [...(deps.executors ?? [])];

  if (deps.fixtureCards) {
    const fixture = createCockpitFixtureCardProvider();
    providers.push(fixture.provider);
    executors.push(fixture.executor);
  }

  const registry = createCockpitCardRegistry(providers);
  const actions = createCockpitCardActions({ registry, executors });

  const router = express.Router();
  router.get('/', (_req, res, next) => {
    registry.listCards().then((cards) => res.json({ cards }), next);
  });
  router.post('/confirm', (req, res, next) => {
    actions.confirm(req.body).then((result) => res.json(result), next);
  });

  return { registry, actions, router };
}

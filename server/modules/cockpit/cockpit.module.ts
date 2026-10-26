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
import { createCockpitBriefService } from '@/modules/cockpit/cockpit-brief.service.js';
import type { CockpitBriefDeps } from '@/modules/cockpit/cockpit-brief.service.js';
import { fallbackResult, noTokens } from '@/modules/cockpit/cockpit-brief-result.js';
import type { CockpitCard } from '@/shared/types.js';
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
  /**
   * The brief service's seams. They live at the composition root for the same leaf reason as the
   * hub's: the module must not import the gateway, observation or database modules. Omitted in a
   * criterion or a bare boot, where the route then answers a named fallback instead of throwing.
   */
  briefDeps?: CockpitBriefDeps;
};

/** The card module's readings: the registry, the action channel, and its thin router. */
export type CockpitCardsModule = {
  registry: CockpitCardRegistry;
  actions: CockpitCardActions;
  router: Router;
};

/** The session a `cloudcli.session-ask` content ref names; `ref` is `sessionId[#messageId]`. */
function briefTarget(card: CockpitCard): { sessionId: string; messageId?: string } | null {
  const contentRef = card.contentRef;
  if (contentRef?.resolver !== 'cloudcli.session-ask') return null;
  const ref = contentRef.ref ?? '';
  const separator = ref.indexOf('#');
  const sessionId = separator < 0 ? ref : ref.slice(0, separator);
  if (sessionId === '') return null;
  const messageId = separator < 0 ? '' : ref.slice(separator + 1);
  return messageId === '' ? { sessionId } : { sessionId, messageId };
}

/**
 * The fallback a card with no session-ask content ref gets. A card provider may ship a card whose
 * content lives elsewhere; the brief route never invents a session for it, it says so.
 */
function unsupportedBrief(card: CockpitCard) {
  return fallbackResult({
    identity: {
      cardId: card.id,
      sessionId: '',
      askId: null,
      revision: null,
      messageId: null,
      question: card.ask ?? null,
      itemRef: `cloudcli://card/${card.id}`,
    },
    reason: 'unsupported-content',
    rounds: 0,
    failures: [],
    tokens: noTokens(),
    durationMs: 0,
  });
}

/**
 * Builds the card registry, its action channel and the HTTP face.
 *
 *   GET  /api/cockpit/cards          — every open card, in provider order
 *   GET  /api/cockpit/cards/:id/brief — the card's BriefSpec, or the default brief + reason
 *   POST /api/cockpit/cards/confirm  — { cardId, revision, optionId | replyText }
 *
 * The routes only parse transport input and forward errors; every guard lives in
 * `cockpit-card-actions.ts`, every ordering/visibility rule in `cockpit-card-registry.ts`, and
 * every generation/budget rule in `cockpit-brief.service.ts`. The router is mounted by
 * `server/index.ts` under the same authenticated `/api` tree as the rest of the cockpit's
 * surfaces.
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
  const brief = createCockpitBriefService(deps.briefDeps ?? {});

  const router = express.Router();
  router.get('/', (_req, res, next) => {
    registry.listCards().then((cards) => res.json({ cards }), next);
  });
  router.get('/:id/brief', (req, res, next) => {
    registry.getCard(req.params.id).then(async (card) => {
      if (card === null) {
        res.status(404).json({ error: 'card-not-found', cardId: req.params.id });
        return;
      }
      const target = briefTarget(card);
      if (target === null) {
        res.json(unsupportedBrief(card));
        return;
      }
      res.json(await brief.briefFor({ cardId: card.id, ...target }));
    }, next);
  });
  router.post('/confirm', (req, res, next) => {
    actions.confirm(req.body).then((result) => res.json(result), next);
  });

  return { registry, actions, router };
}

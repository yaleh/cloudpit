/**
 * The cockpit module's composition entry: the hub wired to the two seams it cannot own.
 *
 * `server/index.ts` builds this ONCE and hands the returned hub to the websocket gateway; the
 * hub is then the process-wide cockpit state, the same way the UI-client registry is the
 * process-wide device listing. The seams live at the composition root because the hub is a
 * leaf: it must not import the session-send or fleet-registry modules (AC-394 keeps new
 * feature directories as leaves), so those are injected instead of reached.
 */

import { randomBytes } from 'node:crypto';

import express, { type Router } from 'express';

import {
  createCockpitCardActions,
  createCockpitCardFeedbackStore,
  createCockpitCardRegistry,
  createCockpitFixtureCardProvider,
  createCockpitKnowledgeAuthority,
  type CockpitCardActions,
  type CockpitCardFeedbackStore,
  type CockpitCardRegistry,
  type CockpitExecutorResolver,
  type CockpitFixtureFeedbackSettings,
} from '@/modules/cockpit/cards/index.js';
import { createCockpitHub } from '@/modules/cockpit/cockpit-hub.service.js';
import type { CockpitHub, CockpitHubDeps } from '@/modules/cockpit/cockpit-hub.service.js';
import {
  createCockpitBriefService,
  fallbackResult,
  noTokens,
  type CockpitBriefDeps,
  type CockpitBriefResult,
} from '@/modules/cockpit/brief/index.js';
import type {
  CockpitBriefBlock,
  CockpitBriefEvidence,
  CockpitBriefOption,
  CockpitBriefRecommendation,
  CockpitBriefResponse,
  CockpitCard,
  CockpitFixtureSubject,
} from '@/shared/types.js';
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
  /**
   * The settings file's `cockpit.fixtureSubject`: the subject every fixture card is
   * given so an isolated instance's DoD can point the fixture at a copied-but-idle
   * conversation or project. Honoured only together with `fixtureCards`.
   */
  fixtureSubject?: CockpitFixtureSubject;
  providers?: readonly ICockpitCardProvider[];
  executors?: readonly ICockpitActionExecutor[];
  /**
   * The fixture's feedback protocol behaviour (the DoD switches it between `closed`, `none`,
   * `kept` and `rejected`). Honoured only together with `fixtureCards`.
   */
  fixtureFeedback?: Partial<CockpitFixtureFeedbackSettings>;
  /**
   * Where the feedback overlay persists. Omitted keeps it in memory — which is what a criterion
   * wants; `server/index.ts` passes Cloudpit's own file so a refresh/restart keeps the overlay.
   */
  feedbackFilePath?: string | null;
  /** A store the caller already built (a criterion reads it after a request). */
  feedbackStore?: CockpitCardFeedbackStore;
  /**
   * The brief service's seams. They live at the composition root for the same leaf reason as the
   * hub's: the module must not import the gateway, observation or database modules. Omitted in a
   * criterion or a bare boot, where the route then answers a named fallback instead of throwing.
   */
  briefDeps?: CockpitBriefDeps;
  /**
   * The HMAC secret behind a knowledge suggestion's confirmation reference. Omitted mints a
   * fresh per-process secret: a reference issued by one boot is then not accepted by the next,
   * and the card's next read simply issues a new one. A criterion pins it to reproduce a token.
   */
  knowledgeSecret?: string;
};

/**
 * A provider that can also hand back the implementations for the executors it DECLARES.
 *
 * The quay-fleet declaration set is an async child read, so its executors cannot exist when this
 * module is constructed. Such a provider states the capability structurally (the same discovery
 * shape as `diagnostics()`); the action channel asks it only for an id the registry already
 * reported as declared.
 */
type ICockpitExecutorResolverProvider = {
  resolveExecutor(id: string): ReturnType<CockpitExecutorResolver>;
};

function hasExecutorResolver(
  provider: ICockpitCardProvider,
): provider is ICockpitCardProvider & ICockpitExecutorResolverProvider {
  return (
    typeof (provider as Partial<ICockpitExecutorResolverProvider>).resolveExecutor === 'function'
  );
}

/** The card module's readings: the registry, the action channel, and its thin router. */
export type CockpitCardsModule = {
  registry: CockpitCardRegistry;
  actions: CockpitCardActions;
  router: Router;
  /**
   * One card's BriefSpec (or the deterministic fallback), or `null` when no open
   * card carries that id. This is the SAME body `GET /api/cockpit/cards/:id/brief`
   * answers, extracted so the MCP gateway's `cockpit_card_brief` tool reads the
   * one generation path instead of a second copy — fixture briefs, the
   * unsupported-content fallback and the service's cache/ledger included.
   *
   * Consumers: the card router (below) and `server/index.ts`, which hands it to
   * `createMcpGatewayModule` as `cockpitTools.briefForCard`.
   */
  briefForCard(cardId: string): Promise<CockpitBriefResponse | null>;
  /**
   * The feedback lifecycle's store. `server/index.ts` keeps it for the shutdown flush; the MCP
   * face does not read it (the card route already carries the merged overlay).
   */
  feedbackStore: CockpitCardFeedbackStore;
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
 * The four tolerant readers the mapper needs. `brief` is untrusted input on the generated path
 * (the checker proved the shape but the document is still `Record<string, unknown>`), so the
 * mapper states one safe reading per field instead of casting the whole record.
 */
function briefRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function briefList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function briefText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function briefNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Flattens a service result into the wire response the client's `CockpitBriefResponse` declares.
 *
 * The service keeps the brief as a `Record` (it is model output until the checker accepts it);
 * the route is the one place that turns it into the typed wire shape, so the client never parses
 * an untyped document. A missing recommendation becomes `null` rather than an empty object: the
 * renderer shows nothing, not an option with no id.
 */
function toBriefResponse(result: CockpitBriefResult): CockpitBriefResponse {
  const brief = result.brief;
  const recommendation = briefRecord(brief.recommendation);
  return {
    cardId: result.cardId,
    sessionId: result.sessionId,
    askId: result.askId,
    revision: result.revision,
    messageId: result.messageId,
    status: result.status,
    reason: result.reason,
    cached: result.cached,
    question: result.question,
    rounds: result.rounds,
    durationMs: result.durationMs,
    failures: result.failures,
    tokens: result.tokens,
    v: briefNumber(brief.v),
    itemRef: briefText(brief.itemRef) || `cloudcli://card/${result.cardId}`,
    headline: briefText(brief.headline),
    ...(brief.fallback === true ? { fallback: true } : {}),
    options: briefList(brief.options) as CockpitBriefOption[],
    recommendation:
      briefText(recommendation.optionId) === ''
        ? null
        : (recommendation as unknown as CockpitBriefRecommendation),
    evidence: briefList(brief.evidence) as CockpitBriefEvidence[],
    blocks: briefList(brief.blocks) as CockpitBriefBlock[],
  };
}

/**
 * Builds the card registry, its action channel and the HTTP face.
 *
 *   GET  /api/cockpit/cards          — every open card, in provider order
 *   GET  /api/cockpit/cards/:id/brief — the card's BriefSpec, or the default brief + reason
 *   POST /api/cockpit/cards/confirm  — { cardId, revision, optionId | replyText }
 *   POST /api/cockpit/cards/dismiss  — { cardId, revision }: discard without sending anything
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

  // The fixture provider also answers the brief route for its own cards. Keeping the reader in a
  // local means a deployment without fixture cards cannot accidentally expose a fixed brief.
  let fixtureBriefFor: ((card: CockpitCard) => CockpitBriefResponse | null) | null = null;
  if (deps.fixtureCards) {
    const fixture = createCockpitFixtureCardProvider({
      subject: deps.fixtureSubject,
      ...(deps.fixtureFeedback === undefined ? {} : { feedback: deps.fixtureFeedback }),
    });
    providers.push(fixture.provider);
    executors.push(fixture.executor, fixture.feedbackExecutor);
    fixtureBriefFor = fixture.brief;
  }

  // The feedback overlay is Cloudpit's own lifecycle state. It is built here, once per module,
  // so both the read route and the resend command reach the same one.
  const feedbackStore =
    deps.feedbackStore ??
    createCockpitCardFeedbackStore({ filePath: deps.feedbackFilePath ?? null });

  const registry = createCockpitCardRegistry(providers);
  // Late-bound implementations: only providers that opted into the capability are asked, and the
  // action channel asks only after its own declared-executor check.
  const resolverProviders = providers.filter(hasExecutorResolver);
  const resolveExecutor: CockpitExecutorResolver | undefined =
    resolverProviders.length === 0
      ? undefined
      : async (id) => {
          for (const provider of resolverProviders) {
            const found = await provider.resolveExecutor(id);
            if (found !== null) return found;
          }
          return null;
        };
  // A provider that can drop its read cache states the capability structurally (the same
  // discovery shape as `diagnostics`); the action channel re-reads through the registry after
  // asking every such provider to forget the stale batch.
  const refreshable = providers.filter(
    (
      provider,
    ): provider is ICockpitCardProvider & {
      refreshCards(): void;
    } => typeof (provider as { refreshCards?: unknown }).refreshCards === 'function',
  );
  const refreshCards =
    refreshable.length === 0
      ? undefined
      : (): void => {
          for (const provider of refreshable) provider.refreshCards();
        };
  const knowledge = createCockpitKnowledgeAuthority({
    secret: deps.knowledgeSecret ?? randomBytes(32).toString('hex'),
  });
  const actions = createCockpitCardActions({
    registry,
    executors,
    feedbackStore,
    knowledge,
    ...(refreshCards === undefined ? {} : { refreshCards }),
    ...(resolveExecutor === undefined ? {} : { resolveExecutor }),
  });
  const brief = createCockpitBriefService(deps.briefDeps ?? {});

  /**
   * The brief reading for one card id, shared by the HTTP route and the MCP
   * gateway's `cockpit_card_brief` tool. `null` means "no open card with this
   * id"; every other outcome is a response — a fixture card's fixed brief, the
   * deterministic unsupported-content fallback, or the service's generated one.
   */
  const briefForCard = async (cardId: string): Promise<CockpitBriefResponse | null> => {
    const card = await registry.getCard(cardId);
    if (card === null) return null;
    // Fixture cards answer a fixed, gateway-free brief so a real page can draw every preset.
    const fixtureBrief = fixtureBriefFor?.(card) ?? null;
    if (fixtureBrief !== null) return fixtureBrief;
    const target = briefTarget(card);
    if (target === null) return toBriefResponse(unsupportedBrief(card));
    return toBriefResponse(await brief.briefFor({ cardId: card.id, ...target }));
  };

  const router = express.Router();
  router.get('/', (_req, res, next) => {
    registry.listCards().then((cards) => {
      const diagnostics = registry.diagnostics();
      // The overlay is applied LAST and never reorders: a card the person already confirmed keeps
      // the provider's place, gains its status reading, and leaves only when the provider's
      // reading or a matching receipt clears it. A knowledge card is then STAMPED with the
      // confirmation reference its decision must present; minting happens per read, so a card
      // whose content moved without a revision bump still gets a fresh binding.
      const merged = feedbackStore
        .applyCards(cards)
        .map((card) => knowledge.issue(card));
      // The field is omitted when no provider has anything to explain, so a bare deployment's
      // response keeps the exact `{ cards }` shape its callers already read.
      res.json(diagnostics.length === 0 ? { cards: merged } : { cards: merged, diagnostics });
    }, next);
  });
  router.get('/:id/brief', (req, res, next) => {
    briefForCard(req.params.id).then((response) => {
      if (response === null) {
        res.status(404).json({ error: 'card-not-found', cardId: req.params.id });
        return;
      }
      res.json(response);
    }, next);
  });
  router.post('/confirm', (req, res, next) => {
    actions.confirm(req.body).then((result) => res.json(result), next);
  });
  // Discards a card without sending anything back to its conversation: the feedback executor
  // receives `dismiss: true` and the provider closes the item as discarded.
  router.post('/dismiss', (req, res, next) => {
    actions.dismiss(req.body).then((result) => res.json(result), next);
  });
  // Re-sends ONLY the feedback: the person's 2-minute timeout produces this call, not a second
  // confirmation. The action ledger is untouched, so the action cannot run twice.
  router.post('/feedback/resend', (req, res, next) => {
    actions.resendFeedback(req.body).then((result) => res.json(result), next);
  });

  return { registry, actions, router, briefForCard, feedbackStore };
}

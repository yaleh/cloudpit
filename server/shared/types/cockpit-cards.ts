

// ---------------------------
//----------------- COCKPIT CARDS ------------

/**
 * The card kinds this build knows how to render.
 *
 * `CockpitCard.kind` is an OPEN string, so a provider may ship a kind this build
 * does not know: rendering looks the known ones up in a table and never branches
 * on the provider. This union is the known set the two wire ends must agree on
 * (`src/shared/tests/cockpitCardTypeSync.test.ts` reads it on both sides).
 */
export type CockpitCardKind = 'ask' | 'multi' | 'need' | 'stuck' | 'fix' | 'decision';

/**
 * The small visualizations a card's A zone can draw. A fixed vocabulary shared with the
 * descriptor table (`src/modules/cockpit/cockpitCardDescriptors.ts`) and with the provider that
 * states the card, so a provider asks for a shape by name and never names a component.
 */
export type CockpitCardVizKind = 'attempts' | 'steps' | 'history' | 'size' | 'parts';

/** How one attempt in the `attempts` reading ended (or is still going). */
export type CockpitCardVizOutcome = 'landed' | 'failed' | 'running' | 'pending';

/** One attempt the `attempts` reading draws as a dot: when it started and how it ended. */
export type CockpitCardVizAttempt = {
  at: string;
  outcome: CockpitCardVizOutcome;
};

/**
 * The one small visualization a card asks its A zone to draw.
 *
 * `kind` selects the shape from the descriptor table; the other fields are that shape's reading,
 * so the card data stays provider-agnostic. A renderer draws nothing when the card's kind does
 * not match the descriptor's `viz`, which keeps a mislabelled provider from drawing a shape the
 * kind does not stand for.
 */
export type CockpitCardViz = {
  kind: CockpitCardVizKind;
  /** attempts (legacy scalar reading), steps: the 1-based current step; parts: the sub-decision count. */
  count?: number;
  /** attempts: the most dots the row may draw; the provider caps its own list at this too. */
  cap?: number;
  /** attempts: the attempts, NEWEST first; the renderer reverses them to draw old → new. */
  items?: CockpitCardVizAttempt[];
  /** history: the three non-negative weights of the stacked bar (affirmative / negative / other). */
  history?: { yes: number; no: number; other: number };
  /** size: a reading and its ceiling; `total` must be greater than zero. */
  size?: { current: number; total: number };
};

/**
 * Where a card is in its life. Only the PROVIDER moves a card out of `open`
 * (the design's rule: whether a thing is over is the provider's judgement, not
 * the cockpit's), which is why the projection filters on this field alone.
 */
export type CockpitCardState = 'open' | 'resolved' | 'expired';

/** Where an option's recommendation came from: the assistant, the judge, or the provider. */
export type CockpitCardOptionSource = 'assistant' | 'judge' | 'provider';

/** A consequence tag on an option: the fixed-vocabulary kind plus the words shown for it. */
export type CockpitCardTag = {
  kind: string;
  text: string;
};

/** One fact behind a card; `mechanical` distinguishes a fresh measurement from a judgement. */
export type CockpitCardFact = {
  text: string;
  mechanical: boolean;
  ref?: string;
  observedAt?: string;
};

/** How one option would be executed: a DECLARED executor id plus its declared params. */
export type CockpitCardAction = {
  executor: string;
  params: Record<string, unknown>;
};

/**
 * The decision a versioned knowledge suggestion offers the person.
 *
 * The vocabulary is the knowledge-application contract's, not the cockpit's: four ways to answer
 * one proposal. `apply` accepts it as written, `modify` accepts it with one or more changed plan
 * steps, `defer` hands it back for a later review, and `not-applicable` records that the
 * suggestion does not fit this project at all.
 */
export type CockpitKnowledgeDecision = 'apply' | 'modify' | 'defer' | 'not-applicable';

/** Where the provider's knowledge case is after a decision was handed off. */
export type CockpitKnowledgeCaseState =
  | 'pending'
  | 'executing'
  | 'verifying'
  | 'reported'
  | 'blocked'
  | 'unknown';

/**
 * The complete plan one confirmation delivers: what the decision covers, how it will run, and
 * how its outcome will be verified. A decision that changes the project (`apply`/`modify`)
 * cannot be confirmed without all three; a plain `defer`/`not-applicable` carries none.
 */
export type CockpitKnowledgePlan = {
  /** The files/modules/projects the decision is allowed to touch. */
  scope: string[];
  /** The ordered steps the receiving executor will run. */
  steps: string[];
  /** How the outcome will be checked before the case can be reported as done. */
  verification: string;
};

/** The provider's verification reading for a case that has run. */
export type CockpitKnowledgeVerification = {
  state: 'pending' | 'passed' | 'failed' | 'unknown';
  summary: string;
  at?: string;
};

/**
 * One versioned knowledge suggestion's case, as the provider states it.
 *
 * This block is READ-ONLY from the cockpit's point of view: the provider owns the lifecycle
 * (`state`), the current knowledge/proposal revisions, the plan's progress and the verification
 * reading. The one field the cockpit adds is `confirmationRef`, a server-issued, unforgeable
 * reference bound to the card revision and the person's choice; a caller-supplied identity is
 * never accepted as proof of a human decision.
 *
 * A card lacking `caseId`/`proposalRevision` (or naming `knowledgeId` without a usable
 * `knowledgeRevision`) is refused with `KNOWLEDGE_EVIDENCE_MISSING`; a discovery-sourced
 * suggestion states `knowledgeRevision: null` and binds `caseId + proposalRevision` alone.
 */
export type CockpitKnowledgeCase = {
  /** The provider's stable case id; one per suggestion under decision. */
  caseId: string;
  /** The knowledge entry the suggestion came from. */
  knowledgeId?: string;
  /**
   * The knowledge entry's title, exactly as the provider stated it. A card draws it above the
   * case state so the person can read what the suggestion is about before choosing. Omitted
   * when the provider states none — an older card's block is unchanged field for field.
   */
  title?: string;
  /**
   * The knowledge entry revision's full statement text, verbatim from the provider (the
   * revision's Markdown body, not a restatement). Omitted when the provider states none.
   */
  statement?: string;
  /** Version derived from; `null` when discovered (no entry to version yet). */
  knowledgeRevision: number | null;
  /** The version of the proposal itself; both must match what the person saw. */
  proposalRevision: number;
  state: CockpitKnowledgeCaseState;
  /** The plan attached to the proposal (or to the chosen option). */
  plan?: CockpitKnowledgePlan;
  /** What the case is doing now, for the in-progress reading. */
  progress?: { step: string; at?: string };
  /** The provider's execution id once the decision was handed off. */
  executionId?: string;
  /** The provider's verification reading; only the provider writes it. */
  verification?: CockpitKnowledgeVerification;
  /** When the provider expects to report the next state. */
  nextCheckAt?: string;
  /** The conversation the suggestion was discovered in. */
  originSessionId?: string;
  /** The knowledge entry's cockpit address. */
  originUri?: string;
  /** A digest of the evidence the proposal rests on; a change invalidates a stale confirmation. */
  factsFingerprint?: string;
  /**
   * The server-issued confirmation reference. A provider never sets it: the cockpit mints it on
   * read and verifies it on confirm, so a client cannot state its own proof.
   */
  confirmationRef?: string;
};

/** One selectable option on a card. */
export type CockpitCardOption = {
  id: string;
  label: string;
  does: string;
  suggested: boolean;
  source: CockpitCardOptionSource;
  action: CockpitCardAction;
  why?: string;
  warn?: string;
  tags?: CockpitCardTag[];
  undo?: string;
  when?: string;
  /**
   * The text this option's action actually sends back into its session, for the Details
   * drawer's 「✎ 编辑」 shortcut that copies it into the person's own reply. Absent means the
   * option has no such text (a fleet disposal action, for example), so there is nothing to
   * copy and the shortcut is not offered.
   */
  sendText?: string;
  /**
   * Whether this option can be confirmed. The registry sets it to `false` when the option's
   * `action.executor` is not in the declared-executor union; the option stays readable and
   * selectable, but its confirm bar is disabled. Absent means the option is confirmable.
   */
  confirmable?: boolean;
  /** Why the option cannot be confirmed; present exactly when `confirmable` is `false`. */
  confirmableReason?: string;
  /**
   * The knowledge decision this option states. Present only on a knowledge suggestion's
   * options; the confirmation channel refuses a knowledge card whose chosen option carries
   * none, because it cannot know what the person decided.
   */
  decision?: CockpitKnowledgeDecision;
  /** The complete plan this option's decision delivers, when the option states one. */
  plan?: CockpitKnowledgePlan;
};

/** What a card is about; `uri` is the cockpit address of the subject. */
export type CockpitCardSubject = {
  uri: string;
  project?: string;
  sessionId?: string;
  taskId?: string;
  /**
   * The subject's display name — the conversation's title or the task's title — for the
   * card header. A provider that can only address the subject leaves it out; the header then
   * falls back to `taskId` and, last, to the shortened session id.
   */
  title?: string;
};

/** A provider-side reference the local content resolver fills in (content lives locally). */
export type CockpitCardContentRef = {
  resolver: string;
  ref?: string;
};

/**
 * The subject a fixture card is given by the server settings file, for an isolated
 * instance's DoD: the fixture provider is a stand-in for a real fleet provider, and a
 * real one always addresses a conversation or a project. `undefined` fields are left
 * out — an empty object means "no override at all", not "clear every field".
 */
export type CockpitFixtureSubject = {
  sessionId?: string;
  project?: string;
};

/** The executor a free-text reply goes through; the reply text joins its params at call time. */
export type CockpitCardOwnReply = {
  executor: string;
  params: Record<string, unknown>;
};

/** The conversation a card belongs to, or the project a new one would start in. */
export type CockpitCardConversation = {
  sessionId?: string;
  startInProject?: string;
};

/** Whether the provider wants a system notification for this card, and its rule id. */
export type CockpitCardNotify = {
  system: boolean;
  reason: string;
};

/**
 * How a provider answered the feedback it was sent after an action succeeded.
 *
 * `closed` means the item is settled (the card goes away); `kept` means the item is still open
 * but the feedback was accepted; `rejected` means the feedback was refused and the item returns
 * to the person's queue with a reason. `dismissed` answers a dismiss signal (feedback params
 * carrying `dismiss: true`): the provider closed the item as discarded, so the card settles
 * without returning to the queue and without a kept/rejected notice.
 */
export type CockpitCardReceiptDisposition = 'closed' | 'kept' | 'rejected' | 'dismissed';

/** The provider's own acknowledgement that it received a feedback call. */
export type CockpitCardReceipt = {
  /** The `feedbackId` this receipt answers; a receipt for another one changes nothing. */
  feedbackId: string;
  at: string;
  disposition: CockpitCardReceiptDisposition;
  /** Why the feedback was kept/rejected; required reading for `rejected`. */
  reason?: string;
};

/** What the confirmed action did, echoed to the feedback executor and back to the display. */
export type CockpitCardFeedbackOutcome = {
  executor: string;
  ok: boolean;
  /** The conversation the action ran in, when it named one. */
  sessionId?: string;
  /** The delivery id a `session.send` action answered with, when it had one. */
  deliveryId?: string;
};

/**
 * One sent-but-unacknowledged feedback call, as the display reads it.
 *
 * This is Cloudpit's own lifecycle state, not a provider statement: the provider only answers a
 * receipt. The card keeps its place in the provider's order, but its options and confirmation
 * are locked while this overlay exists (the action already ran; only the feedback may be resent).
 */
export type CockpitCardFeedback = {
  cardId: string;
  /** The revision the action was confirmed at (a later card revision does not clear this). */
  revision: number;
  /**
   * The CONTENT revision the card carried when the action was confirmed. The local receipt keeps
   * it so a later read can tell 「the summary this choice was made against was replaced」 even
   * when the provider's own `revision` did not move. Absent for a receipt recorded before this
   * field existed.
   */
  contentRevision?: number;
  /** The idempotency key shared by the original call and every resend. */
  feedbackId: string;
  optionId: string | null;
  /** The option label (or the own reply text) the status line names. */
  label: string;
  sentAt: string;
  outcome: CockpitCardFeedbackOutcome;
  /** False when the provider declares no feedback executor; then only the reason is readable. */
  canResend: boolean;
  resendUnavailableReason?: string;
  /**
   * The readable reason the last feedback CALL failed (the action itself succeeded). Present only
   * while a failure is unacknowledged: a receipt or a successful resend clears it. The card draws
   * it in amber, so the person can tell 「fleet unreachable」 from 「fleet slow」.
   */
  lastError?: string;
  /**
   * The server-issued confirmation reference the action ran under. Kept so the trusted chain is
   * readable back after a reload; a provider never writes it and a caller cannot forge it.
   */
  confirmationRef?: string;
  /** The knowledge decision this confirmation carried, when it was a knowledge card. */
  decision?: CockpitKnowledgeDecision;
  /** The provider case this confirmation belongs to, when it was a knowledge card. */
  knowledgeCaseId?: string;
};

/** A receipt that returned the card to the person, kept beside it until the next confirmation. */
export type CockpitCardFeedbackNotice = {
  cardId: string;
  feedbackId: string;
  kind: 'kept' | 'rejected';
  reason?: string;
};

/** The action a molten decision judged: `kind`/`summary`/`scope` verbatim; `null` means unstated.
 * Matches the fleet's wire, which uses `null` (never `''`) for a field the loop left out. */
export type CockpitMoltenAction = {
  kind: string | null;
  summary: string | null;
  scope: string | null;
};

/**
 * The task a molten decision would crystallise in `project`'s quay store. The four bodies pass to
 * the task file verbatim and `touches` is the file list; none of them is trimmed here.
 */
export type CockpitMoltenTaskSpec = {
  title: string | null;
  proposal: string | null;
  ac: string | null;
  dod: string | null;
  touches: string[];
};

/**
 * One molten short-loop decision (ADR-016), as the fleet states it on a card.
 *
 * `belief` and `evidenceRefs` are string lists; `action` is what the loop judged and `taskSpec`
 * is what `crystallize-task` would write. Absent on every non-molten card, and a molten card
 * carries no `knowledge` block: its confirm goes to `fleet.molten-decide`, never the knowledge
 * executor.
 */
export type CockpitMoltenDecision = {
  proposalId: string | null;
  project: string | null;
  belief: string[];
  action: CockpitMoltenAction;
  taskSpec: CockpitMoltenTaskSpec;
  evidenceRefs: string[];
};

/**
 * One thing waiting for the person, as a provider states it.
 *
 * The cockpit is deliberately ignorant of what a card means: `group`/`rank` are
 * the provider's ordering, `state` is the provider's lifecycle, and `revision`
 * advances only when content or state changes (a reminder-time refresh does not
 * bump it, which is what keeps a focused row in place). The registry passes
 * every field through unchanged.
 */
export type CockpitCard = {
  id: string;
  provider: string;
  revision: number;
  /**
   * The revision of the LOCALLY RESOLVED content (the T1 ask digest) this card's `ask`,
   * `situation` and content options came from. `revision` above is the provider's item revision
   * and does not move when that digest is recomputed; this field does. The display keys its
   * per-content state (shown option, open dropdown, inline expansion) on
   * `(revision, contentRevision)` so a replaced summary resets them. Absent when the card has no
   * locally resolved content.
   */
  contentRevision?: number;
  kind: CockpitCardKind | (string & {});
  group: string;
  rank: number;
  state: CockpitCardState;
  waitingSince: string;
  surfacedAt: string;
  subject: CockpitCardSubject;
  facts: CockpitCardFact[];
  options: CockpitCardOption[];
  contentRef?: CockpitCardContentRef;
  ask?: string;
  situation?: string;
  /**
   * One short verbatim fragment of the assistant's own words, projected from the ask digest.
   * The phone's Details drawer quotes it above the facts. Optional: a card whose digest predates
   * the field (or a provider that never asked) simply has no quote.
   */
  assistantQuote?: string;
  ownReply?: CockpitCardOwnReply;
  /**
   * Why the cockpit could not derive a default own-reply executor for this card: its
   * subject names neither a session nor a project. Set by the projection, never by a
   * provider; the value is the readable reason, and its presence means `ownReply` is
   * absent. A provider that declares `ownReply` itself never gets this field.
   */
  ownReplyUnavailable?: string;
  /**
   * Why the local content resolver could not fill this card: its digest is missing, switched
   * off, unreadable or incomplete. Set only by a provider that resolved a `contentRef`; its
   * presence means the card's `ask`/`situation`/options are the provider's alone and no option
   * is a default. A card whose content was fully filled carries no such field.
   */
  contentUnavailable?: string;
  conversation?: CockpitCardConversation;
  notify?: CockpitCardNotify;
  /**
   * The decision weight the header's three-cell load reading draws, 0–3 (0 = no weight).
   * Absent means the provider stated none, and the header draws no cells at all.
   */
  load?: number;
  /**
   * The optional small visualization the A zone draws, when the known kind's descriptor names
   * one. The renderer consults the descriptor first, so this field is data, not the authority on
   * whether a shape is allowed for the kind.
   */
  viz?: CockpitCardViz;
  /**
   * The provider's acknowledgement of a feedback call. This is the provider's field (the fleet
   * echoes it on the item); the cockpit's own pending overlay is `feedback`, and the two are
   * deliberately separate: a receipt may arrive while the item is still in the reading.
   */
  receipt?: CockpitCardReceipt;
  /**
   * The cockpit's own lifecycle overlay, attached by the server while an action succeeded and
   * no receipt has closed/returned it. Never set by a provider.
   */
  feedback?: CockpitCardFeedback;
  /** A kept/rejected receipt's reading, attached while the card stays in the list. */
  feedbackNotice?: CockpitCardFeedbackNotice;
  /**
   * The versioned knowledge suggestion this card asks the person to decide, when it is one.
   * Absent on every other card; a knowledge card WITHOUT this block is shown but cannot be
   * confirmed (the action channel refuses it as missing evidence).
   */
  knowledge?: CockpitKnowledgeCase;
  /**
   * The molten short-loop decision this card asks the person to sign off, when it is one.
   * Absent on every other card. A card carrying this block renders with the `molten-decision`
   * kind descriptor (its own badge and tone) and routes its confirm to `fleet.molten-decide`; it
   * is NOT a knowledge card and carries no `knowledge` block.
   */
  molten?: CockpitMoltenDecision;
};

/**
 * One provider's own account of its last card read, as `GET /api/cockpit/cards` reports it
 * beside `cards`.
 *
 * A provider that needs no outside world (the fixture) has nothing to explain and reports no
 * diagnostics; an adapter over a child process does. The route attaches these so an empty card
 * list is distinguishable from a failed or switched-off read. The browser must not collapse the
 * two into one reading: a provider that failed is a DEGRADED wall, not a healthy empty one, and
 * the person is owed the reason and a retry.
 *
 * This type is hand-copied into `src/shared/types.ts` for the bundle;
 * `src/shared/tests/cockpitCardTypeSync.test.ts` compares both ends field for field.
 */
export type CockpitCardProviderDiagnostic = {
  readonly provider: string;
  /** Whether the provider's last read produced cards without an error. */
  readonly ok: boolean;
  /** Why the read could not produce cards (or why the provider is off), when that is known. */
  readonly reason: string | null;
  /** How many cards the last read produced. */
  readonly cards: number;
  /** How many malformed lines the last read skipped. */
  readonly skippedLines: number;
  /** Whether this reading was served from the provider's cache. */
  readonly cached: boolean;
  /**
   * Whether the provider salvaged the batch from a stdout that was CUT at the read bound.
   *
   * Present only on a salvaged reading. The cards are real, but the list is known-incomplete:
   * the last line was an unfinished fragment and every byte after it never arrived.
   */
  readonly truncated?: boolean;
  /** How many COMPLETE lines the salvaged prefix held (the fragment is not one of them). */
  readonly completeLines?: number;
  /** Bytes of the cut-off final fragment that could not be parsed; never counted as skipped. */
  readonly truncatedTailBytes?: number;
};


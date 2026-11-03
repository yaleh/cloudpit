/**
 * Session-ask subpackage — barrel.
 *
 * The session-ask lifecycle: the T1 decision digest (`createSessionAskDecisionDigest`), the
 * stored-decision reader the cockpit fleet wiring repairs through
 * (`createSessionAskDecisionReader`), the per-session ask ledger
 * (`createSessionAskLedgerOwner`), the startup/terminal recovery sweep and retraction.
 *
 * Consumers: `modules/observation`'s root barrel, the `session-digest` producer (which composes
 * the ledger, recovery and retraction into one terminal-run producer), and the observation
 * tests. This package imports only the observation `core` subpackage and `server/shared/**`;
 * it never imports `session-digest`, which is what keeps the two subpackages acyclic.
 */
export * from './session-ask-decision-answer.js';
export * from './session-ask-decision-digest.js';
export * from './session-ask-decision-reader.js';
export * from './session-ask-ledger.js';
export * from './session-ask-recovery.js';
export * from './session-ask-retraction.js';

/**
 * The `session-control` module's public face for the knowledge-facts delivery
 * arm: one capability, one read.
 *
 * `knowledge_facts` asks this port to augment a `peer_result` reading. The port
 * answers a `KnowledgePeerDeliveryCorrelation` (see
 * {@link readPeerDeliveryCorrelation}) and merges it into the reading WITHOUT
 * overwriting anything the ordinary ask/answer path already established. The
 * merge is one-directional: a confirmed delivery may fill the reading's
 * `targetSessionId`, `deliveryId` and `correlationId`; a delivery that cannot be
 * confirmed never removes a field the stream had already read.
 *
 * The port carries its own capability sentence so the composition root can tell
 * a consumer whether the arm exists in this build at all — the reading's
 * `deliveryCorrelation: null` means "not asked", and a consumer must probe
 * {@link ISessionControlPeerDelivery.capability} before treating it as
 * "unsupported".
 */
import {
  KNOWLEDGE_PEER_DELIVERY_CAPABILITY,
  knowledgeEvidence,
  type KnowledgePeerResultReading,
} from '@/shared/knowledge-facts.js';

import {
  readPeerDeliveryCorrelation,
  type SessionControlPeerDeliveryDeps,
  type SessionPeerDeliveryInput,
} from './peer-delivery-read.js';
import { dropUnknown, pushUnknownOnce } from './unknown-fields.js';

/** The read port `knowledge_facts` composes; every member is a pure read. */
export interface ISessionControlPeerDelivery {
  readonly capability: typeof KNOWLEDGE_PEER_DELIVERY_CAPABILITY;
  /**
   * Fills the delivery arm of an already-assembled `peer_result` reading.
   * Never throws: a failed chain returns the reading with explicit unknowns, and
   * the failed source is listed in `readErrors`.
   */
  augmentPeerResult(
    reading: KnowledgePeerResultReading,
    input: SessionPeerDeliveryInput,
  ): Promise<KnowledgePeerResultReading>;
}

/** Builds the port over the process's ledger, resident delivery ledger and session store. */
export function createSessionControlPeerDelivery(
  deps: SessionControlPeerDeliveryDeps,
): ISessionControlPeerDelivery {
  return {
    capability: KNOWLEDGE_PEER_DELIVERY_CAPABILITY,

    async augmentPeerResult(reading, input) {
      const block = await readPeerDeliveryCorrelation(
        {
          sourceSessionId: input.sourceSessionId,
          ...(input.peerSession === undefined ? {} : { peerSession: input.peerSession }),
          ...(input.deliveryId === undefined ? {} : { deliveryId: input.deliveryId }),
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        },
        deps,
      );

      const unknown = [...reading.unknown];
      for (const field of block.unknown) pushUnknownOnce(unknown, field);
      const readErrors = [...reading.readErrors, ...block.readErrors];

      let correlation = reading.correlation;
      if (block.delivery.state === 'evidence') {
        const record = block.delivery.value;
        // The saved record named the target, so the reading's `targetSessionId`
        // is established now — even when the ask/answer projection could not.
        dropUnknown(unknown, 'targetSessionId');
        if (correlation.state === 'evidence') {
          correlation = knowledgeEvidence(
            {
              ...correlation.value,
              targetSessionId: record.targetSessionId,
              deliveryId: record.deliveryId,
              correlationId: record.correlationId,
            },
            correlation.source,
            correlation.sourceRef,
            correlation.observedAt,
          );
        }
      }

      return { ...reading, correlation, deliveryCorrelation: block, unknown, readErrors };
    },
  };
}

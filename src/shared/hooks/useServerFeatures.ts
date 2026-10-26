import { useEffect, useSyncExternalStore } from 'react';

import { api } from '@/shared/api';
import type { ServerFeatures } from '@/shared/types';

/**
 * The browser's reading of the server-level feature switches.
 *
 * WHY AN EXTERNAL STORE. The sidebar's mode switch, the project/session rows, the command
 * palette and the cockpit route guard all need the same answer, and they mount in different
 * parts of the tree. One shared reading means one request and one answer, so two surfaces can
 * never disagree about whether the cockpit is on.
 *
 * FAIL CLOSED. The cockpit ships off, so the initial reading and every failure ("the server
 * did not answer", "it answered something that is not JSON", "it predates this endpoint")
 * leave `cockpitEnabled` false. That is what keeps a release from exposing the cockpit because
 * a request failed, not because an operator enabled it. The value is boot-static; there is no
 * polling and no retry that could flip it later in the session.
 *
 * THE LOAD IS LAZY. The first mounted consumer starts the one request. A page with no cockpit
 * entry point (the standalone architecture view) never asks.
 *
 * Consumers: `SidebarModeSwitch`, `SidebarProjectItem`, `SidebarSessionItem`,
 * `CommandPalette`, `CockpitRoute` and `ViewEventInstrumentation`.
 */

/** The reading a consumer branches on. `loading` is deliberately indistinguishable from off. */
export type ServerFeaturesReading = {
  /** `loading` only before the first answer; `error` means the answer was absent or unreadable. */
  status: 'loading' | 'loaded' | 'error';
  /** The cockpit switch. False while loading and after any failure. */
  cockpitEnabled: boolean;
};

const INITIAL_READING: ServerFeaturesReading = { status: 'loading', cockpitEnabled: false };

/**
 * Owns the page's one reading of the server-level feature switches.
 *
 * These four pieces of state — `reading`, `listeners`, `inFlight` and `settled` — used to be
 * module-level `let`s and a `Set` operated on by module-level functions: a global mutable
 * singleton with no owner, no lifecycle, and no way to instantiate or inject it. They are a
 * class now, so the state has one explicit owner — the store — and a test can create a fresh
 * one instead of inheriting whatever a previous test left in the module's singleton.
 *
 * The module exports one instance ({@link serverFeaturesStore}) that {@link useServerFeatures}
 * subscribes to. The load is deliberately still triggered by the hook's effect rather than by
 * the first subscriber: a store with a subscriber but no mounted consumer has not asked the
 * server anything yet, and keeping the trigger in the effect is what makes "the first consumer
 * starts the one request" true by construction.
 */
export class ServerFeaturesStore {
  /** The reading every subscriber renders. False toward "off" until an answer arrives. */
  private reading: ServerFeaturesReading = INITIAL_READING;

  /** The components subscribed through `useSyncExternalStore`. */
  private readonly listeners = new Set<() => void>();

  /** The one in-flight request, shared by every consumer that loads concurrently. */
  private inFlight: Promise<void> | null = null;

  /** True once the request has settled; the value cannot change afterwards, so no retry is wanted. */
  private settled = false;

  /** Subscribes one reader and returns its unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The current reading, in the shape `useSyncExternalStore` reads. */
  getSnapshot(): ServerFeaturesReading {
    return this.reading;
  }

  /**
   * Reads the switches once and publishes the outcome; every later call is a no-op.
   *
   * Concurrent callers — the consumers that mount together on a page — share the one request,
   * so the server sees one ask no matter how many surfaces read the answer.
   */
  load(): Promise<void> {
    if (this.settled) {
      return Promise.resolve();
    }
    if (this.inFlight !== null) {
      return this.inFlight;
    }

    this.inFlight = this.readOnce();
    return this.inFlight;
  }

  private async readOnce(): Promise<void> {
    try {
      const response = await api.settings.serverFeatures();
      if (!response.ok) {
        this.publish({ status: 'error', cockpitEnabled: false });
        return;
      }
      const features = (await response.json()) as Partial<ServerFeatures> | null;
      // Exactly `true` enables the feature: a missing block, a string or any other value is
      // "off", the same reading the server applies to a malformed `cockpit.enabled`.
      const cockpitEnabled = features?.cockpit?.enabled === true;
      this.publish({ status: 'loaded', cockpitEnabled });
    } catch {
      // An unreachable or unparsable answer is the same product answer as "off".
      this.publish({ status: 'error', cockpitEnabled: false });
    } finally {
      this.settled = true;
      this.inFlight = null;
    }
  }

  private publish(next: ServerFeaturesReading): void {
    this.reading = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The page's single `ServerFeaturesStore` instance — the one place the shared reading lives.
 *
 * Used by {@link useServerFeatures}; a test that wants to drive the rules directly constructs
 * its own `ServerFeaturesStore` rather than resetting this one.
 */
export const serverFeaturesStore = new ServerFeaturesStore();

function subscribe(listener: () => void): () => void {
  return serverFeaturesStore.subscribe(listener);
}

function getSnapshot(): ServerFeaturesReading {
  return serverFeaturesStore.getSnapshot();
}

/**
 * Used by the surfaces named above to decide whether a cockpit entry point may render.
 *
 * A consumer must treat `loading` as off: rendering the switch and removing it a moment later
 * is exactly the flash a disabled release must not show.
 */
export function useServerFeatures(): ServerFeaturesReading {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void serverFeaturesStore.load();
  }, []);
  return snapshot;
}

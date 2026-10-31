import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import type { LLMProvider, ProviderLifecycleDefault, SessionLifecycleMode } from '@/shared/types';

/**
 * The backend-owned answer to "what can this provider actually do".
 *
 * Only the fields consumers outside chat need are declared; the matrix itself
 * is larger and lives in `provider-capabilities.service.ts`.
 */
type ProviderCapabilityRow = {
  provider: LLMProvider;
  supportsSessionForking?: boolean;
  /**
   * The lifecycle modes the backend says this provider implements. Read as the
   * matrix's own answer — `resident` is a value in this list, not a provider id —
   * so a provider that gains the mode shows the affordance without a UI change.
   */
  lifecycleModes?: string[];
  /**
   * The mode a NEW session of this provider is created with when the caller
   * states none. Separate from {@link lifecycleModes}: implementing resident
   * does not mean it is the default. Mirrors the server's capability row; the
   * frontend never derives a provider's default from its id.
   */
  defaultLifecycleMode?: SessionLifecycleMode;
};

/**
 * Cached at module scope because the matrix is static for the life of the
 * server process and more than one part of the UI asks for it. Without this,
 * opening the sidebar would refetch it on every mount.
 */
let cachedCapabilities: Partial<Record<LLMProvider, ProviderCapabilityRow>> | null = null;
let inFlightRequest: Promise<Partial<Record<LLMProvider, ProviderCapabilityRow>>> | null = null;

async function loadCapabilities(): Promise<Partial<Record<LLMProvider, ProviderCapabilityRow>>> {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }
  if (inFlightRequest) {
    return inFlightRequest;
  }

  inFlightRequest = (async () => {
    try {
      const response = await api.providers.capabilities();
      const body = (await response.json()) as { success?: boolean; data?: { providers?: ProviderCapabilityRow[] } };
      const rows = body.success && Array.isArray(body.data?.providers) ? body.data.providers : [];
      const byProvider: Partial<Record<LLMProvider, ProviderCapabilityRow>> = {};
      for (const row of rows) {
        byProvider[row.provider] = row;
      }
      cachedCapabilities = byProvider;
      return byProvider;
    } catch (error) {
      console.error('Error loading provider capabilities:', error);
      // Not cached: a transient failure should not disable affordances for the
      // rest of the session.
      return {};
    } finally {
      inFlightRequest = null;
    }
  })();

  return inFlightRequest;
}

/**
 * Reports which providers can branch a session's transcript.
 *
 * Empty until the matrix loads, so an affordance is never offered and then
 * withdrawn.
 */
export function useSessionForkingProviders(): Set<LLMProvider> {
  const [providers, setProviders] = useState<Set<LLMProvider>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    void loadCapabilities().then((capabilities) => {
      if (cancelled) return;
      const forkable = new Set<LLMProvider>();
      for (const row of Object.values(capabilities)) {
        if (row?.supportsSessionForking) {
          forkable.add(row.provider);
        }
      }
      setProviders(forkable);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
}

/**
 * Reports which providers can run a session as a resident process.
 *
 * This is the single source of truth for "does this provider get a resident
 * affordance": the sidebar's conversion item and the composer's toggle both read
 * it, so neither branches on a provider id. `provider-capabilities.service.ts`
 * names the matrix as the only statement of what an integration supports, and
 * branching on `claude` here would be the second statement.
 *
 * Empty until the matrix loads — the same "never offer then withdraw" rule the
 * forking hook follows.
 */
export function useResidentProviders(): Set<LLMProvider> {
  const [providers, setProviders] = useState<Set<LLMProvider>>(() => new Set());

  useEffect(() => {
    let cancelled = false;

    void loadCapabilities().then((capabilities) => {
      if (cancelled) return;
      const resident = new Set<LLMProvider>();
      for (const row of Object.values(capabilities)) {
        if (row?.lifecycleModes?.includes('resident')) {
          resident.add(row.provider);
        }
      }
      setProviders(resident);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return providers;
}

/**
 * Reports, per provider, whether `resident` is implemented and which lifecycle
 * mode a new session gets when the caller states none.
 *
 * Used by `ChatInterface` for the new-session switch: the switch is drawn only
 * for a provider whose default is known, and starts in the mode the backend
 * declared — the frontend never derives a provider's default from its id, and a
 * capability response that has not arrived yet yields an empty record (the
 * switch stays hidden rather than guessing).
 *
 * Entries are stable per load, so a controller synced from this record does not
 * see a new object on every render.
 */
export function useProviderLifecycleDefaults(): Partial<Record<LLMProvider, ProviderLifecycleDefault>> {
  const [defaults, setDefaults] = useState<Partial<Record<LLMProvider, ProviderLifecycleDefault>>>(() => ({}));

  useEffect(() => {
    let cancelled = false;

    void loadCapabilities().then((capabilities) => {
      if (cancelled) return;
      const next: Partial<Record<LLMProvider, ProviderLifecycleDefault>> = {};
      for (const row of Object.values(capabilities)) {
        if (!row) continue;
        next[row.provider] = {
          supportsResident: row.lifecycleModes?.includes('resident') === true,
          // A response from before this field existed reads as the behaviour
          // every provider had then; client and server ship together.
          defaultLifecycleMode: row.defaultLifecycleMode === 'resident' ? 'resident' : 'per-run',
        };
      }
      setDefaults(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return defaults;
}

import { createExternalStore } from '@/shared/utils';
import type { LLMProvider, ProviderLifecycleDefault, SessionLifecycleMode } from '@/shared/types';

/**
 * The new-session lifecycle selection: which mode the empty state's switch
 * shows, and which mode the next created session states.
 *
 * THE RULE. The backend decides a provider's default (`defaultLifecycleMode`
 * in the capability matrix); the person gets ONE override for the next
 * brand-new session. With no override the switch shows the provider default and
 * the creation omits the mode, so the server applies the same default it
 * declared. Flipping the switch states an explicit opposite mode on the
 * creation; a successful creation spends the override, so the next new session
 * shows the provider default again.
 *
 * Why a controller rather than `useState` in the page: three paths (the text
 * composer, Live Voice's allocation, and the retry after a failed creation) read
 * the same selection, and two of them run after an `await`. Keeping the
 * decision here — provider, override, and the "did creation succeed" reset in
 * one write path — is what keeps the switch's position and the created row's
 * mode from disagreeing (AC5).
 */

/** The render-facing reading of the selection. */
export type NewSessionLifecycleSnapshot = {
  /** The provider this snapshot resolves for. */
  provider: LLMProvider;
  /** What the switch shows and what the next creation would use; `null` while the default is unknown. */
  mode: SessionLifecycleMode | null;
  /** Whether the switch may be flipped. */
  canToggle: boolean;
};

/** The commands the React binding calls; every write goes through one publish path. */
export type NewSessionLifecycleController = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): NewSessionLifecycleSnapshot;
  /** Hands the current provider and its capability row in; a provider change drops a stale override. */
  syncProvider(provider: LLMProvider, lifecycle: ProviderLifecycleDefault | null): void;
  /** Flips the switch between the provider default and its opposite. */
  toggle(): void;
  /**
   * The mode the next creation should send, or `undefined` to omit it.
   *
   * Omitted when no override is set (the server applies its declared default)
   * and when the override equals that default again.
   */
  lifecycleModeForCreate(): SessionLifecycleMode | undefined;
  /** The creation succeeded: the override was spent and the next new session follows the default. */
  spend(): void;
};

/**
 * Used by `useNewSessionLifecycle` (and, through it, `ChatInterface`) to own
 * the next-new-session lifecycle choice.
 */
export function createNewSessionLifecycleController(
  initialProvider: LLMProvider,
): NewSessionLifecycleController {
  type State = {
    provider: LLMProvider;
    lifecycle: ProviderLifecycleDefault | null;
    /** The person's explicit choice for the next new session, or `null` to follow the provider default. */
    override: SessionLifecycleMode | null;
  };

  const state: State = { provider: initialProvider, lifecycle: null, override: null };
  const store = createExternalStore<NewSessionLifecycleSnapshot>({
    provider: initialProvider,
    mode: null,
    canToggle: false,
  });

  const compute = (): NewSessionLifecycleSnapshot => {
    const defaultMode = state.lifecycle?.defaultLifecycleMode ?? null;
    const mode = state.override ?? defaultMode;
    return {
      provider: state.provider,
      mode,
      // A per-run-only provider cannot honour an override, and a provider whose
      // default has not arrived yet must not offer a choice it cannot resolve.
      canToggle: mode !== null && state.lifecycle?.supportsResident === true,
    };
  };

  const publish = (): void => {
    const next = compute();
    const previous = store.getSnapshot();
    if (
      previous.provider === next.provider
      && previous.mode === next.mode
      && previous.canToggle === next.canToggle
    ) {
      return;
    }
    store.set(next);
  };

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    syncProvider(provider, lifecycle) {
      if (provider !== state.provider) {
        // The switch belongs to ONE provider's next new session; carrying the
        // position across a provider change would state a mode the person chose
        // while looking at a different provider's default.
        state.override = null;
      }
      state.provider = provider;
      state.lifecycle = lifecycle;
      // A stale override for a mode this provider does not implement is dropped
      // rather than sent and refused.
      if (state.override === 'resident' && lifecycle?.supportsResident === false) {
        state.override = null;
      }
      publish();
    },
    toggle() {
      const snapshot = store.getSnapshot();
      if (!snapshot.canToggle || snapshot.mode === null) return;
      state.override = snapshot.mode === 'resident' ? 'per-run' : 'resident';
      publish();
    },
    lifecycleModeForCreate() {
      const defaultMode = state.lifecycle?.defaultLifecycleMode ?? null;
      if (state.override === null || defaultMode === null) return undefined;
      // Flipping off and back on leaves the selection equal to the default;
      // omitting the field keeps "follow the provider's policy" one meaning.
      return state.override === defaultMode ? undefined : state.override;
    },
    spend() {
      state.override = null;
      publish();
    },
  };
}

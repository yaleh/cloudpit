import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

import type { LLMProvider, ProviderModelOption } from "@/shared/types";
import { Badge, CommandGroup, CommandItem, LLMProviderLogo } from "@/shared/ui";
import {
  modelOptionDisplayName,
  readModelOptionProviderId,
  readModelProviderId,
} from "@/shared/utils";

/**
 * One branch of the model picker.
 *
 * `provider` is what selecting a model in this branch sets, kept separate from
 * the branch itself so a branch does not have to be a provider: a catalog whose
 * rows name an upstream provider is grouped by model, and every one of those
 * branches still selects under its own provider.
 */
export type ModelGroup = {
  key: string;
  provider: LLMProvider;
  name: string;
  models: ProviderModelOption[];
};

type ModelGroupListProps = {
  groups: ModelGroup[];
  provider: LLMProvider;
  currentModel: string;
  /**
   * Upstream provider id of the active selection, or absent/null for the bare
   * (inherit-the-provider-default) identity. A built-in model is offered once
   * per provider, so those rows share `currentModel` and only this field tells
   * the ticked one from its variants.
   */
  currentModelProviderId?: string | null;
  loading: boolean;
  /** While searching, every branch is shown open — a hit inside a collapsed one would be invisible. */
  searching: boolean;
  /** Receives the clicked row's full identity: the model id plus the upstream provider it runs under. */
  onSelect: (provider: LLMProvider, model: string, modelProviderId: string | null) => void;
  loadingLabel: string;
};

const STORAGE_KEY = "model-groups-collapsed";

function readCollapsed(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

export default function ModelGroupList({
  groups,
  provider,
  currentModel,
  currentModelProviderId = null,
  loading,
  searching,
  onSelect,
  loadingLabel,
}: ModelGroupListProps) {
  const [collapsedKeys, setCollapsedKeys] = useState<string[]>(readCollapsed);
  const collapsed = useMemo(() => new Set(collapsedKeys), [collapsedKeys]);

  const toggle = useCallback((key: string) => {
    setCollapsedKeys((previous) => (previous.includes(key)
      ? previous.filter((entry) => entry !== key)
      : [...previous, key]));
  }, []);

  // Persisted from an effect, not from the updater: React may run an updater
  // more than once or throw its result away, and only committed state should
  // reach storage.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsedKeys));
    } catch {
      // A closed branch is a convenience; not being able to remember it is no reason to fail.
    }
  }, [collapsedKeys]);

  return (
    <>
      {groups.map((group, index) => {
        const isCollapsed = collapsed.has(group.key) && !searching;

        return (
          <CommandGroup
            key={group.key}
            className={
              index > 0
                ? "border-t border-border/40 [&_[cmdk-group-heading]]:mt-1 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                : "[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
            }
            heading={
              <button
                type="button"
                onClick={() => toggle(group.key)}
                className="flex w-full items-center gap-1.5 text-left hover:text-foreground"
                aria-expanded={!isCollapsed}
                data-model-group-key={group.key}
                data-model-group-provider={group.provider}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3 w-3 shrink-0" />
                ) : (
                  <ChevronDown className="h-3 w-3 shrink-0" />
                )}
                <LLMProviderLogo provider={group.provider} className="h-3.5 w-3.5 shrink-0" />
                {group.name}
                <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                  {group.models.length}
                </span>
              </button>
            }
          >
            {group.models.length === 0 && loading ? (
              <CommandItem disabled className="ml-4 border-l border-border/40 pl-4 text-muted-foreground">
                {loadingLabel}
              </CommandItem>
            ) : null}

            {/*
              A collapsed branch still needs one item: cmdk hides a group whose
              items are all gone, and a vanished heading cannot be clicked open
              again. This row doubles as that click target.
            */}
            {isCollapsed && group.models.length > 0 ? (
              <CommandItem
                value={`${group.name} show`}
                onSelect={() => toggle(group.key)}
                className="ml-4 border-l border-border/40 pl-4 text-[11px] text-muted-foreground"
              >
                {group.models.length} hidden — click to show
              </CommandItem>
            ) : null}

            {!isCollapsed && group.models.map((model) => {
              const providerId = readModelOptionProviderId(model);
              /*
                A bound row says which upstream provider it runs under; an
                unbound row stays bare and inherits the provider's default. The
                server already appends ` · id` to a bound row's label, so the
                name is read without that suffix before this one is composed.
              */
              const modelName = modelOptionDisplayName(model, providerId);
              const rowLabel = providerId === null ? modelName : `${modelName} (${providerId})`;
              const isSelected = provider === group.provider
                && currentModel === model.value
                && readModelProviderId(currentModelProviderId) === providerId;

              return (
                <CommandItem
                  key={`${group.key}-${model.value}-${providerId ?? ""}`}
                  value={`${group.name} ${rowLabel} ${model.value} ${model.description || ""}`}
                  onSelect={() => onSelect(group.provider, model.value, providerId)}
                  className="ml-4 border-l border-border/40 pl-4"
                  data-model-value={model.value}
                  data-model-provider-id={providerId ?? undefined}
                  data-model-selected={isSelected ? "true" : "false"}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{modelName}</span>
                      {providerId !== null && (
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          ({providerId})
                        </span>
                      )}
                      {model.isCustom && (
                        <Badge className="h-4 shrink-0 rounded-full px-1.5 text-[8px]">Custom</Badge>
                      )}
                    </div>
                    {modelName !== model.value && (
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {model.value}
                      </div>
                    )}
                  </div>
                  {isSelected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                </CommandItem>
              );
            })}
          </CommandGroup>
        );
      })}
    </>
  );
}

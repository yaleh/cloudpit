import { useTranslation } from 'react-i18next';

import type { CockpitCardDescriptor } from '@/modules/cockpit/cockpitCardDescriptors';
import { cockpitCardToneClass } from '@/modules/cockpit/cockpitCardDescriptors';
import { cn } from '@/shared/utils';

/**
 * The three-cell decision-weight reading. Only the provider's own `load` fills it; the reading is
 * a count of filled cells out of three, and `0` draws three empty cells because the provider DID
 * state a weight (absence is the only "draw nothing").
 */
function LoadCells({ level, label }: { level: number; label: string }) {
  const filled = Math.min(3, Math.max(0, Math.floor(level)));
  return (
    <span
      data-testid="cockpit-card-load"
      data-load={filled}
      aria-label={label}
      className="flex shrink-0 items-center gap-[3px]"
    >
      {[1, 2, 3].map((cell) => (
        <span
          key={cell}
          data-load-cell={cell}
          data-filled={cell <= filled ? 'true' : 'false'}
          aria-hidden
          className={cn(
            'h-2.5 w-[3px] rounded-sm',
            cell <= filled ? 'bg-foreground' : 'bg-muted-foreground/25',
          )}
        />
      ))}
    </span>
  );
}

export type CockpitCardHeaderProps = {
  /** The provider's kind id, drawn verbatim on the badge's `data-kind`. */
  kind: string;
  /** The descriptor the card's controller already looked up for this kind. */
  descriptor: CockpitCardDescriptor;
  /** The provider's project name; the empty string draws no project span. */
  project: string;
  /** The subject's name, or `null` when the card states none. */
  subjectName: string | null;
  /** The controller's already-formatted waiting duration. */
  age: string;
  /** The provider's decision weight, `undefined` when it stated none. */
  load: number | undefined;
  /** The accessible label for the load reading, already translated by the controller. */
  loadLabel: string;
};

/**
 * The card's header row: kind mark · project · subject name · age · load · `›`.
 *
 * THE HEADER IS THE CARD'S ANATOMY (INTERACTION-PRINCIPLES F.18): every reading drawn here is
 * data the provider stated; a field the card does not carry is simply not drawn. It is a pure
 * presentational block — `CockpitCard` computes the descriptor, the subject name, the age and the
 * load label, and this component only draws them. Used by `CockpitCard` only.
 */
export default function CockpitCardHeader({
  kind,
  descriptor,
  project,
  subjectName,
  age,
  load,
  loadLabel,
}: CockpitCardHeaderProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="cockpit-card-zone-a-header"
      className="flex items-center gap-1.5"
    >
      <span
        data-testid="cockpit-card-kind-badge"
        data-kind={kind}
        data-tone={descriptor.tone}
        title={t(descriptor.labelKey)}
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
          cockpitCardToneClass(descriptor.tone),
        )}
      >
        {t(descriptor.badgeKey)}
      </span>
      {project !== '' && (
        <span
          data-testid="cockpit-card-project"
          className="shrink-0 text-[12px] font-medium text-foreground"
        >
          {project}
        </span>
      )}
      {subjectName !== null && (
        <span
          data-testid="cockpit-card-subject"
          className="min-w-0 truncate text-[12px] text-muted-foreground"
        >
          <span aria-hidden>· </span>
          {subjectName}
        </span>
      )}
      <span
        data-testid="cockpit-card-age"
        className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground"
      >
        {age}
      </span>
      {load !== undefined && <LoadCells level={load} label={loadLabel} />}
      <span aria-hidden className="shrink-0 text-muted-foreground">›</span>
    </div>
  );
}

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { LLMProviderLogo } from '@/shared/ui';
import type { AppTab, Project, ProjectSession } from '@/shared/types';
import { ResidentSessionBadge } from '@/modules/chat';
import { usePlugins } from '@/modules/plugins';
import { getSessionTitle } from '@/shared/utils';

type WorkspaceTitleProps = {
  activeTab: AppTab;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  /** Optional so a caller that only knows about Tasks/Browser keeps compiling; absent means "no Quay tab". */
  shouldShowQuayTab?: boolean;
  /** Optional, absent means "no architecture tab", the same contract as `shouldShowQuayTab`. */
  shouldShowArchitectureTab?: boolean;
  /**
   * The phone layout moves the two compact controls into the title block: the `R ▾` resident
   * button after the title, and the Quay thumbnail after the project name. Absent (desktop) keeps
   * both in their original places — the pill under the project name and the pulse in the right row.
   */
  isMobile?: boolean;
  /** The compact Quay pulse trigger, drawn after the project name on a phone. */
  quayPulse?: ReactNode;
};

function getTabTitle(
  activeTab: AppTab,
  shouldShowTasksTab: boolean,
  shouldShowQuayTab: boolean,
  shouldShowArchitectureTab: boolean,
  t: (key: string) => string,
  pluginDisplayName?: string,
) {
  if (activeTab.startsWith('plugin:') && pluginDisplayName) {
    return pluginDisplayName;
  }

  if (activeTab === 'files') {
    return t('mainContent.projectFiles');
  }

  if (activeTab === 'git') {
    return t('tabs.git');
  }

  if (activeTab === 'tasks' && shouldShowTasksTab) {
    return 'TaskMaster';
  }

  if (activeTab === 'quay' && shouldShowQuayTab) {
    return t('tabs.quay');
  }

  // The tab's own label already carries this fallback; the title cannot read the
  // locale bundle either, so it names the same word rather than `Project`.
  if (activeTab === 'architecture' && shouldShowArchitectureTab) {
    return 'Architecture';
  }

  if (activeTab === 'browser') {
    return t('tabs.browser');
  }

  return t('misc.projectFallback');
}

/** Rendered by WorkspaceHeader to label the workspace with the active session or tab name. */
export default function WorkspaceTitle({
  activeTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  shouldShowQuayTab = false,
  shouldShowArchitectureTab = false,
  isMobile = false,
  quayPulse = null,
}: WorkspaceTitleProps) {
  const { t } = useTranslation();
  const { plugins } = usePlugins();

  const pluginDisplayName = activeTab.startsWith('plugin:')
    ? plugins.find((p) => p.name === activeTab.replace('plugin:', ''))?.displayName
    : undefined;

  const showSessionIcon = activeTab === 'chat' && Boolean(selectedSession);
  const showChatNewSession = activeTab === 'chat' && !selectedSession;

  return (
    <div className="scrollbar-hide flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
      {showSessionIcon && (
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
          <LLMProviderLogo provider={selectedSession?.__provider} className="h-4 w-4" />
        </div>
      )}

      <div className="min-w-0 flex-1">
        {activeTab === 'chat' && selectedSession ? (
          <div className="min-w-0">
            {/* The phone puts the resident entry AFTER the title — a one-letter `R ▾` — because the
                pill cost the title ~40 px of a 155 px line. The title shrinks instead, which the
                design accepts; the button never shrinks. Keyed by session so a switch to another
                session closes the panel rather than carrying it over. */}
            <div className="flex min-w-0 items-center gap-1.5">
              <h2
                title={getSessionTitle(selectedSession)}
                className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight text-foreground"
              >
                {getSessionTitle(selectedSession)}
              </h2>
              {isMobile && (
                <ResidentSessionBadge
                  key={selectedSession.id}
                  sessionId={selectedSession.id}
                  variant="letter"
                />
              )}
            </div>
            {/* The project name and, beside it, the one control that used to share this line: the
                resident pill on desktop, the Quay thumbnail on a phone (its old pill position).
                Both are 11px so the line is one line tall; the name gives way first when the row is
                narrow, because the control is the part that is a control. */}
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
              {isMobile ? quayPulse : <ResidentSessionBadge key={selectedSession.id} sessionId={selectedSession.id} />}
            </div>
          </div>
        ) : showChatNewSession ? (
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight text-foreground">{t('mainContent.newSession')}</h2>
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 truncate text-xs leading-tight text-muted-foreground">{selectedProject.displayName}</div>
              {isMobile && quayPulse}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              {getTabTitle(activeTab, shouldShowTasksTab, shouldShowQuayTab, shouldShowArchitectureTab, t, pluginDisplayName)}
            </h2>
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 truncate text-[11px] leading-tight text-muted-foreground">{selectedProject.displayName}</div>
              {isMobile && quayPulse}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

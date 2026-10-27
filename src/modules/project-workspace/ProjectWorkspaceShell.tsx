import { memo } from 'react';

import { TranscriptExportProvider } from '@/shared/context/TranscriptExportContext';
import ProjectEffects from '@/modules/project-workspace/controllers/ProjectEffects';
import type { ProjectWorkspaceShellProps } from '@/shared/types';
import ProjectCommandPalette from '@/modules/project-workspace/ProjectCommandPalette';
import ProjectMainRegion from '@/modules/project-workspace/ProjectMainRegion';
import ProjectSidebarRegion from '@/modules/project-workspace/ProjectSidebarRegion';
import { CockpitColumnProvider } from '@/modules/cockpit';

/** Rendered by ProjectWorkspaceRoute to lay out the workspace sidebar, main region and global overlays. */
function ProjectWorkspaceShell({
  isMobile,
  ws,
  sendMessage,
  navigate,
}: ProjectWorkspaceShellProps) {
  return (
    <div
      data-app-shell
      className="fixed inset-0 flex bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      {/* The shared seam chat publishes its export into and the header's overflow
          menu reads it from — mounted here because this shell is the nearest
          common ancestor of the chat tab and the top bar. */}
      <TranscriptExportProvider>
        <ProjectEffects navigate={navigate} />
        {/* One column binding for the whole session page: the sidebar's mode switch, the
            header's count button and the right column all read it from here. The provider is
            inert while the server has the cockpit switched off. */}
        <CockpitColumnProvider>
          <ProjectSidebarRegion isMobile={isMobile} />

          <div className="flex min-w-0 flex-1 flex-col">
            <ProjectMainRegion
              isMobile={isMobile}
              ws={ws}
              sendMessage={sendMessage}
              navigate={navigate}
            />
          </div>

          <ProjectCommandPalette />
        </CockpitColumnProvider>
      </TranscriptExportProvider>
    </div>
  );
}

export default memo(ProjectWorkspaceShell);

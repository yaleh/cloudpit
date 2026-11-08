export { default as ProjectWorkspaceRoute } from '@/modules/project-workspace/ProjectWorkspaceRoute';
// The workspace tab strip's host, exposed for the architecture module's tab
// criterion: that reading has to verify the gate → tab-list wiring through the
// real header rather than restating WorkspaceTabs' source.
export { default as WorkspaceHeader } from '@/modules/project-workspace/WorkspaceHeader';
// The overflow menu, exported for the settings module's cross-surface criterion: the VAD switch on
// the Settings page and the row this menu draws must be read against one preference store.
export { default as WorkspaceMenu } from '@/modules/project-workspace/WorkspaceMenu';
export {
  useProjectSessionFilter,
  // The rule predicate, exported so the sidebar's live Conversations feed can be
  // handed the same implementation through props (see SessionHiddenByProjectFilter).
  isSessionHiddenByProjectFilter,
} from '@/modules/project-workspace/hooks/useProjectSessionFilter';
export { useProjectsState } from '@/modules/project-workspace/hooks/useProjectsState';
// The optional project-state read, exported for the cockpit's cards list: the PC column mounts
// inside the provider and can register a newly created session optimistically, while the cockpit
// page and the phone overlay mount above it and simply navigate.
export { useOptionalProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';
export type { ProjectMainState } from '@/modules/project-workspace/context/ProjectsStateContext';

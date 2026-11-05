/**
 * This device's/user's settings package: the mirrored preference store, the UI
 * and code-editor preference readers, the Claude settings reader, the selected
 * provider and the MCP navigation policy.
 *
 * Consumers outside `src/shared` import this barrel; siblings inside the package
 * use absolute `@/shared/settings/<file>` paths (relative imports are lint-banned).
 */
export * from '@/shared/settings/claudeSettings';
export * from '@/shared/settings/codeEditorSettings';
export * from '@/shared/settings/mcpNavigationPolicy';
export * from '@/shared/settings/selectedProvider';
export * from '@/shared/settings/uiPreferences';
export * from '@/shared/settings/userSettings';

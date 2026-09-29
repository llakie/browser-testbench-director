import template from '../templates/project-settings-dialog.html?raw';
import { defineWorkspaceSection } from './workspace-section.js';

export const ProjectSettingsDialog = defineWorkspaceSection({
    name: 'ProjectSettingsDialog',
    template,
    bindings: [
        'browserSession',
        'browserPermissions',
        'browserPermissionSummary',
        'closeProjectSettings',
        'closeProjectPermissions',
        'projectSettingsOpen',
        'projectPermissionsOpen',
        'setBrowserPermission',
        't',
        'toggleProjectPermissions',
        'updateBrowserSessionSetting',
    ],
});

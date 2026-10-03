import template from '../templates/project-settings-dialog.html?raw';
import { ModalDialog } from './modal-dialog.js';
import { PropertyField } from './property-field.js';
import { ToggleControl } from './toggle-control.js';
import { defineWorkspaceSection } from './workspace-section.js';

export const ProjectSettingsDialog = defineWorkspaceSection({
    name: 'ProjectSettingsDialog',
    template,
    components: { ModalDialog, PropertyField, ToggleControl },
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

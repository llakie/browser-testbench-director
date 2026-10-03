import template from '../templates/director-topbar.html?raw';
import { MobileProjectMenu } from './mobile-project-menu.js';
import { defineWorkspaceSection } from './workspace-section.js';

export const DirectorTopbar = defineWorkspaceSection({
    name: 'DirectorTopbar',
    template,
    components: { MobileProjectMenu },
    bindings: [
        'browserTestbenchLifecycleLabel',
        'browserTestbenchRunning',
        'browserTestbenchTransitioning',
        'browserTestbenchUrl',
        'dirty',
        'executionRunning',
        'loadProject',
        'markDirty',
        'newProject',
        'openMcpSetup',
        'openProjectSettings',
        'openProject',
        'project',
        'recordingActive',
        'recordingElapsedLabel',
        'saveProject',
        'savingProject',
        'stopRecordingWorkflow',
        't',
        'toggleBrowserTestbench',
    ],
});

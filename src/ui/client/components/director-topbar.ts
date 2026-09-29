import template from '../templates/director-topbar.html?raw';
import { defineWorkspaceSection } from './workspace-section.js';

export const DirectorTopbar = defineWorkspaceSection({
    name: 'DirectorTopbar',
    template,
    bindings: [
        'browserTestbenchLifecycleLabel',
        'browserTestbenchRunning',
        'browserTestbenchTransitioning',
        'dirty',
        'executionRunning',
        'loadProject',
        'markDirty',
        'newProject',
        'openMcpSetup',
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

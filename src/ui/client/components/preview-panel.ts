import template from '../templates/preview-panel.html?raw';
import { defineWorkspaceSection } from './workspace-section.js';
import { PreviewDeviceMenu } from './preview-device-menu.js';

export const PreviewPanel = defineWorkspaceSection({
    name: 'PreviewPanel',
    template,
    components: { PreviewDeviceMenu },
    bindings: [
        'browserTargetLabel',
        'browserTargetOpening',
        'maximizedPanel',
        'previewDocument',
        'previewRevision',
        'remotePreviewError',
        'selectedBrowserTarget',
        'stopRemotePreview',
        't',
        'togglePanelMaximized',
        'viewportStyle',
    ],
});

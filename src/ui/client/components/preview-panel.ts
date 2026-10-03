import template from '../templates/preview-panel.html?raw';
import { defineWorkspaceSection } from './workspace-section.js';

export const PreviewPanel = defineWorkspaceSection({
    name: 'PreviewPanel',
    template,
    bindings: [
        'browserTargetLabel',
        'browserTargetOpening',
        'browserTestbenchRunning',
        'compatiblePreviewTargets',
        'currentViewportPreset',
        'deviceMenuOpen',
        'maximizedPanel',
        'previewDestinationLabel',
        'previewDocument',
        'previewRevision',
        'previewTargetStatus',
        'remotePreviewError',
        'selectRemotePreviewTarget',
        'selectViewportPreset',
        'selectedBrowserTarget',
        'selectedBrowserTargetId',
        'stopRemotePreview',
        't',
        'toggleDeviceMenu',
        'togglePanelMaximized',
        'viewportLabel',
        'viewportPresetIcon',
        'viewportPresets',
        'viewportStyle',
    ],
});

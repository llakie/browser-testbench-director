import template from '../templates/preview-device-menu.html?raw';
import { defineWorkspaceSection } from './workspace-section.js';

export const PreviewDeviceMenu = defineWorkspaceSection({
    name: 'PreviewDeviceMenu',
    template,
    bindings: [
        'browserTargetLabel',
        'browserTestbenchRunning',
        'compatiblePreviewTargets',
        'currentViewportPreset',
        'deviceMenuOpen',
        'previewDestinationLabel',
        'previewTargetStatus',
        'selectRemotePreviewTarget',
        'selectViewportPreset',
        'selectedBrowserTargetId',
        't',
        'toggleDeviceMenu',
        'viewportLabel',
        'viewportPresetIcon',
        'viewportPresets',
    ],
});

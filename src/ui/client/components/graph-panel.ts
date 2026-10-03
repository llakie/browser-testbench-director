import template from '../templates/graph-panel.html?raw';
import { defineWorkspaceSection } from './workspace-section.js';
import { NodeAddMenu } from './node-add-menu.js';

export const GraphPanel = defineWorkspaceSection({
    name: 'GraphPanel',
    template,
    components: { NodeAddMenu },
    bindings: [
        'activeConnectionId',
        'addNode',
        'autoLayoutGraph',
        'browserTargetOpening',
        'canDuplicateActiveNode',
        'changeGraphZoom',
        'deleteConnection',
        'duplicateActiveNode',
        'endStageGesture',
        'executionRunning',
        'workflowPlaybackRunning',
        'workflowStartPending',
        'graphLayoutRunning',
        'graphZoomPercent',
        'maximizedPanel',
        'moveStageGesture',
        'nodeMenuOpen',
        'nodeMenuCategory',
        'playWorkflow',
        'project',
        'recordingActive',
        'resetGraphZoom',
        'startStageGesture',
        'stopPlayback',
        't',
        'toggleNodeMenu',
        'togglePanelMaximized',
        'zoomFromWheel',
    ],
});

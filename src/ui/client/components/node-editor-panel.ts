import template from '../templates/node-editor-panel.html?raw';
import { AudioNodeProperties } from './audio-node-properties.js';
import { InputNodeProperties } from './input-node-properties.js';
import { LayerNodeProperties } from './layer-node-properties.js';
import { NumberControl } from './number-control.js';
import { NodeEditorHeader } from './node-editor-header.js';
import { PropertyAccordion } from './property-accordion.js';
import { PropertyField } from './property-field.js';
import { RangeControl } from './range-control.js';
import { SourceEditor } from './source-editor.js';
import { ToggleControl } from './toggle-control.js';
import { defineWorkspaceSection } from './workspace-section.js';

export const NodeEditorPanel = defineWorkspaceSection({
    name: 'NodeEditorPanel',
    template,
    components: {
        AudioNodeProperties,
        InputNodeProperties,
        LayerNodeProperties,
        NumberControl,
        NodeEditorHeader,
        PropertyAccordion,
        PropertyField,
        RangeControl,
        SourceEditor,
        ToggleControl,
    },
    bindings: [
        'activeBrowserAction',
        'activeBrowserWait',
        'activeAudio',
        'audioPositionMs',
        'audioDurationMs',
        'audioPlayableDurationMs',
        'audioSeekEnabled',
        'audioScrubbing',
        'activeCapability',
        'activeInput',
        'activeDelay',
        'activeJavaScript',
        'activeLayer',
        'activeMerge',
        'activeNodeLocked',
        'editorPanelLocked',
        'activeWebsite',
        'activeVideoOutput',
        'availableRecordingTargets',
        'browserTargetLabel',
        'recordingTargetStatus',
        'browserSessionInputsReady',
        'browserTargetOpening',
        'editorPanelTitle',
        'executionRunning',
        'formatActiveSource',
        'formatAudioTime',
        'formattingSource',
        'markActiveNodeStale',
        'markDirty',
        'renderGraph',
        'selectedBrowserTarget',
        'selectorPicking',
        'setBrowserWaitCondition',
        'seekActiveAudio',
        't',
        'toggleSelectorPicker',
        'updateBrowserWaitScript',
        'updateActiveDelay',
        'updateJavaScriptSource',
        'updateWebsiteUrl',
    ],
});

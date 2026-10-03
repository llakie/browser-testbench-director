import template from '../templates/layer-node-properties.html?raw';
import { NumberControl } from './number-control.js';
import { PropertyAccordion } from './property-accordion.js';
import { PropertyField } from './property-field.js';
import { SourceEditor } from './source-editor.js';
import { TextLayerEditor } from './text-layer-editor.js';
import { ToggleControl } from './toggle-control.js';
import { defineWorkspaceSection } from './workspace-section.js';

export const LayerNodeProperties = defineWorkspaceSection({
    name: 'LayerNodeProperties',
    template,
    components: {
        NumberControl,
        PropertyAccordion,
        PropertyField,
        SourceEditor,
        TextLayerEditor,
        ToggleControl,
    },
    bindings: [
        'activeLayer',
        'activeSource',
        'activeTextLayerLatestEnd',
        'availableParentLayers',
        'browserSessionInputsReady',
        'executionRunning',
        'fontInputNodes',
        'formatActiveSource',
        'formattingSource',
        'horizontalAlignment',
        'markActiveNodeStale',
        'placementReferenceType',
        'selectedBrowserTarget',
        'selectorPicking',
        'setHorizontalAlignment',
        'setLayerOffset',
        'setParentLayer',
        'setPlacementReference',
        'setVerticalAlignment',
        'sourceTypes',
        't',
        'toggleSelectorPicker',
        'updateSource',
        'verticalAlignment',
    ],
});

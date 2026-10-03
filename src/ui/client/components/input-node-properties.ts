import template from '../templates/input-node-properties.html?raw';
import { PropertyAccordion } from './property-accordion.js';
import { PropertyField } from './property-field.js';
import { ToggleControl } from './toggle-control.js';
import { defineWorkspaceSection } from './workspace-section.js';

export const InputNodeProperties = defineWorkspaceSection({
    name: 'InputNodeProperties',
    template,
    components: { PropertyAccordion, PropertyField, ToggleControl },
    bindings: [
        'activeInput',
        'activeInputAcceptId',
        'addInputAccept',
        'addInputPreparation',
        'blurInputAccept',
        'focusInputAccept',
        'handleInputAcceptKeydown',
        'inputAcceptQueries',
        'inputAcceptSuggestions',
        'inputAcceptValues',
        'markExecutionDirty',
        'removeInputAccept',
        'removeInputPreparation',
        't',
        'updateInputFile',
        'updateInputPreparation',
    ],
});

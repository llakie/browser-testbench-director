import template from '../templates/audio-node-properties.html?raw';
import { AudioEnvelopeEditor } from './audio-envelope-editor.js';
import { NumberControl } from './number-control.js';
import { PropertyAccordion } from './property-accordion.js';
import { PropertyField } from './property-field.js';
import { RangeControl } from './range-control.js';
import { ToggleControl } from './toggle-control.js';
import { defineWorkspaceSection } from './workspace-section.js';

export const AudioNodeProperties = defineWorkspaceSection({
    name: 'AudioNodeProperties',
    template,
    components: {
        AudioEnvelopeEditor,
        NumberControl,
        PropertyAccordion,
        PropertyField,
        RangeControl,
        ToggleControl,
    },
    bindings: [
        'activeAudio',
        'activeAudioEditLocked',
        'audioMaximumStartOffsetMs',
        'audioPlayableDurationMs',
        'audioPositionMs',
        'markActiveNodeStale',
        't',
        'updateActiveAudioStartOffset',
    ],
});

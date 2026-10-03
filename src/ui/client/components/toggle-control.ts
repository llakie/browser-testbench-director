import { defineComponent, type PropType } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import template from '../templates/toggle-control.html?raw';

type ToggleLayout = 'row' | 'field';

export const ToggleControl = defineComponent({
    name: 'ToggleControl',
    props: {
        modelValue: { type: Boolean, required: true },
        label: { type: String, required: true },
        value: { type: String, default: '' },
        layout: {
            type: String as PropType<ToggleLayout>,
            default: 'row',
        },
        disabled: { type: Boolean, default: false },
        testId: { type: String, default: '' },
    },
    emits: ['update:modelValue', 'change'],
    methods: {
        handleChange(event: Event): void {
            this.$emit('update:modelValue', (event.target as HTMLInputElement).checked);
            this.$emit('change', event);
        },
    },
});

TemplateRegistry.attach(ToggleControl, template);

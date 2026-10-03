import { defineComponent } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import template from '../templates/number-control.html?raw';

export const NumberControl = defineComponent({
    name: 'NumberControl',
    props: {
        modelValue: { type: Number, required: true },
        min: { type: Number, default: undefined },
        max: { type: Number, default: undefined },
        step: { type: Number, default: 1 },
        prefix: { type: String, default: '' },
        suffix: { type: String, default: '' },
        disabled: { type: Boolean, default: false },
        ariaLabel: { type: String, default: '' },
        ariaDescribedby: { type: String, default: '' },
        testId: { type: String, default: '' },
    },
    emits: ['update:modelValue', 'input', 'change'],
    methods: {
        updateValue(event: Event): void {
            this.$emit('update:modelValue', Number((event.target as HTMLInputElement).value));
        },
        handleInput(event: Event): void {
            this.updateValue(event);
            this.$emit('input', event);
        },
        handleChange(event: Event): void {
            this.updateValue(event);
            this.$emit('change', event);
        },
    },
});

TemplateRegistry.attach(NumberControl, template);

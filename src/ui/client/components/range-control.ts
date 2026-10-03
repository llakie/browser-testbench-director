import { defineComponent, type PropType } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import template from '../templates/range-control.html?raw';

type RangeTone = 'accent' | 'audio';
type RangeValueWidth = 'default' | 'time';

export const RangeControl = defineComponent({
    name: 'RangeControl',
    props: {
        modelValue: { type: Number, required: true },
        min: { type: Number, default: 0 },
        max: { type: Number, default: 100 },
        step: { type: Number, default: 1 },
        disabled: { type: Boolean, default: false },
        valueText: { type: String, default: '' },
        valueWidth: {
            type: String as PropType<RangeValueWidth>,
            default: 'default',
        },
        tone: {
            type: String as PropType<RangeTone>,
            default: 'accent',
        },
        ariaLabel: { type: String, default: '' },
        testId: { type: String, default: '' },
    },
    emits: ['update:modelValue', 'input', 'change', 'pointerdown', 'pointercancel'],
    computed: {
        progress(): string {
            const span = this.max - this.min;
            const normalized = span > 0 ? (this.modelValue - this.min) / span : 0;
            return `${Math.max(0, Math.min(1, normalized)) * 100}%`;
        },
    },
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

TemplateRegistry.attach(RangeControl, template);

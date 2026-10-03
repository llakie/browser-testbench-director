import { defineComponent, type PropType } from 'vue';

import type { TextEffect, TextEffectName } from '../core/text-layer-source.js';
import { TemplateRegistry } from '../core/template-registry.js';
import { Translator } from '../core/translator.js';
import template from '../templates/text-effect-control.html?raw';
import { NumberControl } from './number-control.js';
import { PropertyField } from './property-field.js';

type TextEffectLayout = 'block' | 'line';

export const TextEffectControl = defineComponent({
    name: 'TextEffectControl',
    components: { NumberControl, PropertyField },
    props: {
        modelValue: { type: Object as PropType<TextEffect>, required: true },
        label: { type: String, required: true },
        layout: {
            type: String as PropType<TextEffectLayout>,
            default: 'line',
        },
        effectTestId: { type: String, required: true },
        durationTestId: { type: String, required: true },
        directionTestId: { type: String, required: true },
    },
    emits: ['update:modelValue', 'change'],
    methods: {
        t(key: string): string {
            return Translator.text(key);
        },
        setName(event: Event): void {
            this.update({ name: (event.target as HTMLSelectElement).value as TextEffectName });
        },
        setDuration(durationMs: number): void {
            this.update({ durationMs });
        },
        setDirection(event: Event): void {
            this.update({
                direction: (event.target as HTMLSelectElement).value as TextEffect['direction'],
            });
        },
        update(patch: Partial<TextEffect>): void {
            this.$emit('update:modelValue', { ...this.modelValue, ...patch });
            this.$emit('change');
        },
    },
});

TemplateRegistry.attach(TextEffectControl, template);

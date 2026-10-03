import { defineComponent } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import { Translator } from '../core/translator.js';
import template from '../templates/source-editor.html?raw';

export const SourceEditor = defineComponent({
    name: 'SourceEditor',
    props: {
        modelValue: { type: String, required: true },
        label: { type: String, required: true },
        panelId: { type: String, default: '' },
        labelledBy: { type: String, default: '' },
        testId: { type: String, default: '' },
        formatting: { type: Boolean, default: false },
    },
    emits: ['update:modelValue', 'format'],
    computed: {
        lineNumbers(): string {
            return Array.from(
                { length: this.modelValue.split('\n').length },
                (_value, index) => index + 1,
            ).join('\n');
        },
    },
    methods: {
        t(key: string): string {
            return Translator.text(key);
        },
        update(event: Event): void {
            this.$emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
        },
        handleKeydown(event: KeyboardEvent): void {
            if (event.altKey && event.shiftKey && event.key.toLowerCase() === 'f') {
                event.preventDefault();
                this.$emit('format');

                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            event.preventDefault();
            const input = event.currentTarget as HTMLTextAreaElement;
            const start = input.selectionStart;
            const end = input.selectionEnd;
            input.value = `${input.value.slice(0, start)}    ${input.value.slice(end)}`;
            input.selectionStart = input.selectionEnd = start + 4;
            this.$emit('update:modelValue', input.value);
        },
        syncGutter(event: Event): void {
            const input = event.currentTarget as HTMLTextAreaElement;
            const gutter = this.$refs.gutter as HTMLElement;
            gutter.scrollTop = input.scrollTop;
        },
    },
});

TemplateRegistry.attach(SourceEditor, template);

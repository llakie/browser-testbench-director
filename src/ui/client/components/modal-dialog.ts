import { defineComponent, nextTick } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import template from '../templates/modal-dialog.html?raw';

export const ModalDialog = defineComponent({
    name: 'ModalDialog',
    props: {
        open: { type: Boolean, required: true },
        title: { type: String, required: true },
        closeLabel: { type: String, required: true },
        showCloseButton: { type: Boolean, default: true },
        closeOnBackdrop: { type: Boolean, default: true },
    },
    emits: ['cancel'],
    data() {
        return { previousFocus: null as HTMLElement | null };
    },
    watch: {
        open(value: boolean): void {
            if (!value) {
                this.previousFocus?.focus();
                this.previousFocus = null;
                return;
            }

            this.previousFocus = document.activeElement as HTMLElement | null;
            void nextTick(() => {
                const panel = this.$refs.panel as HTMLElement | undefined;
                const first = panel?.querySelector<HTMLElement>('[data-dialog-autofocus]');
                (first ?? panel)?.focus();
            });
        },
    },
    methods: {
        cancel(): void {
            this.$emit('cancel');
        },
        cancelFromBackdrop(): void {
            if (this.closeOnBackdrop) {
                this.cancel();
            }
        },
        handleKeydown(event: KeyboardEvent): void {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                this.cancel();
                return;
            }

            if (event.key !== 'Tab') {
                return;
            }

            const panel = this.$refs.panel as HTMLElement | undefined;
            const focusable = Array.from(
                panel?.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
                ) ?? [],
            );
            const first = focusable[0];
            const last = focusable.at(-1);

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        },
    },
});

TemplateRegistry.attach(ModalDialog, template);

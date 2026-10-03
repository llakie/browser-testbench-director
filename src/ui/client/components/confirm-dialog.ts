import { defineComponent } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import { ModalDialog } from './modal-dialog.js';
import template from '../templates/confirm-dialog.html?raw';

export const ConfirmDialog = defineComponent({
    name: 'ConfirmDialog',
    components: { ModalDialog },
    props: {
        open: { type: Boolean, required: true },
        title: { type: String, required: true },
        message: { type: String, required: true },
        confirmLabel: { type: String, required: true },
        cancelLabel: { type: String, required: true },
        closeLabel: { type: String, required: true },
        showCloseButton: { type: Boolean, default: true },
        closeOnBackdrop: { type: Boolean, default: true },
    },
    emits: ['confirm', 'cancel'],
});

TemplateRegistry.attach(ConfirmDialog, template);

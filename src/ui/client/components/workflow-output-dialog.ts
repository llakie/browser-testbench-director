import { ModalDialog } from './modal-dialog.js';
import { PropertyField } from './property-field.js';
import { defineWorkspaceSection } from './workspace-section.js';
import template from '../templates/workflow-output-dialog.html?raw';

export const WorkflowOutputDialog = defineWorkspaceSection({
    name: 'WorkflowOutputDialog',
    template,
    components: { ModalDialog, PropertyField },
    bindings: [
        'closeWorkflowOutputSelection',
        'playWorkflowToOutput',
        't',
        'workflowOutputSelectionOpen',
        'workflowOutputSelectedId',
        'workflowOutputs',
    ],
});

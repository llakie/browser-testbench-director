import template from '../templates/mcp-setup-dialog.html?raw';
import { ModalDialog } from './modal-dialog.js';
import { defineWorkspaceSection } from './workspace-section.js';

export const McpSetupDialog = defineWorkspaceSection({
    name: 'McpSetupDialog',
    template,
    components: { ModalDialog },
    bindings: [
        'closeMcpSetup',
        'connectMcpClient',
        'copyMcpConfiguration',
        'loadMcpClients',
        'mcpClients',
        'mcpLoadError',
        'mcpLoading',
        'mcpSetupOpen',
        't',
    ],
});

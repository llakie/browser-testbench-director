import template from '../templates/mcp-setup-dialog.html?raw';
import { defineWorkspaceSection } from './workspace-section.js';

export const McpSetupDialog = defineWorkspaceSection({
    name: 'McpSetupDialog',
    template,
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

import { nextTick } from 'vue';

import type { McpClientStatus, WorkspaceMethodMap } from './workspace-model.js';

export const workspaceDialogMethods: WorkspaceMethodMap = {
    toggleMobileMenu(): void {
        this.mobileMenuOpen = !this.mobileMenuOpen;

        if (!this.mobileMenuOpen) {
            return;
        }

        void nextTick(() => this.workspaceElement('mobileMenu')?.focus());
    },
    closeMobileMenu(): void {
        this.mobileMenuOpen = false;
    },
    openProjectSettings(): void {
        this.projectPermissionsOpen = false;
        this.projectSettingsOpen = true;
    },
    closeProjectSettings(): void {
        this.projectPermissionsOpen = false;
        this.projectSettingsOpen = false;
    },
    toggleProjectPermissions(): void {
        this.projectPermissionsOpen = !this.projectPermissionsOpen;
    },
    closeProjectPermissions(): void {
        this.projectPermissionsOpen = false;
    },
    async openMcpSetup(): Promise<void> {
        this.mcpSetupOpen = true;
        await this.loadMcpClients();
    },
    async loadMcpClients(): Promise<void> {
        this.mcpLoading = true;
        this.mcpLoadError = '';
        this.mcpClients = [];

        try {
            const response = await fetch('/director-api/mcp', { cache: 'no-store' });
            const clients = await this.readDirectorJson(response);

            if (!Array.isArray(clients)) {
                throw new Error('Invalid server response.');
            }

            this.mcpClients = clients as McpClientStatus[];
        } catch (error) {
            this.mcpLoadError = `${this.t('mcp.loadFailed')} ${this.errorMessage(error)}`;
        } finally {
            this.mcpLoading = false;
        }
    },
    closeMcpSetup(): void {
        this.mcpSetupOpen = false;
    },
    async connectMcpClient(client: McpClientStatus): Promise<void> {
        if (!client.automatic || !client.installed || this.mcpLoading) {
            return;
        }

        this.mcpLoading = true;

        try {
            const response = await fetch('/director-api/mcp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ client: client.id }),
            });
            const updated = (await this.readDirectorJson(response)) as McpClientStatus;
            this.mcpClients = this.mcpClients.map((candidate: McpClientStatus) =>
                candidate.id === updated.id ? updated : candidate,
            );
            this.showNotice(this.t('mcp.connected', { client: client.label }));
        } catch (error) {
            this.showNotice(`${this.t('mcp.connectFailed')} ${this.errorMessage(error)}`);
        } finally {
            this.mcpLoading = false;
        }
    },
    async readDirectorJson(response: Response): Promise<unknown> {
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        if (!response.headers.get('content-type')?.includes('application/json')) {
            throw new Error(this.t('mcp.backendUnavailable'));
        }

        return response.json();
    },
    async copyMcpConfiguration(client: McpClientStatus): Promise<void> {
        await navigator.clipboard.writeText(client.command);
        this.showNotice(this.t('mcp.copied', { client: client.label }));
    },
};

import { markRaw } from 'vue';

import { BrowserTestbenchPreview } from '../core/browser-testbench-preview.js';
import { ProjectAssets } from '../core/project-assets.js';
import { ProjectFiles, type ProjectFileHandle } from '../core/project-files.js';
import { ProjectFormat, type DirectorProject } from '../core/project-format.js';
import type { WorkspaceMethodMap } from './workspace-model.js';

export const projectMethods: WorkspaceMethodMap = {
    newProject(): void {
        const project = ProjectFormat.create(this.t('project.defaultName'));
        this.setProject(project, ProjectFiles.filename(project.name), true);
        this.projectFileHandle = null;
        this.showNotice(this.t('project.created'));
    },
    async openProject(): Promise<void> {
        try {
            const selected = await ProjectFiles.open();

            if (!selected) {
                const input = this.workspaceElement('projectFileInput');

                if (input instanceof HTMLInputElement) {
                    input.click();
                }

                return;
            }

            await this.loadProjectFile(selected.file, selected.handle);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }

            this.showNotice(`${this.t('project.loadError')} ${this.errorMessage(error)}`);
        }
    },
    async loadProject(event: Event): Promise<void> {
        const input = event.target;

        if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
            return;
        }

        try {
            await this.loadProjectFile(input.files[0], null);
        } catch (error) {
            this.showNotice(`${this.t('project.loadError')} ${this.errorMessage(error)}`);
        } finally {
            input.value = '';
        }
    },
    async loadProjectFile(file: File, handle: ProjectFileHandle | null): Promise<void> {
        this.setProject(await ProjectFiles.read(file), file.name, false);
        this.projectFileHandle = handle ? markRaw(handle) : null;
        await this.restoreProjectInputs();
        this.showNotice(this.t('project.loaded', { name: file.name }));
    },
    async saveProject(): Promise<void> {
        if (this.savingProject) {
            return;
        }

        this.savingProject = true;

        try {
            await Promise.all(Object.values(this.inputFileStores));
            const saved = await ProjectFiles.save(
                this.project,
                this.filename,
                this.projectFileHandle,
            );
            this.filename = saved.filename;
            this.projectFileHandle = saved.handle ? markRaw(saved.handle) : null;
            this.dirty = false;
            this.showNotice(this.t('project.saved', { name: this.filename }));
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                return;
            }

            this.showNotice(`${this.t('project.saveError')} ${this.errorMessage(error)}`);
        } finally {
            this.savingProject = false;
        }
    },
    async restoreProjectInputs(): Promise<void> {
        for (const input of this.inputNodes) {
            if (!input.file) {
                continue;
            }

            const file = await ProjectAssets.load(input.file);
            this.inputFiles[input.id] = markRaw(file);
            const data = await BrowserTestbenchPreview.runtimeInputs({ [input.id]: file });
            this.inputData[input.id] = data[input.id]!;
        }

        this.renderGraph();
    },
    setProject(project: DirectorProject, filename: string, dirty: boolean): void {
        const previousRemoteSessionId = this.remotePreviewSessionId;
        this.remotePreviewSessionId = null;
        this.selectedBrowserTargetId = '';
        this.remotePreviewError = '';

        if (previousRemoteSessionId) {
            void BrowserTestbenchPreview.close(previousRemoteSessionId).catch(() => undefined);
        }

        this.graph?.resetAutomaticLayout();
        this.project = ProjectFormat.clone(project);
        this.activeConnectionId = null;
        this.filename = filename;
        this.inputFiles = {};
        this.inputData = {};
        this.inputFileStores = {};
        this.inputFileSelectionRevisions = {};
        this.inputAcceptQueries = {};
        this.activeInputAcceptId = null;
        this.selectedRecordingTargetId = this.availableRecordingTargetId();
        this.activeNodeId = null;
        this.activeSource = 'html';
        this.deviceMenuOpen = false;
        this.mobileMenuOpen = false;
        this.projectSettingsOpen = false;
        this.projectPermissionsOpen = false;
        this.mobileActivePanel = 'graph';
        this.dirty = dirty;
        this.staleNodeIds.clear();
        this.lastPreviewPlan = null;
        this.lastPreviewInputs = {};
        this.renderGraph();
        this.observePreviewStage();
        this.startPreviewInitialization();
    },
    showNotice(message: string): void {
        this.notice = message;

        if (this.noticeTimer) {
            clearTimeout(this.noticeTimer);
        }

        this.noticeTimer = setTimeout(() => {
            this.notice = '';
        }, 3200);
    },
    errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    },
};

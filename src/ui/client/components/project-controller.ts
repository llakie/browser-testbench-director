import { markRaw } from 'vue';

import {
    BrowserTestbenchPreview,
    type BrowserTestbenchTarget,
} from '../core/browser-testbench-preview.js';
import { ProjectAssets } from '../core/project-assets.js';
import { ProjectFiles } from '../core/project-files.js';
import { ProjectFormat, type DirectorNode, type DirectorProject } from '../core/project-format.js';
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

            this.setProject(await ProjectFiles.read(selected.file), selected.file.name, false);
            this.projectFileHandle = markRaw(selected.handle);
            await this.restoreProjectInputs();
            this.showNotice(this.t('project.loaded', { name: selected.file.name }));
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
            const file = input.files[0];
            this.setProject(await ProjectFiles.read(file), file.name, false);
            this.projectFileHandle = null;
            await this.restoreProjectInputs();
            this.showNotice(this.t('project.loaded', { name: file.name }));
        } catch (error) {
            this.showNotice(`${this.t('project.loadError')} ${this.errorMessage(error)}`);
        } finally {
            input.value = '';
        }
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

        this.project = ProjectFormat.clone(project);
        this.activeConnectionId = null;
        this.filename = filename;
        this.inputFiles = {};
        this.inputData = {};
        this.inputFileStores = {};
        this.inputFileSelectionRevisions = {};
        this.inputAcceptQueries = {};
        this.activeInputAcceptId = null;
        const selectedRecordingTarget = this.compatibleRecordingTargets.find(
            (target: BrowserTestbenchTarget) =>
                target.id === this.selectedRecordingTargetId && target.ready && !target.busy,
        );
        this.selectedRecordingTargetId =
            selectedRecordingTarget?.id ??
            this.compatibleRecordingTargets.find(
                (target: BrowserTestbenchTarget) => target.ready && !target.busy,
            )?.id ??
            '';
        this.activeNodeId = (this.project.nodes.find(
            (node: DirectorNode) => node.type === 'layer',
        ) ?? this.project.nodes[0])!.id;
        this.activeSource = 'html';
        this.deviceMenuOpen = false;
        this.mobileMenuOpen = false;
        this.projectSettingsOpen = false;
        this.projectPermissionsOpen = false;
        this.mobileActivePanel = 'graph';
        this.dirty = dirty;
        this.hasPlayed = false;
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

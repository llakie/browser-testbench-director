import { nextTick } from 'vue';

import {
    BrowserTestbenchPreview,
    type BrowserTestbenchTarget,
} from '../core/browser-testbench-preview.js';
import { PreviewDocument } from '../core/preview-document.js';
import type { BrowserPermission, DirectorNode } from '../core/project-format.js';
import { WorkflowPlanner } from '../core/workflow-planner.js';
import {
    cloneWorkflowPlan,
    type ViewportPreset,
    type WorkspaceMethodMap,
} from './workspace-model.js';

export const browserSessionMethods: WorkspaceMethodMap = {
    toggleDeviceMenu(): void {
        this.deviceMenuOpen = !this.deviceMenuOpen;

        if (this.deviceMenuOpen) {
            this.positionFlyout('deviceFlyout');
        }
    },
    closeDeviceMenu(event: PointerEvent): void {
        const flyout = this.workspaceElement('deviceFlyout');
        const portal = document.querySelector<HTMLElement>('[data-flyout-owner="deviceFlyout"]');

        if (
            (flyout instanceof HTMLElement && flyout.contains(event.target as Node)) ||
            portal?.contains(event.target as Node)
        ) {
            return;
        }

        this.deviceMenuOpen = false;
    },
    selectViewportPreset(preset: ViewportPreset): void {
        const presetChanged = preset.id !== this.project.preview.preset;
        this.deviceMenuOpen = false;

        if (this.remotePreviewSessionId || this.selectedBrowserTargetId) {
            void this.switchToLocalPreview();
        }

        if (!presetChanged) {
            return;
        }

        this.project.preview.preset = preset.id;
        this.markDirty();
        void nextTick(() => {
            this.renderGraph();
            this.updatePreviewFitScale();
        });
    },
    browserTargetLabel(target: BrowserTestbenchTarget): string {
        return BrowserTestbenchPreview.label(target);
    },
    recordingTargetStatus(target: BrowserTestbenchTarget): string {
        if (!this.isCompatibleRecordingTarget(target)) {
            return this.t('recording.targetIncompatible');
        }

        if (!target.ready) {
            return this.t('recording.targetUnavailable');
        }

        if (target.busy) {
            return this.t('recording.targetBusy');
        }

        return this.t('recording.targetReady');
    },
    previewTargetStatus(target: BrowserTestbenchTarget): string {
        if (!this.isCompatiblePreviewTarget(target)) {
            return this.t('preview.targetIncompatible');
        }

        if (!target.ready) {
            return this.t('preview.targetUnavailable');
        }

        if (target.busy) {
            return this.t('preview.targetBusy');
        }

        return this.t('preview.targetReady');
    },
    isCompatiblePreviewTarget(target: BrowserTestbenchTarget): boolean {
        return !this.project.browserSession.permissions.some(
            (permission: BrowserPermission) =>
                !target.capabilities.permissions.origin.includes(permission),
        );
    },
    isCompatibleRecordingTarget(target: BrowserTestbenchTarget): boolean {
        return target.capabilities.recording.viewport && this.isCompatiblePreviewTarget(target);
    },
    async loadBrowserTargets(): Promise<void> {
        if (this.browserTargetsLoading) {
            return;
        }

        this.browserTargetsLoading = true;

        try {
            this.browserTargets = await BrowserTestbenchPreview.targets();
            this.browserTestbenchState = 'running';
            const selectedTarget = this.compatiblePreviewTargets.find(
                (target: BrowserTestbenchTarget) =>
                    target.id === this.selectedBrowserTargetId &&
                    (Boolean(this.remotePreviewSessionId) || (target.ready && !target.busy)),
            );
            this.selectedBrowserTargetId = selectedTarget?.id ?? '';
            this.selectedRecordingTargetId = this.availableRecordingTargetId();
        } catch {
            this.browserTargets = [];
            this.selectedBrowserTargetId = '';
            this.selectedRecordingTargetId = '';

            if (!this.browserTestbenchTransitioning) {
                this.browserTestbenchState = 'stopped';
                this.browserTestbenchManaged = false;
            }
        } finally {
            this.browserTargetsLoading = false;
        }
    },
    async refreshBrowserTestbench(): Promise<void> {
        try {
            const status = await BrowserTestbenchPreview.status();
            this.browserTestbenchManaged = status.managed;
            this.browserTestbenchState = status.running ? 'running' : 'stopped';
            this.browserTestbenchUrl = status.url;

            if (status.running) {
                await this.loadBrowserTargets();
            } else {
                this.clearBrowserTargets();
                this.remotePreviewSessionId = null;
                void this.restoreLocalPreview();
            }
        } catch {
            this.browserTestbenchState = 'stopped';
            this.browserTestbenchManaged = false;
            this.browserTestbenchUrl = '';
            this.clearBrowserTargets();
        }
    },
    async toggleBrowserTestbench(): Promise<void> {
        if (this.browserTestbenchTransitioning || this.executionRunning) {
            return;
        }

        const shouldStop = this.browserTestbenchRunning;
        this.browserTestbenchState = shouldStop ? 'stopping' : 'starting';

        try {
            const status = shouldStop
                ? await BrowserTestbenchPreview.stop()
                : await BrowserTestbenchPreview.start();
            this.browserTestbenchManaged = status.managed;
            this.browserTestbenchState = status.running ? 'running' : 'stopped';
            this.browserTestbenchUrl = status.url;

            if (status.running) {
                await this.loadBrowserTargets();
            } else {
                this.clearBrowserTargets();
                this.remotePreviewSessionId = null;
                await this.restoreLocalPreview();
            }

            this.showNotice(
                this.t(
                    status.running
                        ? 'preview.testbench.started'
                        : 'preview.testbench.stoppedNotice',
                ),
            );
        } catch (error) {
            await this.refreshBrowserTestbench();
            this.showNotice(
                `${this.t('preview.testbench.lifecycleError')} ${this.errorMessage(error)}`,
            );
        }
    },
    clearBrowserTargets(): void {
        this.browserTargets = [];
        this.selectedBrowserTargetId = '';
        this.selectedRecordingTargetId = '';
    },
    availableRecordingTargetId(): string {
        const available = this.compatibleRecordingTargets.filter(
            (target: BrowserTestbenchTarget) => target.ready && !target.busy,
        );
        return (
            available.find(
                (target: BrowserTestbenchTarget) => target.id === this.selectedRecordingTargetId,
            )?.id ??
            available[0]?.id ??
            ''
        );
    },
    async selectRemotePreviewTarget(target: BrowserTestbenchTarget): Promise<void> {
        if (
            !this.isCompatiblePreviewTarget(target) ||
            !target.ready ||
            target.busy ||
            this.browserTargetOpening ||
            this.executionRunning
        ) {
            return;
        }

        this.deviceMenuOpen = false;
        this.remotePreviewError = '';
        this.browserTargetOpening = true;

        try {
            const previewPlan = this.lastPreviewPlan ?? WorkflowPlanner.plan(this.project, 'root');
            const workflowPlan = WorkflowPlanner.plan(this.project, 'workflow');
            const sessionPlan = {
                ...previewPlan,
                inputs: workflowPlan.inputs,
                cameraInputId: workflowPlan.cameraInputId,
                globalStylesheetInputIds: workflowPlan.globalStylesheetInputIds,
            };

            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.close(this.remotePreviewSessionId).catch(
                    () => undefined,
                );
            }

            this.selectedBrowserTargetId = target.id;
            this.remotePreviewSessionId = await this.openRemotePlan(
                target,
                'preview-state',
                sessionPlan,
            );
            const steps = PreviewDocument.runtimeSteps(previewPlan);

            await BrowserTestbenchPreview.execute(this.remotePreviewSessionId, steps);

            this.showNotice(
                this.t('preview.openedOnTarget', {
                    target: BrowserTestbenchPreview.label(target),
                }),
            );
        } catch (error) {
            this.remotePreviewError = this.errorMessage(error);
            this.showNotice(`${this.t('preview.openOnDeviceError')} ${this.errorMessage(error)}`);
        } finally {
            this.browserTargetOpening = false;
        }
    },
    async switchToLocalPreview(): Promise<void> {
        const sessionId = this.remotePreviewSessionId;
        this.remotePreviewSessionId = null;
        this.selectedBrowserTargetId = '';
        this.remotePreviewError = '';

        if (sessionId) {
            await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
        }

        await this.restoreLocalPreview();

        if (this.browserTestbenchRunning) {
            void this.loadBrowserTargets();
        }
    },
    async stopRemotePreview(): Promise<void> {
        if (this.executionRunning) {
            await this.stopPlayback();
            return;
        }

        await this.switchToLocalPreview();
    },
    async toggleSelectorPicker(): Promise<void> {
        if (this.selectorPicking) {
            this.selectorPicking = false;

            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.cancelSelectorPicker(
                    this.remotePreviewSessionId,
                ).catch(() => undefined);
            }

            return;
        }

        const node = this.activeNode;
        const target = this.selectedBrowserTarget;
        const selectorNode =
            node?.type === 'browser-action' ||
            (node?.type === 'browser-wait' && node.condition === 'element') ||
            (node?.type === 'layer' && node.placement.reference.type === 'dom');

        if (
            !selectorNode ||
            !target ||
            this.executionRunning ||
            this.browserTargetOpening ||
            this.recordingWorkflow ||
            !this.browserSessionInputsReady
        ) {
            return;
        }

        this.selectorPicking = true;
        const selectedNodeId = node.id;

        try {
            const plan = WorkflowPlanner.plan(this.project, 'prepare', selectedNodeId);
            this.assertPlanInputs(plan);

            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.close(this.remotePreviewSessionId).catch(
                    () => undefined,
                );
            }

            this.remotePreviewSessionId = await this.openRemotePlan(target, selectedNodeId, plan);
            const precedingSteps = PreviewDocument.runtimeSteps(plan).slice(0, -1);

            await BrowserTestbenchPreview.execute(this.remotePreviewSessionId, precedingSteps);

            await BrowserTestbenchPreview.startSelectorPicker(this.remotePreviewSessionId);
            this.showNotice(this.t('browser.selectorPickerHint'));

            while (this.selectorPicking && this.remotePreviewSessionId) {
                await new Promise((resolveWait) => window.setTimeout(resolveWait, 250));
                const result = await BrowserTestbenchPreview.selectorPickerResult(
                    this.remotePreviewSessionId,
                );

                if (result.status === 'picking') {
                    continue;
                }

                if (result.status === 'selected' && result.selector) {
                    const selected = this.project.nodes.find(
                        (candidate: DirectorNode) => candidate.id === selectedNodeId,
                    );

                    if (
                        selected?.type === 'browser-action' ||
                        (selected?.type === 'browser-wait' && selected.condition === 'element')
                    ) {
                        selected.selector = result.selector;
                    } else if (
                        selected?.type === 'layer' &&
                        selected.placement.reference.type === 'dom'
                    ) {
                        selected.placement.reference.selector = result.selector;
                    }

                    if (
                        selected?.type === 'browser-action' ||
                        (selected?.type === 'browser-wait' && selected.condition === 'element') ||
                        (selected?.type === 'layer' && selected.placement.reference.type === 'dom')
                    ) {
                        this.markActiveNodeStale();
                        this.renderGraph();
                        this.showNotice(
                            this.t('browser.selectorPicked', { selector: result.selector }),
                        );
                    }
                }

                break;
            }
        } catch (error) {
            this.showNotice(
                `${this.t('browser.selectorPickerFailed')} ${this.errorMessage(error)}`,
            );
        } finally {
            this.selectorPicking = false;
        }
    },
};

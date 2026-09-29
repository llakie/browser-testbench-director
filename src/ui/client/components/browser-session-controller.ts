import {
    BrowserTestbenchPreview,
    type BrowserTestbenchTarget,
} from '../core/browser-testbench-preview.js';
import type { NodeExecutionStatus } from '../core/execution-controller.js';
import { PreviewDocument } from '../core/preview-document.js';
import { ProjectFiles } from '../core/project-files.js';
import type { DirectorNode } from '../core/project-format.js';
import { WorkflowPlanner } from '../core/workflow-planner.js';
import { cloneWorkflowPlan, type WorkspaceMethodMap } from './workspace-model.js';

export const browserSessionMethods: WorkspaceMethodMap = {
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

            if (status.running) {
                await this.loadBrowserTargets();
            } else {
                this.clearBrowserTargets();
                this.remotePreviewSessionId = null;
                this.remotePreviewDirect = false;
                void this.restoreLocalPreview();
            }
        } catch {
            this.browserTestbenchState = 'stopped';
            this.browserTestbenchManaged = false;
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

            if (status.running) {
                await this.loadBrowserTargets();
            } else {
                this.clearBrowserTargets();
                this.remotePreviewSessionId = null;
                this.remotePreviewDirect = false;
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
        this.recordingMenuOpen = false;
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
            const plan = this.lastPreviewPlan ?? WorkflowPlanner.plan(this.project, 'root');

            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.close(this.remotePreviewSessionId).catch(
                    () => undefined,
                );
            }

            this.selectedBrowserTargetId = target.id;
            this.remotePreviewSessionId = await this.openRemotePlan(target, 'preview-state', plan);
            const steps = PreviewDocument.runtimeSteps(plan);

            if (this.remotePreviewDirect) {
                await BrowserTestbenchPreview.executeOnWebsite(
                    this.remotePreviewSessionId,
                    steps,
                    false,
                    this.inputData,
                    plan.cameraInputId,
                );
            } else {
                await BrowserTestbenchPreview.execute(this.remotePreviewSessionId, steps);
            }

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
        this.remotePreviewDirect = false;
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
            const plan = WorkflowPlanner.plan(this.project, 'node', selectedNodeId);
            this.assertPlanInputs(plan);

            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.close(this.remotePreviewSessionId).catch(
                    () => undefined,
                );
            }

            this.remotePreviewSessionId = await this.openRemotePlan(target, selectedNodeId, plan);
            const precedingSteps = PreviewDocument.runtimeSteps(plan).slice(0, -1);

            if (this.remotePreviewDirect) {
                await BrowserTestbenchPreview.executeOnWebsite(
                    this.remotePreviewSessionId,
                    precedingSteps,
                    false,
                    this.inputData,
                    plan.cameraInputId,
                );
            } else {
                await BrowserTestbenchPreview.execute(this.remotePreviewSessionId, precedingSteps);
            }

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
    async recordWorkflow(): Promise<void> {
        this.recordingMenuOpen = false;
        const target = this.selectedRecordingTarget;

        if (
            !target ||
            this.executionRunning ||
            this.browserTargetOpening ||
            this.recordingWorkflow ||
            !this.browserSessionInputsReady
        ) {
            return;
        }

        this.recordingWorkflow = true;
        this.recordingStopRequested = false;
        this.browserTargetOpening = true;
        let sessionId: string | null = null;
        let recordingStarted = false;
        let recordingCompleted = false;
        const previewSessionId = this.remotePreviewSessionId;
        const previewTargetId = this.selectedBrowserTargetId;
        const previewDirect = this.remotePreviewDirect;
        const recordingOnPreviewTarget = previewTargetId === target.id;
        const filename = `${ProjectFiles.filename(this.project.name).replace(/\.btd\.json$/u, '')}.mp4`;

        try {
            await Promise.all(Object.values(this.inputFileStores));
            const plan = WorkflowPlanner.plan(this.project, 'workflow');
            this.assertPlanInputs(plan);
            const audioTracks = plan.steps.flatMap((step) => {
                if (step.node.type !== 'audio' || !step.inputId) {
                    return [];
                }

                const input = plan.inputs.find((candidate) => candidate.id === step.inputId);
                return input?.file
                    ? [{ nodeId: step.node.id, asset: input.file.asset, volume: step.node.volume }]
                    : [];
            });

            if (recordingOnPreviewTarget && previewSessionId) {
                await BrowserTestbenchPreview.close(previewSessionId).catch(() => undefined);
            }

            sessionId = await this.openRemotePlan(target, 'workflow', plan, true);
            this.remotePreviewSessionId = sessionId;
            await BrowserTestbenchPreview.startRecording(sessionId!, filename);
            recordingStarted = true;
            this.startRecordingIndicator();
            this.browserTargetOpening = false;
            const completed = await this.runPlayback('workflow', undefined, true);

            if (!completed) {
                if (this.recordingStopRequested) {
                    throw new Error(this.t('recording.cancelled'));
                }

                const nodes = this.executionController.snapshot().nodes as Record<
                    string,
                    { status: NodeExecutionStatus; error?: string }
                >;
                const failure = Object.values(nodes).find((node) => node.status === 'error');
                throw new Error(failure?.error ?? this.t('recording.workflowFailed'));
            }

            this.stopRecordingIndicator();
            const recording = await BrowserTestbenchPreview.stopRecording(
                sessionId!,
                filename,
                target.kind === 'desktop' ? this.previewOutputSize : undefined,
                audioTracks,
            );
            recordingStarted = false;
            recordingCompleted = true;
            BrowserTestbenchPreview.downloadRecording(recording);
            this.showNotice(this.t('recording.completed', { name: filename }));
        } catch (error) {
            this.stopRecordingIndicator();

            if (recordingStarted && sessionId) {
                await BrowserTestbenchPreview.stopRecording(sessionId, filename).catch(
                    () => undefined,
                );
            }

            this.showNotice(
                this.recordingStopRequested
                    ? this.t('recording.cancelled')
                    : `${this.t('recording.failed')} ${this.errorMessage(error)}`,
            );
        } finally {
            this.stopRecordingIndicator();
            this.browserTargetOpening = false;
            this.recordingWorkflow = false;
            this.recordingStopRequested = false;
            const keepAsRemotePreview = recordingCompleted && recordingOnPreviewTarget;

            if (sessionId && !keepAsRemotePreview) {
                await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
            }

            if (keepAsRemotePreview) {
                this.remotePreviewSessionId = sessionId;
                this.selectedBrowserTargetId = target.id;
            } else if (!recordingOnPreviewTarget) {
                this.remotePreviewSessionId = previewSessionId;
                this.selectedBrowserTargetId = previewTargetId;
                this.remotePreviewDirect = previewDirect;
            } else {
                this.remotePreviewSessionId = null;
            }

            if (this.browserTestbenchRunning && !keepAsRemotePreview) {
                void this.loadBrowserTargets();
            }
        }
    },
    startRecordingIndicator(): void {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
        }

        this.recordingStartedAt = Date.now();
        this.recordingElapsedMs = 0;
        this.recordingActive = true;
        this.recordingTimer = setInterval(() => {
            this.recordingElapsedMs = Date.now() - this.recordingStartedAt;
        }, 250);
    },
    stopRecordingIndicator(): void {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
        }

        this.recordingTimer = undefined;
        this.recordingActive = false;
    },
    stopRecordingWorkflow(): void {
        if (!this.recordingActive) {
            return;
        }

        this.recordingStopRequested = true;
        this.stopPlayback();
    },
};

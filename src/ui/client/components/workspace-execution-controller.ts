import { nextTick } from 'vue';

import {
    BrowserTestbenchPreview,
    type BrowserTestbenchTarget,
} from '../core/browser-testbench-preview.js';
import type { NodeExecutionStatus } from '../core/execution-controller.js';
import { PreviewDocument } from '../core/preview-document.js';
import type { DirectorNode, InputNode } from '../core/project-format.js';
import { WorkflowPlanner, type PlaybackMode, type WorkflowPlan } from '../core/workflow-planner.js';
import {
    cloneWorkflowPlan,
    type PreviewRuntime,
    type RuntimeMessage,
    type WorkspaceMethodMap,
} from './workspace-model.js';

export const workspaceExecutionMethods: WorkspaceMethodMap = {
    handleEditorKeydown(event: KeyboardEvent): void {
        if (event.key !== 'Tab') return;
        event.preventDefault();
        const input = event.target;
        if (
            !(input instanceof HTMLTextAreaElement) ||
            (!this.activeLayer && !this.activeJavaScript)
        )
            return;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const value = input.value;
        input.value = `${value.slice(0, start)}    ${value.slice(end)}`;
        input.selectionStart = input.selectionEnd = start + 4;
        if (this.activeLayer) this.activeLayer.source[this.activeSource] = input.value;
        else if (this.activeJavaScript) this.activeJavaScript.source = input.value;
        this.markActiveNodeStale();
    },
    play(): void {
        if (!this.activeNode || ['input', 'capability'].includes(this.activeNode.type)) return;
        this.playNode(this.activeNode.id);
    },
    playNode(id: string): void {
        if (this.executionRunning || this.browserTargetOpening) return;
        const node = this.project.nodes.find((candidate: DirectorNode) => candidate.id === id);
        if (!node || ['input', 'capability'].includes(node.type)) return;
        this.activeNodeId = id;
        void this.runPlayback(node.type === 'website' ? 'root' : 'node', id);
        this.renderGraph();
        this.observePreviewStage();
    },
    playActiveNodeOnCurrentState(): void {
        if (
            !this.activeNode ||
            this.activeNode.type === 'website' ||
            this.activeNode.type === 'input' ||
            this.activeNode.type === 'capability' ||
            this.executionRunning ||
            this.browserTargetOpening
        )
            return;
        this.nodeMenuOpen = false;
        void this.runPlayback('current', this.activeNode.id);
    },
    playWorkflow(): void {
        if (this.executionRunning || this.browserTargetOpening) return;
        void this.runPlayback('workflow');
    },
    startPreviewInitialization(): void {
        const initialization = this.initializePreview();
        this.previewInitialization = initialization;
        void initialization.finally(() => {
            if (this.previewInitialization === initialization) {
                this.previewInitialization = null;
            }
        });
    },
    async runPlayback(mode: PlaybackMode, nodeId?: string, recording = false): Promise<boolean> {
        await this.previewInitialization;
        const plan = WorkflowPlanner.plan(this.project, mode, nodeId);
        const nodeIds = [
            ...plan.inputs.map((input) => input.id),
            ...(plan.resetWebsite && plan.website ? [plan.website.id] : []),
            ...plan.steps.map((step) => step.node.id),
        ];
        const runId = this.executionController.begin(nodeIds);
        if (runId === null) return false;
        if (this.remotePreviewSessionId) this.remotePreviewError = '';
        this.publishExecutionState();
        const remoteIsAuthoritative = Boolean(this.remotePreviewSessionId);
        try {
            await this.preparePlanInputs(plan, runId);
            await Promise.all([
                remoteIsAuthoritative ? Promise.resolve() : this.executeLocalPlan(plan, runId),
                this.syncRemotePreview(nodeId, plan, runId, recording),
            ]);
            this.executionController.complete(runId);
            if (mode !== 'current') {
                for (const step of plan.steps) this.staleNodeIds.delete(step.node.id);
            }
            this.capturePreviewState(plan);
            this.publishExecutionState();
            this.showNotice(this.t('playback.completed'));
            return true;
        } catch (error) {
            if (!this.executionState.running) return false;
            const activeNodeId = this.executionController.snapshot().activeNodeId;
            if (activeNodeId) {
                this.executionController.update(
                    runId,
                    activeNodeId,
                    'error',
                    this.errorMessage(error),
                );
            }
            this.executionController.complete(runId);
            this.publishExecutionState();
            const sessionId = this.remotePreviewSessionId;
            const keepRemotePreview = Boolean(
                !recording && sessionId && this.selectedBrowserTargetId,
            );
            if (keepRemotePreview) {
                this.remotePreviewError = this.errorMessage(error);
            } else {
                this.remotePreviewSessionId = null;
                if (sessionId)
                    await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
            }
            if (!recording && !keepRemotePreview && !this.selectedBrowserTargetId) {
                this.selectedBrowserTargetId = '';
                this.remotePreviewDirect = false;
                await this.restoreLocalPreview().catch(() => undefined);
            }
            this.showNotice(`${this.t('playback.failed')} ${this.errorMessage(error)}`);
            return false;
        }
    },
    async preparePlanInputs(
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        runId: number,
    ): Promise<void> {
        const selectedFiles: Record<string, File> = {};
        for (const input of plan.inputs) {
            this.updateExecution(runId, input.id, 'running');
            const file = this.inputFiles[input.id];
            if (!file && input.required) {
                throw new Error(this.t('input.missing', { name: input.name }));
            }
            if (file && !this.inputAcceptsFile(input, file)) {
                throw new Error(this.t('input.invalidType', { name: input.name }));
            }
            if (file) selectedFiles[input.id] = file;
            this.updateExecution(runId, input.id, 'success');
        }
        const prepared = await BrowserTestbenchPreview.prepareRuntimeInputs(
            selectedFiles,
            plan.inputs,
        );
        if (plan.resetWebsite) this.inputData = { ...prepared };
    },
    assertPlanInputs(plan: ReturnType<typeof WorkflowPlanner.plan>): void {
        for (const input of plan.inputs) {
            const file = this.inputFiles[input.id];
            if (!file && input.required) {
                throw new Error(this.t('input.missing', { name: input.name }));
            }
            if (file && !this.inputAcceptsFile(input, file)) {
                throw new Error(this.t('input.invalidType', { name: input.name }));
            }
        }
    },
    inputAcceptsFile(input: InputNode, file: File): boolean {
        const accepted = this.inputAcceptValues(input);
        if (accepted.length === 0) return true;
        const filename = file.name.toLowerCase();
        const mime = file.type.toLowerCase();
        return accepted.some((value: string) => {
            const normalized = value.toLowerCase();
            if (normalized.startsWith('.')) return filename.endsWith(normalized);
            if (normalized.endsWith('/*')) {
                return mime.startsWith(normalized.slice(0, -1));
            }
            return mime === normalized;
        });
    },
    async executeLocalPlan(
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        runId: number,
    ): Promise<void> {
        let runtime = this.previewRuntime();
        if (plan.resetWebsite || !runtime) {
            if (plan.website) {
                this.updateExecution(runId, plan.website.id, 'running');
                if (!plan.website.url.trim()) throw new Error(this.t('website.urlRequired'));
            }
            const localPlan = plan.website
                ? {
                      ...plan,
                      website: {
                          ...plan.website,
                          url: await BrowserTestbenchPreview.proxyWebsite(plan.website.url),
                      },
                  }
                : plan;
            this.loadPreview(PreviewDocument.buildPlan(localPlan, runId, this.inputData));
            runtime = await this.waitForPreviewRuntime();
            if (plan.website) this.updateExecution(runId, plan.website.id, 'success');
            await runtime.ready;
        } else {
            await runtime.run(PreviewDocument.runtimeSteps(plan), runId);
        }
        this.hasPlayed = true;
    },
    capturePreviewState(plan: WorkflowPlan): void {
        const cloned = cloneWorkflowPlan(plan);
        let snapshot: WorkflowPlan = {
            ...cloned,
            steps: cloned.steps.map((step: WorkflowPlan['steps'][number]) => ({
                ...step,
                speed: 'catchup',
            })),
        };
        if (plan.mode === 'current' && this.lastPreviewPlan) {
            const previous = cloneWorkflowPlan(this.lastPreviewPlan);
            snapshot = {
                ...snapshot,
                website: previous.website,
                inputs: previous.inputs,
                cameraInputId: previous.cameraInputId,
                resetWebsite: true,
                steps: [...previous.steps, ...snapshot.steps],
            };
        }
        this.lastPreviewPlan = snapshot;
        this.lastPreviewInputs = { ...this.inputData };
    },
    async initializePreview(): Promise<void> {
        const plan = WorkflowPlanner.plan(this.project, 'root');
        this.lastPreviewPlan = cloneWorkflowPlan(plan);
        this.lastPreviewInputs = {};
        try {
            await this.restoreLocalPreview();
        } catch (error) {
            this.loadPreview(
                PreviewDocument.buildPlan({ ...plan, website: null }, null, this.lastPreviewInputs),
            );
            this.showNotice(`${this.t('playback.failed')} ${this.errorMessage(error)}`);
        }
    },
    async restoreLocalPreview(): Promise<void> {
        const plan = this.lastPreviewPlan ?? WorkflowPlanner.plan(this.project, 'root');
        const website = plan.website?.url.trim()
            ? {
                  ...plan.website,
                  url: await BrowserTestbenchPreview.proxyWebsite(plan.website.url),
              }
            : plan.website;
        this.loadPreview(
            PreviewDocument.buildPlan({ ...plan, website }, null, this.lastPreviewInputs),
        );
        const runtime = await this.waitForPreviewRuntime();
        await runtime.ready;
    },
    loadPreview(document: string): void {
        this.previewDocument = document;
        this.previewRevision += 1;
    },
    previewRuntime(): PreviewRuntime | null {
        const frame = this.workspaceElement('previewFrame');
        if (!(frame instanceof HTMLIFrameElement)) return null;
        return (
            (frame.contentWindow as (Window & { __director?: PreviewRuntime }) | null)
                ?.__director ?? null
        );
    },
    async waitForPreviewRuntime(): Promise<PreviewRuntime> {
        await nextTick();
        const existing = this.previewRuntime();
        if (existing) return existing;
        const frame = this.workspaceElement('previewFrame');
        if (!(frame instanceof HTMLIFrameElement)) throw new Error('Preview frame is missing.');
        await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(
                () => reject(new Error('Preview runtime did not become ready.')),
                10_000,
            );
            const loaded = (): void => {
                clearTimeout(timeout);
                resolve();
            };
            frame.addEventListener('load', loaded, { once: true });
            if (this.previewRuntime()) {
                frame.removeEventListener('load', loaded);
                loaded();
            }
        });
        const runtime = this.previewRuntime();
        if (!runtime) throw new Error('Preview runtime is unavailable.');
        return runtime;
    },
    async syncRemotePreview(
        nodeId: string | undefined,
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        runId: number,
        recording = false,
    ): Promise<void> {
        const sessionId = this.remotePreviewSessionId;
        if (!sessionId) return;
        const websiteUrl = plan.website?.url.trim();
        const target = recording ? this.selectedRecordingTarget : this.selectedBrowserTarget;
        const direct = Boolean(target && this.usesDirectRemoteWebsite(plan, target));
        const steps = PreviewDocument.runtimeSteps(plan);
        if ((!recording && plan.resetWebsite) || direct !== this.remotePreviewDirect) {
            if (plan.website) this.updateExecution(runId, plan.website.id, 'running');
            if (direct) {
                await BrowserTestbenchPreview.navigateWebsite(sessionId, websiteUrl!);
            } else {
                await BrowserTestbenchPreview.navigate(
                    sessionId,
                    nodeId ?? 'workflow',
                    await this.remoteShellDocument(plan),
                );
            }
            if (plan.website) this.updateExecution(runId, plan.website.id, 'success');
            this.remotePreviewDirect = direct;
        }
        for (const step of steps) {
            this.updateExecution(runId, step.id, 'running');
            if (direct) {
                await BrowserTestbenchPreview.executeOnWebsite(
                    sessionId,
                    [step],
                    recording,
                    this.inputData,
                    plan.cameraInputId,
                );
            } else {
                await BrowserTestbenchPreview.execute(sessionId, [step], recording);
            }
            this.updateExecution(runId, step.id, 'success');
        }
    },
    async stopPlayback(): Promise<void> {
        if (!this.executionController.stop()) return;
        this.previewRuntime()?.cancel();
        this.publishExecutionState();
        const sessionId = this.remotePreviewSessionId;
        this.remotePreviewSessionId = null;
        if (sessionId) await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
        if (this.selectedBrowserTargetId) {
            this.selectedBrowserTargetId = '';
            this.remotePreviewDirect = false;
            this.remotePreviewError = '';
            await this.restoreLocalPreview().catch(() => undefined);
        }
        this.showNotice(this.t('playback.stopped'));
        if (this.browserTestbenchRunning) void this.loadBrowserTargets();
    },
    handleRuntimeMessage(event: MessageEvent<RuntimeMessage>): void {
        const frame = this.workspaceElement('previewFrame');
        if (!(frame instanceof HTMLIFrameElement) || event.source !== frame.contentWindow) return;
        if (event.data?.type !== 'director:execution' || this.remotePreviewSessionId) return;
        const runId = this.executionController.snapshot().runId;
        if (event.data.executionId !== runId) return;
        this.updateExecution(runId, event.data.nodeId, event.data.status, event.data.error);
    },
    updateExecution(
        runId: number,
        nodeId: string,
        status: NodeExecutionStatus,
        error?: string,
    ): void {
        if (!this.executionController.update(runId, nodeId, status, error)) return;
        this.publishExecutionState();
    },
    publishExecutionState(): void {
        this.executionState = this.executionController.snapshot();
        this.renderGraph();
    },
    usesDirectRemoteWebsite(
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        target: BrowserTestbenchTarget,
    ): boolean {
        return Boolean(
            plan.website?.url.trim() &&
            (!plan.cameraInputId || target.capabilities.mediaInjection.cameraImage),
        );
    },
    async openRemotePlan(
        target: BrowserTestbenchTarget,
        nodeId: string,
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        recording = false,
    ): Promise<string> {
        this.remotePreviewDirect = this.usesDirectRemoteWebsite(plan, target);
        let sessionId: string;
        if (this.remotePreviewDirect) {
            sessionId = await BrowserTestbenchPreview.openWebsite(
                target,
                plan.website!.url.trim(),
                this.project.browserSession,
                this.inputFiles,
                plan.inputs,
                plan.cameraInputId,
                recording && target.kind === 'desktop',
            );
        } else {
            const inputs = await BrowserTestbenchPreview.prepareRuntimeInputs(
                this.inputFiles,
                plan.inputs,
            );
            sessionId = await BrowserTestbenchPreview.open(
                target.id,
                nodeId,
                await this.remoteShellDocument(plan, inputs),
                {},
                [],
                recording && target.kind === 'desktop',
            );
        }
        if (target.kind === 'desktop') {
            await BrowserTestbenchPreview.setViewport(sessionId, this.project.viewport);
        }
        return sessionId;
    },
    async remoteShellDocument(
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        inputs?: Readonly<Record<string, string>>,
    ): Promise<string> {
        const website = plan.website?.url.trim()
            ? {
                  ...plan.website,
                  url: await BrowserTestbenchPreview.proxyWebsite(plan.website.url),
              }
            : plan.website;
        return PreviewDocument.buildPlan(
            { ...plan, website, steps: [] },
            null,
            inputs ?? this.inputData,
        );
    },
};

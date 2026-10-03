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
    play(): void {
        this.audioPlayback.unlock();

        if (!this.activeNode || ['input', 'capability'].includes(this.activeNode.type)) {
            return;
        }

        this.playNode(this.activeNode.id);
    },
    playNode(id: string): void {
        this.audioPlayback.unlock();
        const node = this.project.nodes.find((candidate: DirectorNode) => candidate.id === id);

        if (!node || ['input', 'capability'].includes(node.type)) {
            return;
        }

        if (node.type === 'video-output') {
            if (this.recordingWorkflow) {
                void this.stopRecordingWorkflow();
                return;
            }

            if (this.executionRunning || this.browserTargetOpening) {
                return;
            }

            this.activeNodeId = id;
            this.selectedRecordingTargetId = node.targetId;

            if (!this.selectedRecordingTarget) {
                this.showNotice(this.t('videoOutput.selectTarget'));
                this.renderGraph();
                return;
            }

            void this.recordWorkflow();
            this.renderGraph();
            return;
        }

        if (this.executionRunning && this.playbackTriggerNodeId === id) {
            this.stopPlayback();
            return;
        }

        if (this.executionRunning || this.browserTargetOpening) {
            return;
        }

        this.activeNodeId = id;
        this.playbackTriggerNodeId = id;
        void this.runPlayback(node.type === 'website' ? 'root' : 'node', id).finally(() => {
            if (this.playbackTriggerNodeId === id) {
                this.playbackTriggerNodeId = null;
                this.renderGraph();
            }
        });
        this.renderGraph();
        this.observePreviewStage();
    },
    playActiveNodeOnCurrentState(): void {
        if (
            this.executionRunning &&
            this.activeAudio &&
            this.instantAudioNodeId === this.activeAudio.id
        ) {
            if (this.audioPlaybackActive) {
                void this.setActiveAudioPaused(!this.audioPaused);
            }

            return;
        }

        this.audioPlayback.unlock();

        if (
            !this.activeNode ||
            this.activeNode.type === 'website' ||
            this.activeNode.type === 'input' ||
            this.activeNode.type === 'capability' ||
            this.executionRunning ||
            this.browserTargetOpening
        ) {
            return;
        }

        const nodeId = this.activeNode.id;
        this.nodeMenuOpen = false;
        this.playbackTriggerNodeId = nodeId;
        this.instantAudioNodeId = this.activeAudio ? nodeId : null;
        void this.runPlayback('current', nodeId).finally(() => {
            if (this.instantAudioNodeId === nodeId) {
                this.instantAudioNodeId = null;
            }

            if (this.playbackTriggerNodeId === nodeId) {
                this.playbackTriggerNodeId = null;
                this.renderGraph();
            }
        });
        this.renderGraph();
    },
    refreshAudioPosition(): void {
        const audio = this.activeAudio;

        if (!audio) {
            this.audioPositionMs = 0;
            this.audioPlaybackActive = false;

            if (!this.instantAudioNodeId) {
                this.audioPaused = false;
            }

            this.audioScrubbing = false;
            return;
        }

        const inputId = this.activeAudioInputId;
        const source = inputId ? this.inputData[inputId] : undefined;

        if (source && source !== this.audioDurationSource) {
            this.audioDurationSource = source;
            this.audioDurationMs = 0;
            void this.audioPlayback.duration(source, inputId!).then((duration: number) => {
                if (this.audioDurationSource === source) {
                    this.audioDurationMs = duration;
                }
            }).catch(() => undefined);
        } else if (!source && this.audioDurationSource) {
            this.audioDurationSource = '';
            this.audioDurationMs = 0;
        }

        const localPosition = this.audioPlayback.position(audio.id);

        if (localPosition) {
            this.audioPlaybackActive = true;
            this.audioPaused = localPosition.paused;

            if (!this.audioScrubbing) {
                this.audioPositionMs = localPosition.positionMs;
            }

            this.audioDurationMs = localPosition.durationMs;
            return;
        }

        if (!this.executionRunning || !this.remotePreviewSessionId) {
            this.audioPlaybackActive = false;

            if (!this.instantAudioNodeId) {
                this.audioPaused = false;
            }

            if (!this.audioScrubbing) {
                this.audioPositionMs = 0;
            }

            return;
        }
    },
    async setActiveAudioPaused(paused: boolean): Promise<void> {
        const audio = this.activeAudio;

        if (!this.audioSeekEnabled || !audio) {
            return;
        }

        if (!paused) {
            this.audioPlayback.unlock();
        }

        this.audioPaused = paused;

        try {
            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.setAudioPaused(
                    this.remotePreviewSessionId,
                    audio.id,
                    paused,
                );
            } else if (paused) {
                this.audioPlayback.pause(audio.id);
            } else {
                this.audioPlayback.resume(audio.id);
            }

            this.audioPaused = paused;
            this.renderGraph();
        } catch (error) {
            this.audioPaused = !paused;
            this.renderGraph();
            this.showNotice(`${this.t('playback.failed')} ${this.errorMessage(error)}`);
        }
    },
    async seekActiveAudio(milliseconds: number): Promise<void> {
        const audio = this.activeAudio;

        if (!this.audioSeekEnabled || !audio || !Number.isFinite(milliseconds)) {
            this.audioScrubbing = false;
            return;
        }

        const positionMs = Math.min(this.audioDurationMs, Math.max(0, milliseconds));
        this.audioPositionMs = positionMs;

        try {
            if (this.remotePreviewSessionId) {
                await BrowserTestbenchPreview.seekAudio(
                    this.remotePreviewSessionId,
                    audio.id,
                    positionMs / 1000,
                );
            } else {
                this.audioPlayback.seek(audio.id, positionMs / 1000);
            }
        } catch (error) {
            this.showNotice(`${this.t('playback.failed')} ${this.errorMessage(error)}`);
        } finally {
            this.audioScrubbing = false;
        }
    },
    formatAudioTime(milliseconds: number): string {
        const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
        return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    },
    async playWorkflow(): Promise<void> {
        this.audioPlayback.unlock();

        if (
            this.workflowStartPending ||
            this.workflowPlaybackRunning ||
            this.recordingWorkflow ||
            this.browserTargetOpening
        ) {
            return;
        }

        this.workflowStartPending = true;

        try {
            if (this.executionRunning) {
                await this.stopPlayback();
            }

            await this.previewInitialization;
            this.playbackTriggerNodeId = null;
            void this.runPlayback('workflow');
            await nextTick();
        } finally {
            this.workflowStartPending = false;
        }
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

        if (runId === null) {
            return false;
        }

        if (this.remotePreviewSessionId) {
            this.remotePreviewError = '';
        }

        this.publishExecutionState();
        const remoteIsAuthoritative = Boolean(this.remotePreviewSessionId);

        try {
            await this.preparePlanInputs(plan, runId);
            await Promise.all([
                remoteIsAuthoritative ? Promise.resolve() : this.executeLocalPlan(plan, runId),
                this.syncRemotePreview(nodeId, plan, runId, recording),
            ]);

            if (this.executionController.snapshot().runId !== runId) {
                return false;
            }

            if (mode !== 'current') {
                await this.stopPlaybackAudio();
            }

            this.executionController.complete(runId);

            if (mode !== 'current') {
                for (const step of plan.steps) {
                    this.staleNodeIds.delete(step.node.id);
                }
            }

            this.capturePreviewState(plan);
            this.publishExecutionState();
            this.showNotice(this.t('playback.completed'));
            return true;
        } catch (error) {
            const execution = this.executionController.snapshot();

            if (!execution.running || execution.runId !== runId) {
                return false;
            }

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
            } else if (!recording) {
                this.remotePreviewSessionId = null;

                if (sessionId) {
                    await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
                }
            }

            if (!recording && !keepRemotePreview && !this.selectedBrowserTargetId) {
                this.selectedBrowserTargetId = '';
                await this.restoreLocalPreview().catch(() => undefined);
            }

            this.showNotice(`${this.t('playback.failed')} ${this.errorMessage(error)}`);
            return false;
        }
    },
    async stopPlaybackAudio(): Promise<void> {
        this.audioPlayback.cancel();
        const sessionId = this.remotePreviewSessionId;

        if (sessionId) {
            await BrowserTestbenchPreview.stopAudio(sessionId);
        }
    },
    async preparePlanInputs(
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        runId: number,
    ): Promise<void> {
        const selectedFiles: Record<string, File> = {};
        const audioInputIds = new Set(
            plan.steps.map((step) => step.inputId).filter((id): id is string => Boolean(id)),
        );
        const fontInputIds = new Set(
            plan.steps
                .map((step) =>
                    step.node.type === 'layer'
                        ? (step.node.fontInputId ??
                          (step.node.text?.font === 'project'
                              ? step.node.text.fontInputId
                              : undefined))
                        : undefined,
                )
                .filter((id): id is string => Boolean(id)),
        );

        for (const input of plan.inputs) {
            this.updateExecution(runId, input.id, 'running');
            const file = this.inputFiles[input.id];

            if (
                !file &&
                (input.required ||
                    audioInputIds.has(input.id) ||
                    fontInputIds.has(input.id) ||
                    plan.globalStylesheetInputIds.includes(input.id))
            ) {
                throw new Error(this.t('input.missing', { name: input.name }));
            }

            if (file && !this.inputAcceptsFile(input, file)) {
                throw new Error(this.t('input.invalidType', { name: input.name }));
            }

            if (file) {
                selectedFiles[input.id] = file;
            }

            this.updateExecution(runId, input.id, 'success');
        }

        const prepared = await BrowserTestbenchPreview.prepareRuntimeInputs(
            selectedFiles,
            plan.inputs,
        );

        this.inputData = plan.resetWebsite ? { ...prepared } : { ...this.inputData, ...prepared };
    },
    assertPlanInputs(plan: ReturnType<typeof WorkflowPlanner.plan>): void {
        const audioInputIds = new Set(
            plan.steps.map((step) => step.inputId).filter((id): id is string => Boolean(id)),
        );
        const fontInputIds = new Set(
            plan.steps
                .map((step) =>
                    step.node.type === 'layer'
                        ? (step.node.fontInputId ??
                          (step.node.text?.font === 'project'
                              ? step.node.text.fontInputId
                              : undefined))
                        : undefined,
                )
                .filter((id): id is string => Boolean(id)),
        );

        for (const input of plan.inputs) {
            const file = this.inputFiles[input.id];

            if (
                !file &&
                (input.required ||
                    audioInputIds.has(input.id) ||
                    fontInputIds.has(input.id) ||
                    plan.globalStylesheetInputIds.includes(input.id))
            ) {
                throw new Error(this.t('input.missing', { name: input.name }));
            }

            if (file && !this.inputAcceptsFile(input, file)) {
                throw new Error(this.t('input.invalidType', { name: input.name }));
            }
        }
    },
    inputAcceptsFile(input: InputNode, file: File): boolean {
        const accepted = this.inputAcceptValues(input);

        if (accepted.length === 0) {
            return true;
        }

        const filename = file.name.toLowerCase();
        const mime = file.type.toLowerCase();
        return accepted.some((value: string) => {
            const normalized = value.toLowerCase();

            if (normalized.startsWith('.')) {
                return filename.endsWith(normalized);
            }

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
            runtime?.cancel();

            if (plan.website) {
                this.updateExecution(runId, plan.website.id, 'running');

                if (!plan.website.url.trim()) {
                    throw new Error(this.t('website.urlRequired'));
                }
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

            if (plan.website) {
                this.updateExecution(runId, plan.website.id, 'success');
            }

            await runtime.ready;
        } else {
            runtime.setInputs(this.inputData);
            runtime.setGlobalStylesheetInputIds(plan.globalStylesheetInputIds);
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
                inputs: [
                    ...previous.inputs,
                    ...snapshot.inputs.filter(
                        (input) => !previous.inputs.some((existing) => existing.id === input.id),
                    ),
                ],
                cameraInputId: previous.cameraInputId,
                globalStylesheetInputIds: [
                    ...new Set([
                        ...previous.globalStylesheetInputIds,
                        ...snapshot.globalStylesheetInputIds,
                    ]),
                ],
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

        if (!(frame instanceof HTMLIFrameElement)) {
            return null;
        }

        return (
            (frame.contentWindow as (Window & { __director?: PreviewRuntime }) | null)
                ?.__director ?? null
        );
    },
    async waitForPreviewRuntime(): Promise<PreviewRuntime> {
        await nextTick();
        const existing = this.previewRuntime();

        if (existing) {
            return existing;
        }

        const frame = this.workspaceElement('previewFrame');

        if (!(frame instanceof HTMLIFrameElement)) {
            throw new Error('Preview frame is missing.');
        }

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

        if (!runtime) {
            throw new Error('Preview runtime is unavailable.');
        }

        return runtime;
    },
    async syncRemotePreview(
        nodeId: string | undefined,
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        runId: number,
        recording = false,
    ): Promise<void> {
        const sessionId = this.remotePreviewSessionId;

        if (!sessionId) {
            return;
        }

        const steps = PreviewDocument.runtimeSteps(plan);

        if (!recording && plan.resetWebsite) {
            if (plan.website) {
                this.updateExecution(runId, plan.website.id, 'running');
            }

            const cameraInputId = plan.cameraInputId;
            const shellInputs =
                cameraInputId && this.inputData[cameraInputId]
                    ? { [cameraInputId]: this.inputData[cameraInputId] }
                    : {};
            await BrowserTestbenchPreview.navigate(
                sessionId,
                nodeId ?? 'workflow',
                await this.remoteShellDocument(plan, shellInputs),
            );
            await BrowserTestbenchPreview.setRuntimeInputs(sessionId, this.inputData);

            if (plan.website) {
                this.updateExecution(runId, plan.website.id, 'success');
            }
        }

        const marks = await BrowserTestbenchPreview.execute(
            sessionId,
            steps,
            recording,
            undefined,
            (event) => this.updateExecution(runId, event.nodeId, event.status, event.error),
            (positions) => {
                const position = this.activeAudio && positions[this.activeAudio.id];

                if (position) {
                    this.audioPlaybackActive = true;
                    this.audioPaused = position.paused;

                    if (!this.audioScrubbing) {
                        this.audioPositionMs = position.positionMs;
                    }

                    this.audioDurationMs = position.durationMs;
                } else {
                    this.audioPlaybackActive = false;

                    if (!this.instantAudioNodeId) {
                        this.audioPaused = false;
                    }
                }
            },
        );

        if (recording) {
            this.recordingMarks = [...marks];
        }
    },
    async stopPlayback(): Promise<void> {
        if (!this.executionController.stop()) {
            return;
        }

        this.previewRuntime()?.cancel();
        this.publishExecutionState();
        const sessionId = this.remotePreviewSessionId;
        this.audioPositionMs = 0;
        this.audioPlaybackActive = false;
        this.audioPaused = false;
        this.remotePreviewSessionId = null;

        if (sessionId) {
            await BrowserTestbenchPreview.cancelRuntime(sessionId).catch(() => undefined);
            await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
        }

        if (this.selectedBrowserTargetId) {
            this.selectedBrowserTargetId = '';
            this.remotePreviewError = '';
            await this.restoreLocalPreview().catch(() => undefined);
        }

        this.showNotice(this.t('playback.stopped'));

        if (this.browserTestbenchRunning) {
            void this.loadBrowserTargets();
        }
    },
    handleRuntimeMessage(event: MessageEvent<RuntimeMessage>): void {
        const frame = this.workspaceElement('previewFrame');

        if (!(frame instanceof HTMLIFrameElement) || event.source !== frame.contentWindow) {
            return;
        }

        if (event.data?.type !== 'director:execution' || this.remotePreviewSessionId) {
            return;
        }

        const runId = this.executionController.snapshot().runId;

        if (event.data.executionId !== runId) {
            return;
        }

        this.updateExecution(runId, event.data.nodeId, event.data.status, event.data.error);
    },
    updateExecution(
        runId: number,
        nodeId: string,
        status: NodeExecutionStatus,
        error?: string,
    ): void {
        if (!this.executionController.update(runId, nodeId, status, error)) {
            return;
        }

        this.publishExecutionState();
    },
    publishExecutionState(): void {
        this.executionState = this.executionController.snapshot();
        this.renderGraph();
    },
    async openRemotePlan(
        target: BrowserTestbenchTarget,
        nodeId: string,
        plan: ReturnType<typeof WorkflowPlanner.plan>,
        recording = false,
    ): Promise<string> {
        const inputs = await BrowserTestbenchPreview.prepareRuntimeInputs(
            this.inputFiles,
            plan.inputs,
        );
        const cameraInputId = plan.cameraInputId;
        const shellInputs =
            cameraInputId && inputs[cameraInputId]
                ? { [cameraInputId]: inputs[cameraInputId] }
                : {};
        const sessionId = await BrowserTestbenchPreview.open(
            target,
            nodeId,
            await this.remoteShellDocument(plan, shellInputs),
            this.inputFiles,
            plan.inputs,
            false,
            this.project.browserSession,
            recording,
        );

        try {
            if (target.kind === 'desktop') {
                await BrowserTestbenchPreview.setViewport(sessionId, this.previewViewport);
            }

            return sessionId;
        } catch (error) {
            await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
            throw error;
        }
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
        return PreviewDocument.buildPlan({ ...plan, website, steps: [] }, null, inputs ?? {});
    },
};

import { defineComponent, markRaw } from 'vue';

import { DirectorTopbar } from './director-topbar.js';
import { browserSessionMethods } from './browser-session-controller.js';
import { GraphPanel } from './graph-panel.js';
import { McpSetupDialog } from './mcp-setup-dialog.js';
import { NodeEditorPanel } from './node-editor-panel.js';
import { PreviewPanel } from './preview-panel.js';
import { ProjectSettingsDialog } from './project-settings-dialog.js';
import { projectMethods } from './project-controller.js';
import { workspaceEditingMethods } from './workspace-editing-controller.js';
import { workspaceExecutionMethods } from './workspace-execution-controller.js';
import { workspaceLayoutMethods } from './workspace-layout-controller.js';
import {
    WorkspaceLayoutPreferences,
    type BrowserTestbenchState,
    type McpClientStatus,
    type SourceType,
    type Splitter,
    type ViewportPreset,
    type WorkspacePanel,
    viewportPresets,
} from './workspace-model.js';

import type { BrowserTestbenchTarget } from '../core/browser-testbench-preview.js';
import { ExecutionController, type ExecutionSnapshot } from '../core/execution-controller.js';
import { JointLayerGraph } from '../core/joint-layer-graph.js';
import { previewOutputSize } from '../core/media-presets.js';
import { ProjectFiles, type ProjectFileHandle } from '../core/project-files.js';
import { StagePanGesture, StageZoomGesture } from '../core/stage-zoom-gesture.js';
import { WorkflowPlanner, type WorkflowPlan } from '../core/workflow-planner.js';
import { WorkflowGraph } from '../core/workflow-graph.js';
import {
    BROWSER_PERMISSIONS,
    ProjectFormat,
    type BrowserActionNode,
    type BrowserWaitNode,
    type CapabilityNode,
    type DirectorNode,
    type HorizontalAlignment,
    type InputNode,
    type JavaScriptNode,
    type LayerNode,
    type MergeNode,
    type VerticalAlignment,
    type WebsiteNode,
} from '../core/project-format.js';
import { Translator } from '../core/translator.js';

export const EditorWorkspace = defineComponent({
    components: {
        DirectorTopbar,
        GraphPanel,
        McpSetupDialog,
        NodeEditorPanel,
        PreviewPanel,
        ProjectSettingsDialog,
    },
    data: () => {
        const project = ProjectFormat.create();
        const executionController = markRaw(new ExecutionController());
        return {
            project,
            activeNodeId: (project.nodes.find((node) => node.type === 'layer') ?? project.nodes[0])!
                .id as string | null,
            activeConnectionId: null as string | null,
            activeSource: 'html' as SourceType,
            sourceTypes: ['html', 'css', 'javascript'] as SourceType[],
            formattingSource: false,
            previewDocument: '',
            previewRevision: 0,
            previewInitialization: null as Promise<void> | null,
            lastPreviewPlan: null as WorkflowPlan | null,
            lastPreviewInputs: {} as Record<string, string>,
            staleNodeIds: new Set<string>(),
            hasPlayed: false,
            dirty: false,
            savingProject: false,
            filename: ProjectFiles.filename(project.name),
            projectFileHandle: null as ProjectFileHandle | null,
            notice: '',
            graph: null as JointLayerGraph | null,
            noticeTimer: undefined as ReturnType<typeof setTimeout> | undefined,
            layout: WorkspaceLayoutPreferences.read(),
            activeSplitter: null as Splitter | null,
            maximizedPanel: null as WorkspacePanel | null,
            previewFitScale: 1,
            graphZoom: 1,
            graphLayoutRunning: false,
            graphZoomGesture: markRaw(new StageZoomGesture()),
            graphPanGesture: markRaw(new StagePanGesture()),
            previewResizeObserver: null as ResizeObserver | null,
            mobileActivePanel: 'graph' as WorkspacePanel,
            deviceMenuOpen: false,
            nodeMenuOpen: false,
            recordingMenuOpen: false,
            viewportPresets,
            browserTargets: [] as BrowserTestbenchTarget[],
            inputFiles: {} as Record<string, File>,
            inputData: {} as Record<string, string>,
            inputFileStores: {} as Record<string, Promise<void>>,
            inputFileSelectionRevisions: {} as Record<string, number>,
            inputAcceptQueries: {} as Record<string, string>,
            activeInputAcceptId: null as string | null,
            selectedBrowserTargetId: '',
            selectedRecordingTargetId: '',
            browserTargetsLoading: false,
            browserTargetOpening: false,
            browserTestbenchState: 'checking' as BrowserTestbenchState,
            browserTestbenchManaged: false,
            remotePreviewSessionId: null as string | null,
            remotePreviewDirect: false,
            remotePreviewError: '',
            recordingWorkflow: false,
            recordingActive: false,
            recordingElapsedMs: 0,
            recordingStartedAt: 0,
            recordingTimer: undefined as ReturnType<typeof setInterval> | undefined,
            recordingStopRequested: false,
            selectorPicking: false,
            mcpSetupOpen: false,
            mobileMenuOpen: false,
            projectSettingsOpen: false,
            projectPermissionsOpen: false,
            browserPermissions: BROWSER_PERMISSIONS,
            mcpClients: [] as McpClientStatus[],
            mcpLoading: false,
            mcpLoadError: '',
            executionController,
            executionState: executionController.snapshot() as ExecutionSnapshot,
        };
    },
    computed: {
        activeNode(): DirectorNode | null {
            if (!this.activeNodeId) {
                return null;
            }

            return this.project.nodes.find((node) => node.id === this.activeNodeId) ?? null;
        },
        activeLayer(): LayerNode | null {
            return this.activeNode?.type === 'layer' ? this.activeNode : null;
        },
        activeWebsite(): WebsiteNode | null {
            return this.activeNode?.type === 'website' ? this.activeNode : null;
        },
        activeInput(): InputNode | null {
            return this.activeNode?.type === 'input' ? this.activeNode : null;
        },
        activeCapability(): CapabilityNode | null {
            return this.activeNode?.type === 'capability' ? this.activeNode : null;
        },
        activeMerge(): MergeNode | null {
            return this.activeNode?.type === 'merge' ? this.activeNode : null;
        },
        inputNodes(): InputNode[] {
            return this.project.nodes.filter((node): node is InputNode => node.type === 'input');
        },
        workflowInputNodes(): InputNode[] {
            const connectedNodeIds = WorkflowGraph.connectedNodeIds(this.project);
            return this.inputNodes.filter((input) => connectedNodeIds.has(input.id));
        },
        cameraInputId(): string | null {
            return WorkflowPlanner.plan(this.project, 'workflow').cameraInputId;
        },
        activeJavaScript(): JavaScriptNode | null {
            return this.activeNode?.type === 'javascript' ? this.activeNode : null;
        },
        activeBrowserAction(): BrowserActionNode | null {
            return this.activeNode?.type === 'browser-action' ? this.activeNode : null;
        },
        activeBrowserWait(): BrowserWaitNode | null {
            return this.activeNode?.type === 'browser-wait' ? this.activeNode : null;
        },
        executionRunning(): boolean {
            return this.executionState.running;
        },
        recordingElapsedLabel(): string {
            const seconds = Math.floor(this.recordingElapsedMs / 1000);
            const minutes = Math.floor(seconds / 60);
            return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        },
        activeNodeError(): string {
            if (!this.activeNodeId) {
                return '';
            }

            return this.executionState.nodes[this.activeNodeId]?.error ?? '';
        },
        websiteNode(): WebsiteNode | null {
            return this.project.nodes.find((node) => node.type === 'website') ?? null;
        },
        browserSession() {
            return this.project.browserSession;
        },
        browserPermissionSummary(): string {
            const permissions = this.project.browserSession.permissions;
            return permissions.length
                ? permissions.map((permission) => this.t(`browserSession.${permission}`)).join(', ')
                : this.t('browserSession.noPermissions');
        },
        sourceLineCount(): number {
            const source =
                this.activeLayer?.source[this.activeSource] ??
                this.activeJavaScript?.source ??
                (this.activeBrowserWait?.condition === 'script'
                    ? this.activeBrowserWait.script
                    : undefined);
            return source?.split('\n').length ?? 0;
        },
        placementReferenceType(): 'viewport' | 'layer' | 'dom' {
            return this.activeLayer?.placement.reference.type ?? 'viewport';
        },
        availableParentLayers(): LayerNode[] {
            if (!this.activeLayer) {
                return [];
            }

            const ordered = WorkflowGraph.componentNodeIds(this.project, this.activeLayer.id);
            const activeIndex = ordered.indexOf(this.activeLayer.id);
            const precedingIds = new Set(ordered.slice(0, Math.max(0, activeIndex)));
            return this.project.nodes.filter(
                (node): node is LayerNode => node.type === 'layer' && precedingIds.has(node.id),
            );
        },
        horizontalAlignment(): HorizontalAlignment {
            return this.activeLayer?.placement.horizontal ?? 'center';
        },
        verticalAlignment(): VerticalAlignment {
            return this.activeLayer?.placement.vertical ?? 'center';
        },
        lineNumbers(): string {
            return Array.from({ length: this.sourceLineCount }, (_value, index) => index + 1).join(
                '\n',
            );
        },
        previewOrientation(): 'portrait' | 'landscape' {
            return this.previewViewport.height > this.previewViewport.width
                ? 'portrait'
                : 'landscape';
        },
        viewportLabel(): string {
            if (this.selectedBrowserTarget) {
                return this.browserTargetLabel(this.selectedBrowserTarget);
            }

            return `${this.previewViewport.width} × ${this.previewViewport.height} CSS`;
        },
        currentViewportPreset(): ViewportPreset {
            return this.viewportPresets.find(
                (preset) => preset.id === this.project.preview.preset,
            )!;
        },
        previewViewport(): Readonly<{ width: number; height: number }> {
            return this.currentViewportPreset.viewport;
        },
        previewOutputSize(): Readonly<{ width: number; height: number }> {
            return previewOutputSize(this.project.preview.preset);
        },
        viewportPresetIcon(): string {
            if (this.selectedBrowserTarget) {
                return this.selectedBrowserTarget.kind === 'mobile' ? 'bi-phone' : 'bi-display';
            }

            return this.currentViewportPreset.icon;
        },
        viewportPresetLabel(): string {
            return this.t(this.currentViewportPreset.labelKey);
        },
        previewDestinationLabel(): string {
            return this.selectedBrowserTarget
                ? this.browserTargetLabel(this.selectedBrowserTarget)
                : this.viewportPresetLabel;
        },
        selectedBrowserTarget(): BrowserTestbenchTarget | undefined {
            return this.compatiblePreviewTargets.find(
                (target) => target.id === this.selectedBrowserTargetId,
            );
        },
        selectedRecordingTarget(): BrowserTestbenchTarget | undefined {
            return this.compatibleRecordingTargets.find(
                (target) => target.id === this.selectedRecordingTargetId,
            );
        },
        compatiblePreviewTargets(): BrowserTestbenchTarget[] {
            return this.browserTargets.filter((target) => this.isCompatiblePreviewTarget(target));
        },
        compatibleRecordingTargets(): BrowserTestbenchTarget[] {
            return this.browserTargets.filter((target) => this.isCompatibleRecordingTarget(target));
        },
        availableRecordingTargets(): BrowserTestbenchTarget[] {
            const targets = this.compatibleRecordingTargets.filter(
                (target) =>
                    target.ready && (!target.busy || target.id === this.selectedBrowserTargetId),
            );
            const preferredId = this.selectedBrowserTargetId || this.selectedRecordingTargetId;
            return [...targets].sort((left, right) => {
                if (left.id === preferredId) {
                    return -1;
                }

                if (right.id === preferredId) {
                    return 1;
                }

                return 0;
            });
        },
        recordingTargetsAvailable(): boolean {
            return this.availableRecordingTargets.length > 0;
        },
        browserSessionInputsReady(): boolean {
            return this.workflowInputNodes.every(
                (input) => input.required !== true || Boolean(this.inputFiles[input.id]),
            );
        },
        browserTestbenchRunning(): boolean {
            return this.browserTestbenchState === 'running';
        },
        browserTestbenchTransitioning(): boolean {
            return ['checking', 'starting', 'stopping'].includes(this.browserTestbenchState);
        },
        browserTestbenchLifecycleLabel(): string {
            return this.t(`preview.testbench.${this.browserTestbenchState}`);
        },
        playActionLabel(): string {
            if (this.activeWebsite) {
                return this.t('preview.reloadWebsite');
            }

            return this.t(this.hasPlayed ? 'preview.playAgain' : 'preview.play');
        },
        editorPanelTitle(): string {
            if (this.activeWebsite) {
                return this.t('website.title');
            }

            if (this.activeInput) {
                return this.t('input.title');
            }

            if (this.activeCapability) {
                return this.t('capability.title');
            }

            if (this.activeMerge) {
                return this.t('merge.title');
            }

            if (this.activeJavaScript) {
                return this.t('javascript.title');
            }

            if (this.activeBrowserAction) {
                return this.t('browserAction.title');
            }

            if (this.activeBrowserWait) {
                return this.t('browserWait.title');
            }

            return this.t('editor.title');
        },
        previewScale(): number {
            return this.previewFitScale;
        },
        graphZoomPercent(): number {
            return Math.round(this.graphZoom * 100);
        },
        viewportStyle(): Record<string, string> {
            const width = this.previewViewport.width;
            const height = this.previewViewport.height;
            return {
                '--preview-frame-width': `${width}px`,
                '--preview-frame-height': `${height}px`,
                '--preview-scale': String(this.previewScale),
                '--preview-rendered-width': `${width * this.previewScale}px`,
                '--preview-rendered-height': `${height * this.previewScale}px`,
            };
        },
        workspaceStyle(): Record<string, string> {
            return {
                '--portrait-tools': `${this.layout.portraitTools}%`,
                '--landscape-preview': `${this.layout.landscapePreview}%`,
                '--tools-split': `${this.layout.toolsSplit}%`,
            };
        },
    },
    mounted(): void {
        document.documentElement.lang = Translator.locale;
        const graphElement = this.workspaceElement('graph');

        if (!(graphElement instanceof HTMLElement)) {
            throw new Error('Graph canvas is missing.');
        }

        this.graph = markRaw(
            new JointLayerGraph(graphElement, {
                selectNode: (id) => this.selectNode(id),
                positionNode: (id, x, y) => {
                    const node = this.project.nodes.find((candidate) => candidate.id === id);

                    if (!node || (node.position?.x === x && node.position.y === y)) {
                        return;
                    }

                    node.position = { x, y };
                    this.markDirty();
                },
                playNode: (id) => this.playNode(id),
                connectNodes: (source, target) => this.connectNodes(source, target),
                selectConnection: (id) => {
                    this.activeConnectionId = id;
                },
                deleteConnection: (id) => this.deleteConnection(id),
                zoomChanged: (zoom) => {
                    this.graphZoom = zoom;
                },
                chooseInputFile: (id) => this.chooseInputFile(id),
                clearInputFile: (id) => this.clearInputFile(id),
            }),
        );
        this.previewResizeObserver = new ResizeObserver(() => this.updatePreviewFitScale());
        document.addEventListener('pointerdown', this.closeDeviceMenu);
        document.addEventListener('pointerdown', this.closeNodeMenu);
        document.addEventListener('pointerdown', this.closeRecordingMenu);
        window.addEventListener('message', this.handleRuntimeMessage);
        window.addEventListener('resize', this.positionOpenFlyouts);
        this.renderGraph();
        this.observePreviewStage();
        this.startPreviewInitialization();
        void this.refreshBrowserTestbench();
    },
    beforeUnmount(): void {
        this.graph?.dispose();

        if (this.noticeTimer) {
            clearTimeout(this.noticeTimer);
        }

        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
        }

        this.previewResizeObserver?.disconnect();
        document.removeEventListener('pointerdown', this.closeDeviceMenu);
        document.removeEventListener('pointerdown', this.closeNodeMenu);
        document.removeEventListener('pointerdown', this.closeRecordingMenu);
        window.removeEventListener('message', this.handleRuntimeMessage);
        window.removeEventListener('resize', this.positionOpenFlyouts);
        this.stopResize();
    },
    methods: {
        ...workspaceEditingMethods,
        ...browserSessionMethods,
        ...workspaceLayoutMethods,
        ...workspaceExecutionMethods,
        ...projectMethods,
    },
});

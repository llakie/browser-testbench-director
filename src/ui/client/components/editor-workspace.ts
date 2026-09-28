import { defineComponent, markRaw, nextTick } from 'vue';

import {
    BrowserTestbenchPreview,
    type BrowserTestbenchTarget,
} from '../core/browser-testbench-preview.js';
import {
    ExecutionController,
    type ExecutionSnapshot,
    type NodeExecutionStatus,
} from '../core/execution-controller.js';
import { positionFlyout } from '../core/flyout-position.js';
import { JointLayerGraph } from '../core/joint-layer-graph.js';
import { PreviewDocument } from '../core/preview-document.js';
import { ProjectAssets } from '../core/project-assets.js';
import { ProjectFiles, type ProjectFileHandle } from '../core/project-files.js';
import { ProjectNodes } from '../core/project-nodes.js';
import { StagePanGesture, StageZoomGesture } from '../core/stage-zoom-gesture.js';
import { WorkflowPlanner, type PlaybackMode, type WorkflowPlan } from '../core/workflow-planner.js';
import { WorkflowConnectionError, WorkflowGraph } from '../core/workflow-graph.js';
import {
    ProjectFormat,
    type BrowserActionNode,
    type BrowserWaitNode,
    type CapabilityNode,
    type DirectorNode,
    type DirectorProject,
    type HorizontalAlignment,
    type InputNode,
    type JavaScriptNode,
    type LayerNode,
    type LayerSource,
    type ProjectFileInput,
    type VerticalAlignment,
    type WebsiteNode,
} from '../core/project-format.js';
import { Translator } from '../core/translator.js';

type SourceType = keyof LayerSource;
type Splitter = 'outer' | 'inner';
type WorkspacePanel = 'preview' | 'graph' | 'editor';
type BrowserTestbenchState = 'checking' | 'running' | 'stopped' | 'starting' | 'stopping';
type CreatableNodeType =
    'input' | 'camera-capability' | 'layer' | 'javascript' | 'browser-action' | 'browser-wait';

interface ViewportPreset {
    readonly id:
        'phone-portrait' | 'phone-landscape' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';
    readonly viewport: { readonly width: number; readonly height: number };
    readonly output: { readonly width: number; readonly height: number };
    readonly icon: string;
    readonly labelKey: string;
}

interface PreviewRuntime {
    readonly ready: Promise<void>;
    run(steps: readonly unknown[], executionId?: number | null): Promise<void>;
    cancel(): void;
}

interface RuntimeMessage {
    readonly type: 'director:execution';
    readonly executionId: number | null;
    readonly nodeId: string;
    readonly status: NodeExecutionStatus;
    readonly error?: string;
}

interface McpClientStatus {
    readonly id: string;
    readonly label: string;
    readonly installed: boolean;
    readonly registered: boolean;
    readonly command: string;
    readonly automatic: boolean;
}

const viewportPresets: readonly ViewportPreset[] = [
    {
        id: 'phone-portrait',
        viewport: { width: 360, height: 640 },
        output: { width: 1080, height: 1920 },
        icon: 'bi-phone',
        labelKey: 'preview.phonePortrait',
    },
    {
        id: 'phone-landscape',
        viewport: { width: 640, height: 360 },
        output: { width: 1920, height: 1080 },
        icon: 'bi-phone-landscape',
        labelKey: 'preview.phoneLandscape',
    },
    {
        id: 'tablet-portrait',
        viewport: { width: 768, height: 1024 },
        output: { width: 1536, height: 2048 },
        icon: 'bi-tablet',
        labelKey: 'preview.tabletPortrait',
    },
    {
        id: 'tablet-landscape',
        viewport: { width: 1024, height: 768 },
        output: { width: 2048, height: 1536 },
        icon: 'bi-tablet-landscape',
        labelKey: 'preview.tabletLandscape',
    },
    {
        id: 'desktop',
        viewport: { width: 1920, height: 1080 },
        output: { width: 1920, height: 1080 },
        icon: 'bi-display',
        labelKey: 'preview.desktop',
    },
];

const commonInputTypes = [
    'image/*',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/svg+xml',
    'video/*',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/*',
    'audio/mpeg',
    'audio/wav',
    'application/pdf',
    'application/json',
    'application/zip',
    'application/octet-stream',
    'text/plain',
    'text/csv',
    'font/ttf',
    'font/otf',
    'font/woff',
    'font/woff2',
] as const;

function cloneWorkflowPlan(plan: WorkflowPlan): WorkflowPlan {
    return JSON.parse(JSON.stringify(plan)) as WorkflowPlan;
}

const layoutStorageKey = 'browser-testbench-director.layout';

interface LayoutPreferences {
    portraitTools: number;
    landscapePreview: number;
    toolsSplit: number;
}

const defaultLayoutPreferences: LayoutPreferences = {
    portraitTools: 38,
    landscapePreview: 48,
    toolsSplit: 38,
};

class WorkspaceLayoutPreferences {
    static read(): LayoutPreferences {
        if (typeof localStorage === 'undefined') return { ...defaultLayoutPreferences };
        try {
            const stored = JSON.parse(
                localStorage.getItem(layoutStorageKey) ?? '{}',
            ) as Partial<LayoutPreferences>;
            return {
                portraitTools: WorkspaceLayoutPreferences.valid(
                    stored.portraitTools,
                    defaultLayoutPreferences.portraitTools,
                ),
                landscapePreview: WorkspaceLayoutPreferences.valid(
                    stored.landscapePreview,
                    defaultLayoutPreferences.landscapePreview,
                ),
                toolsSplit: WorkspaceLayoutPreferences.valid(
                    stored.toolsSplit,
                    defaultLayoutPreferences.toolsSplit,
                ),
            };
        } catch {
            return { ...defaultLayoutPreferences };
        }
    }

    static write(preferences: LayoutPreferences): void {
        try {
            localStorage.setItem(layoutStorageKey, JSON.stringify(preferences));
        } catch {
            // The editor remains usable when browser storage is unavailable.
        }
    }

    private static valid(value: unknown, fallback: number): number {
        return typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 80
            ? value
            : fallback;
    }
}

export const EditorWorkspace = defineComponent({
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
            previewDocument: '',
            previewRevision: 0,
            lastPreviewPlan: null as WorkflowPlan | null,
            lastPreviewInputs: {} as Record<string, string>,
            staleNodeIds: new Set<string>(),
            hasPlayed: false,
            preparedNodeId: null as string | null,
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
            selectedViewportPresetId: 'phone-portrait' as ViewportPreset['id'] | null,
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
            mcpClients: [] as McpClientStatus[],
            mcpLoading: false,
            mcpLoadError: '',
            executionController,
            executionState: executionController.snapshot() as ExecutionSnapshot,
        };
    },
    computed: {
        activeNode(): DirectorNode | null {
            if (!this.activeNodeId) return null;
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
            if (!this.activeNodeId) return '';
            return this.executionState.nodes[this.activeNodeId]?.error ?? '';
        },
        websiteNode(): WebsiteNode | null {
            return this.project.nodes.find((node) => node.type === 'website') ?? null;
        },
        sourceLineCount(): number {
            const source =
                this.activeLayer?.source[this.activeSource] ?? this.activeJavaScript?.source;
            return source?.split('\n').length ?? 0;
        },
        placementReferenceType(): 'viewport' | 'layer' | 'dom' {
            return this.activeLayer?.placement.reference.type ?? 'viewport';
        },
        availableParentLayers(): LayerNode[] {
            if (!this.activeLayer) return [];
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
            return this.project.viewport.height > this.project.viewport.width
                ? 'portrait'
                : 'landscape';
        },
        viewportLabel(): string {
            if (this.selectedBrowserTarget)
                return this.browserTargetLabel(this.selectedBrowserTarget);
            return `${this.project.viewport.width} × ${this.project.viewport.height} CSS`;
        },
        currentViewportPreset(): ViewportPreset | undefined {
            const selected = this.viewportPresets.find(
                (preset) => preset.id === this.selectedViewportPresetId,
            );
            if (
                selected?.viewport.width === this.project.viewport.width &&
                selected.viewport.height === this.project.viewport.height &&
                selected.output.width === this.project.output.width &&
                selected.output.height === this.project.output.height
            ) {
                return selected;
            }
            return [...this.viewportPresets]
                .reverse()
                .find(
                    (preset) =>
                        preset.viewport.width === this.project.viewport.width &&
                        preset.viewport.height === this.project.viewport.height &&
                        preset.output.width === this.project.output.width &&
                        preset.output.height === this.project.output.height,
                );
        },
        viewportPresetIcon(): string {
            if (this.selectedBrowserTarget) {
                return this.selectedBrowserTarget.kind === 'mobile' ? 'bi-phone' : 'bi-display';
            }
            return this.currentViewportPreset?.icon ?? 'bi-aspect-ratio';
        },
        viewportPresetLabel(): string {
            return this.currentViewportPreset
                ? this.t(this.currentViewportPreset.labelKey)
                : this.t('preview.customViewport');
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
                if (left.id === preferredId) return -1;
                if (right.id === preferredId) return 1;
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
            if (this.activeWebsite) return this.t('preview.reloadWebsite');
            return this.t(this.hasPlayed ? 'preview.playAgain' : 'preview.play');
        },
        editorPanelTitle(): string {
            if (this.activeWebsite) return this.t('website.title');
            if (this.activeInput) return this.t('input.title');
            if (this.activeCapability) return this.t('capability.title');
            if (this.activeJavaScript) return this.t('javascript.title');
            if (this.activeBrowserAction) return this.t('browserAction.title');
            if (this.activeBrowserWait) return this.t('browserWait.title');
            return this.t('editor.title');
        },
        previewScale(): number {
            return this.previewFitScale;
        },
        graphZoomPercent(): number {
            return Math.round(this.graphZoom * 100);
        },
        viewportStyle(): Record<string, string> {
            const width = this.project.viewport.width;
            const height = this.project.viewport.height;
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
        const graphElement = this.$refs['graph'];
        if (!(graphElement instanceof HTMLElement)) throw new Error('Graph canvas is missing.');
        this.graph = markRaw(
            new JointLayerGraph(graphElement, {
                selectNode: (id) => this.selectNode(id),
                positionNode: (id, x, y) => {
                    const node = this.project.nodes.find((candidate) => candidate.id === id);
                    if (!node || (node.position?.x === x && node.position.y === y)) return;
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
        void this.initializePreview();
        void this.refreshBrowserTestbench();
    },
    beforeUnmount(): void {
        this.graph?.dispose();
        if (this.noticeTimer) clearTimeout(this.noticeTimer);
        if (this.recordingTimer) clearInterval(this.recordingTimer);
        this.previewResizeObserver?.disconnect();
        document.removeEventListener('pointerdown', this.closeDeviceMenu);
        document.removeEventListener('pointerdown', this.closeNodeMenu);
        document.removeEventListener('pointerdown', this.closeRecordingMenu);
        window.removeEventListener('message', this.handleRuntimeMessage);
        window.removeEventListener('resize', this.positionOpenFlyouts);
        this.stopResize();
    },
    methods: {
        t(key: string, parameters: Record<string, string | number> = {}): string {
            return Translator.text(key, parameters);
        },
        renderGraph(): void {
            this.graph?.render(
                this.project.nodes,
                this.project.connections,
                this.activeNodeId,
                this.activeConnectionId,
                this.executionState.nodes,
                WorkflowGraph.connectedNodeIds(this.project),
                this.t('graph.disconnected'),
                this.preparedNodeId,
                this.t('graph.preparedState'),
                this.staleNodeIds,
                Object.fromEntries(
                    Object.entries(this.inputFiles).map(([id, file]) => [id, file.name]),
                ),
                this.t('input.chooseFile'),
            );
        },
        connectNodes(source: string, target: string): boolean {
            try {
                const connection = WorkflowGraph.createConnection(this.project, source, target);
                this.project.connections.push(connection);
                this.activeConnectionId = connection.id;
                this.markExecutionDirty();
                requestAnimationFrame(() => this.renderGraph());
                this.showNotice(this.t('graph.connectionCreated'));
                return true;
            } catch (error) {
                const key =
                    error instanceof WorkflowConnectionError
                        ? `graph.connectionError.${error.issue}`
                        : 'graph.connectionError.invalid';
                this.showNotice(this.t(key));
                return false;
            }
        },
        deleteConnection(id?: string): void {
            const connectionId = id ?? this.activeConnectionId;
            if (!connectionId || this.executionRunning) return;
            const index = this.project.connections.findIndex(
                (connection) => connection.id === connectionId,
            );
            if (index < 0) return;
            this.project.connections.splice(index, 1);
            this.activeConnectionId = null;
            this.markExecutionDirty();
            this.renderGraph();
            this.showNotice(this.t('graph.connectionDeleted'));
        },
        addNode(type: CreatableNodeType): void {
            if (this.executionRunning) return;
            this.nodeMenuOpen = false;
            const node = this.createNode(type);
            this.project.nodes.push(node);
            this.activeNodeId = node.id;
            this.activeConnectionId = null;
            this.activeSource = 'html';
            this.markExecutionDirty();
            this.renderGraph();
            this.showNotice(this.t('node.created', { name: node.name }));
        },
        createNode(type: CreatableNodeType): DirectorNode {
            if (type === 'input') {
                return ProjectNodes.createInput(this.project, this.t('node.defaultInputName'));
            }
            if (type === 'camera-capability') {
                return ProjectNodes.createCameraCapability(
                    this.project,
                    this.t('node.defaultCameraCapabilityName'),
                );
            }
            if (type === 'layer') {
                return ProjectNodes.createLayer(this.project, this.t('node.defaultLayerName'));
            }
            if (type === 'javascript') {
                return ProjectNodes.createJavaScript(
                    this.project,
                    this.t('node.defaultJavaScriptName'),
                );
            }
            if (type === 'browser-action') {
                return ProjectNodes.createBrowserAction(
                    this.project,
                    this.t('node.defaultBrowserActionName'),
                );
            }
            return ProjectNodes.createBrowserWait(
                this.project,
                this.t('node.defaultBrowserWaitName'),
            );
        },
        duplicateActiveNode(): void {
            if (!this.activeNode || this.executionRunning) return;
            this.nodeMenuOpen = false;
            const duplicate = ProjectNodes.duplicate(
                this.project,
                this.activeNode,
                this.t('node.copyName', { name: this.activeNode.name }),
            );
            if (!duplicate) return;
            this.project.nodes.push(duplicate);
            this.activeNodeId = duplicate.id;
            this.activeConnectionId = null;
            this.markExecutionDirty();
            this.renderGraph();
            this.showNotice(this.t('node.duplicated', { name: duplicate.name }));
        },
        deleteActiveNode(): void {
            if (!this.activeNodeId || this.executionRunning) return;
            this.nodeMenuOpen = false;
            const deleted = this.activeNode;
            if (!deleted || !ProjectNodes.remove(this.project, deleted.id)) return;
            if (deleted.type === 'input') {
                delete this.inputFiles[deleted.id];
                delete this.inputData[deleted.id];
                delete this.inputAcceptQueries[deleted.id];
            }
            this.activeNodeId = null;
            this.activeConnectionId = null;
            if (this.preparedNodeId === deleted.id) this.preparedNodeId = null;
            this.staleNodeIds.delete(deleted.id);
            this.markExecutionDirty();
            this.renderGraph();
            this.showNotice(this.t('node.deleted', { name: deleted.name }));
        },
        markDirty(): void {
            this.dirty = true;
        },
        markExecutionDirty(): void {
            this.markDirty();
            if (this.preparedNodeId === null) return;
            this.preparedNodeId = null;
            this.renderGraph();
        },
        markActiveNodeStale(): void {
            this.markDirty();
            const node = this.activeNode;
            const becameStale = Boolean(
                node &&
                !['website', 'input'].includes(node.type) &&
                !this.staleNodeIds.has(node.id),
            );
            if (node && !['website', 'input'].includes(node.type)) {
                this.staleNodeIds.add(node.id);
            }
            if (!becameStale && this.preparedNodeId === null) return;
            this.preparedNodeId = null;
            this.renderGraph();
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
                if (!Array.isArray(clients)) throw new Error('Invalid server response.');
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
            if (!client.automatic || !client.installed || this.mcpLoading) return;
            this.mcpLoading = true;
            try {
                const response = await fetch('/director-api/mcp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ client: client.id }),
                });
                const updated = (await this.readDirectorJson(response)) as McpClientStatus;
                this.mcpClients = this.mcpClients.map((candidate) =>
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
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            if (!response.headers.get('content-type')?.includes('application/json')) {
                throw new Error(this.t('mcp.backendUnavailable'));
            }
            return response.json();
        },
        async copyMcpConfiguration(client: McpClientStatus): Promise<void> {
            await navigator.clipboard.writeText(client.command);
            this.showNotice(this.t('mcp.copied', { client: client.label }));
        },
        updateSource(event: Event): void {
            const input = event.target;
            if (!(input instanceof HTMLTextAreaElement) || !this.activeLayer) return;
            this.activeLayer.source[this.activeSource] = input.value;
            this.markActiveNodeStale();
        },
        syncSourceGutter(event: Event): void {
            const input = event.currentTarget;
            const gutter = this.$refs['sourceGutter'];
            if (!(input instanceof HTMLTextAreaElement) || !(gutter instanceof HTMLElement)) return;
            gutter.scrollTop = input.scrollTop;
        },
        updateWebsiteUrl(event: Event): void {
            const input = event.target;
            if (!(input instanceof HTMLInputElement) || !this.activeWebsite) return;
            this.activeWebsite.url = input.value;
            this.markExecutionDirty();
            this.renderGraph();
        },
        inputAcceptValues(input: ProjectFileInput): string[] {
            return input.accept
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean);
        },
        inputAcceptSuggestions(input: ProjectFileInput): string[] {
            const selected = new Set(this.inputAcceptValues(input));
            const query = (this.inputAcceptQueries[input.id] ?? '').trim().toLowerCase();
            return commonInputTypes
                .filter((value) => !selected.has(value) && (!query || value.includes(query)))
                .slice(0, 8);
        },
        focusInputAccept(inputId: string): void {
            this.activeInputAcceptId = inputId;
        },
        blurInputAccept(inputId: string): void {
            window.setTimeout(() => {
                if (this.activeInputAcceptId === inputId) this.activeInputAcceptId = null;
            }, 120);
        },
        handleInputAcceptKeydown(input: ProjectFileInput, event: KeyboardEvent): void {
            const query = this.inputAcceptQueries[input.id] ?? '';
            if (event.key === 'Escape') {
                this.activeInputAcceptId = null;
                return;
            }
            if (event.key === 'Backspace' && !query) {
                const values = this.inputAcceptValues(input);
                if (values.length) this.removeInputAccept(input, values.at(-1)!);
                return;
            }
            if (!['Enter', ',', 'Tab'].includes(event.key) || !query.trim()) return;
            if (event.key !== 'Tab') event.preventDefault();
            this.addInputAccept(input, query);
        },
        addInputAccept(input: ProjectFileInput, value: string): void {
            const values = this.inputAcceptValues(input);
            for (const candidate of value.split(',')) {
                const normalized = candidate.trim().toLowerCase();
                if (normalized && !values.includes(normalized)) values.push(normalized);
            }
            input.accept = values.join(',');
            this.inputAcceptQueries[input.id] = '';
            this.activeInputAcceptId = input.id;
            this.markExecutionDirty();
        },
        removeInputAccept(input: ProjectFileInput, value: string): void {
            input.accept = this.inputAcceptValues(input)
                .filter((candidate) => candidate !== value)
                .join(',');
            this.markExecutionDirty();
        },
        addInputPreparation(inputId: string): void {
            const input = this.inputNodes.find((candidate) => candidate.id === inputId);
            if (!input) return;
            input.prepare ??= { modules: [] };
            input.prepare.modules.push('');
            this.markExecutionDirty();
        },
        removeInputPreparation(inputId: string, index: number): void {
            const input = this.inputNodes.find((candidate) => candidate.id === inputId);
            if (!input?.prepare) return;
            input.prepare.modules.splice(index, 1);
            if (input.prepare.modules.length === 0) delete input.prepare;
            this.markExecutionDirty();
        },
        updateInputPreparation(inputId: string, index: number, event: Event): void {
            const field = event.target;
            if (!(field instanceof HTMLInputElement)) return;
            const input = this.inputNodes.find((candidate) => candidate.id === inputId);
            if (!input?.prepare || index < 0 || index >= input.prepare.modules.length) return;
            input.prepare.modules[index] = field.value;
            this.markExecutionDirty();
        },
        async updateInputFile(inputId: string, event: Event): Promise<void> {
            const input = event.target;
            if (!(input instanceof HTMLInputElement)) return;
            const file = input.files?.[0];
            if (!file) {
                this.clearInputFile(inputId);
                return;
            }
            this.inputFiles[inputId] = markRaw(file);
            const selectionRevision = (this.inputFileSelectionRevisions[inputId] ?? 0) + 1;
            this.inputFileSelectionRevisions[inputId] = selectionRevision;
            this.preparedNodeId = null;
            this.renderGraph();
            const store = (async (): Promise<void> => {
                const [reference, data] = await Promise.all([
                    ProjectAssets.store(file),
                    BrowserTestbenchPreview.runtimeInputs({ [inputId]: file }),
                ]);
                if (this.inputFileSelectionRevisions[inputId] !== selectionRevision) return;
                const node = this.inputNodes.find((candidate) => candidate.id === inputId);
                if (!node) return;
                node.file = reference;
                this.inputData[inputId] = data[inputId]!;
                this.dirty = true;
                if (this.executionController.clear(inputId)) {
                    this.executionState = this.executionController.snapshot();
                }
                this.preparedNodeId = null;
                this.renderGraph();
            })();
            this.inputFileStores[inputId] = store;
            try {
                await store;
            } catch (error) {
                if (this.inputFileSelectionRevisions[inputId] === selectionRevision) {
                    delete this.inputFiles[inputId];
                    delete this.inputData[inputId];
                    this.renderGraph();
                }
                input.value = '';
                this.showNotice(`${this.t('project.saveError')} ${this.errorMessage(error)}`);
            } finally {
                if (this.inputFileStores[inputId] === store) {
                    delete this.inputFileStores[inputId];
                }
            }
        },
        chooseInputFile(inputId: string): void {
            this.selectNode(inputId);
            void nextTick(() => {
                const field = document.querySelector<HTMLInputElement>(
                    `[data-testid="project-input-${CSS.escape(inputId)}"]`,
                );
                field?.click();
            });
        },
        clearInputFile(inputId: string): void {
            const inputNode = this.inputNodes.find((candidate) => candidate.id === inputId);
            if (inputNode) delete inputNode.file;
            this.inputFileSelectionRevisions[inputId] =
                (this.inputFileSelectionRevisions[inputId] ?? 0) + 1;
            delete this.inputFiles[inputId];
            delete this.inputData[inputId];
            this.dirty = true;
            this.preparedNodeId = null;
            const field = document.querySelector<HTMLInputElement>(
                `[data-testid="project-input-${CSS.escape(inputId)}"]`,
            );
            if (field) field.value = '';
            this.renderGraph();
        },
        updateJavaScriptSource(event: Event): void {
            const input = event.target;
            if (!(input instanceof HTMLTextAreaElement) || !this.activeJavaScript) return;
            this.activeJavaScript.source = input.value;
            this.markActiveNodeStale();
        },
        setPlacementReference(event: Event): void {
            const input = event.target;
            if (!(input instanceof HTMLSelectElement) || !this.activeLayer) return;
            const type = input.value as 'viewport' | 'layer' | 'dom';
            if (type === 'layer') {
                const parent = this.availableParentLayers.at(-1);
                if (!parent) return;
                this.activeLayer.placement.reference = { type, nodeId: parent.id };
            } else if (type === 'dom') {
                const selector =
                    this.activeLayer.placement.reference.type === 'dom'
                        ? this.activeLayer.placement.reference.selector
                        : 'body';
                this.activeLayer.placement.reference = { type, selector };
            } else {
                this.activeLayer.placement.reference = { type: 'viewport' };
            }
            this.markActiveNodeStale();
        },
        setParentLayer(event: Event): void {
            const input = event.target;
            if (!(input instanceof HTMLSelectElement) || !this.activeLayer) return;
            this.activeLayer.placement.reference = { type: 'layer', nodeId: input.value };
            this.markActiveNodeStale();
        },
        setHorizontalAlignment(horizontal: HorizontalAlignment): void {
            if (!this.activeLayer) return;
            this.activeLayer.placement = {
                reference: this.activeLayer.placement.reference,
                horizontal,
                vertical: this.verticalAlignment,
            };
            this.markActiveNodeStale();
        },
        setVerticalAlignment(vertical: VerticalAlignment): void {
            if (!this.activeLayer) return;
            this.activeLayer.placement = {
                reference: this.activeLayer.placement.reference,
                horizontal: this.horizontalAlignment,
                vertical,
            };
            this.markActiveNodeStale();
        },
        toggleDeviceMenu(): void {
            this.deviceMenuOpen = !this.deviceMenuOpen;
            if (this.deviceMenuOpen) this.positionFlyout('deviceFlyout');
        },
        closeDeviceMenu(event: PointerEvent): void {
            const flyout = this.$refs['deviceFlyout'];
            if (flyout instanceof HTMLElement && flyout.contains(event.target as Node)) return;
            this.deviceMenuOpen = false;
        },
        toggleNodeMenu(): void {
            this.nodeMenuOpen = !this.nodeMenuOpen;
            if (this.nodeMenuOpen) this.positionFlyout('nodeFlyout');
        },
        positionFlyout(refName: string): void {
            void nextTick(() => {
                const flyout = this.$refs[refName];
                if (!(flyout instanceof HTMLElement)) return;
                const menu = flyout.querySelector<HTMLElement>('.flyout-menu');
                if (menu) positionFlyout(menu);
            });
        },
        positionOpenFlyouts(): void {
            document.querySelectorAll<HTMLElement>('.flyout-menu').forEach(positionFlyout);
        },
        closeNodeMenu(event: PointerEvent): void {
            const flyout = this.$refs['nodeFlyout'];
            if (flyout instanceof HTMLElement && flyout.contains(event.target as Node)) return;
            this.nodeMenuOpen = false;
        },
        toggleRecordingMenu(): void {
            this.recordingMenuOpen = !this.recordingMenuOpen;
            if (this.recordingMenuOpen) this.positionFlyout('recordingFlyout');
        },
        closeRecordingMenu(event: PointerEvent): void {
            const flyout = this.$refs['recordingFlyout'];
            if (flyout instanceof HTMLElement && flyout.contains(event.target as Node)) return;
            this.recordingMenuOpen = false;
        },
        startRecordingOnTarget(target: BrowserTestbenchTarget): void {
            if (
                !this.isCompatibleRecordingTarget(target) ||
                !target.ready ||
                (target.busy && target.id !== this.selectedBrowserTargetId) ||
                this.recordingWorkflow
            )
                return;
            this.selectedRecordingTargetId = target.id;
            this.recordingMenuOpen = false;
            void this.recordWorkflow();
        },
        selectViewportPreset(preset: ViewportPreset): void {
            const sizeChanged =
                preset.viewport.width !== this.project.viewport.width ||
                preset.viewport.height !== this.project.viewport.height ||
                preset.output.width !== this.project.output.width ||
                preset.output.height !== this.project.output.height;
            this.selectedViewportPresetId = preset.id;
            this.deviceMenuOpen = false;
            if (this.remotePreviewSessionId || this.selectedBrowserTargetId) {
                void this.switchToLocalPreview();
            }
            if (!sizeChanged) return;
            this.project.viewport = { ...preset.viewport };
            this.project.output = { ...preset.output };
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
            if (!target.ready) return this.t('recording.targetUnavailable');
            if (target.busy) return this.t('recording.targetBusy');
            return this.t('recording.targetReady');
        },
        previewTargetStatus(target: BrowserTestbenchTarget): string {
            if (!this.isCompatiblePreviewTarget(target)) {
                return this.t('preview.targetIncompatible');
            }
            if (!target.ready) return this.t('preview.targetUnavailable');
            if (target.busy) return this.t('preview.targetBusy');
            return this.t('preview.targetReady');
        },
        matchesConfiguredTarget(target: BrowserTestbenchTarget): boolean {
            const requirement = this.project.browserSession.target;
            return (
                (!requirement.browser || target.browser === requirement.browser) &&
                (!requirement.deviceKind || target.deviceKind === requirement.deviceKind)
            );
        },
        isCompatiblePreviewTarget(target: BrowserTestbenchTarget): boolean {
            if (!this.matchesConfiguredTarget(target)) return false;
            const configuration = this.project.browserSession;
            if (!this.cameraInputId) return true;
            return (
                target.capabilities.mediaInjection.cameraImage ||
                (target.kind === 'desktop' &&
                    ['chrome', 'edge', 'firefox'].includes(target.browser ?? ''))
            );
        },
        isCompatibleRecordingTarget(target: BrowserTestbenchTarget): boolean {
            return target.capabilities.recording.viewport && this.isCompatiblePreviewTarget(target);
        },
        async loadBrowserTargets(): Promise<void> {
            if (this.browserTargetsLoading) return;
            this.browserTargetsLoading = true;
            try {
                this.browserTargets = await BrowserTestbenchPreview.targets();
                this.browserTestbenchState = 'running';
                const selectedTarget = this.compatiblePreviewTargets.find(
                    (target) =>
                        target.id === this.selectedBrowserTargetId &&
                        (Boolean(this.remotePreviewSessionId) || (target.ready && !target.busy)),
                );
                this.selectedBrowserTargetId = selectedTarget?.id ?? '';
                const selectedRecordingTarget = this.compatibleRecordingTargets.find(
                    (target) =>
                        target.id === this.selectedRecordingTargetId &&
                        target.ready &&
                        !target.busy,
                );
                this.selectedRecordingTargetId =
                    selectedRecordingTarget?.id ??
                    this.compatibleRecordingTargets.find((target) => target.ready && !target.busy)
                        ?.id ??
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
                if (status.running) await this.loadBrowserTargets();
                else {
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
            if (this.browserTestbenchTransitioning || this.executionRunning) return;
            const shouldStop = this.browserTestbenchRunning;
            this.browserTestbenchState = shouldStop ? 'stopping' : 'starting';
            try {
                const status = shouldStop
                    ? await BrowserTestbenchPreview.stop()
                    : await BrowserTestbenchPreview.start();
                this.browserTestbenchManaged = status.managed;
                this.browserTestbenchState = status.running ? 'running' : 'stopped';
                if (status.running) await this.loadBrowserTargets();
                else {
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
            )
                return;
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
                this.remotePreviewSessionId = await this.openRemotePlan(
                    target,
                    'preview-state',
                    plan,
                );
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
                this.showNotice(
                    `${this.t('preview.openOnDeviceError')} ${this.errorMessage(error)}`,
                );
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
            if (sessionId) await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
            await this.restoreLocalPreview();
            if (this.browserTestbenchRunning) void this.loadBrowserTargets();
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
            )
                return;

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
                this.remotePreviewSessionId = await this.openRemotePlan(
                    target,
                    selectedNodeId,
                    plan,
                );
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
                    await BrowserTestbenchPreview.execute(
                        this.remotePreviewSessionId,
                        precedingSteps,
                    );
                }
                await BrowserTestbenchPreview.startSelectorPicker(this.remotePreviewSessionId);
                this.showNotice(this.t('browser.selectorPickerHint'));
                while (this.selectorPicking && this.remotePreviewSessionId) {
                    await new Promise((resolveWait) => window.setTimeout(resolveWait, 250));
                    const result = await BrowserTestbenchPreview.selectorPickerResult(
                        this.remotePreviewSessionId,
                    );
                    if (result.status === 'picking') continue;
                    if (result.status === 'selected' && result.selector) {
                        const selected = this.project.nodes.find(
                            (candidate) => candidate.id === selectedNodeId,
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
                            (selected?.type === 'browser-wait' &&
                                selected.condition === 'element') ||
                            (selected?.type === 'layer' &&
                                selected.placement.reference.type === 'dom')
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
            )
                return;
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
                const plan = WorkflowPlanner.plan(this.project, 'workflow');
                this.assertPlanInputs(plan);
                if (recordingOnPreviewTarget && previewSessionId) {
                    await BrowserTestbenchPreview.close(previewSessionId).catch(() => undefined);
                }
                sessionId = await this.openRemotePlan(target, 'workflow', plan);
                this.remotePreviewSessionId = sessionId;
                await BrowserTestbenchPreview.startRecording(sessionId, filename);
                recordingStarted = true;
                this.startRecordingIndicator();
                this.browserTargetOpening = false;
                const completed = await this.runPlayback('workflow', undefined, true);
                if (!completed) {
                    if (this.recordingStopRequested) throw new Error(this.t('recording.cancelled'));
                    const failure = Object.values(this.executionController.snapshot().nodes).find(
                        (node) => node.status === 'error',
                    );
                    throw new Error(failure?.error ?? this.t('recording.workflowFailed'));
                }
                this.stopRecordingIndicator();
                const recording = await BrowserTestbenchPreview.stopRecording(
                    sessionId,
                    filename,
                    this.project.output,
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
                if (sessionId && !keepAsRemotePreview)
                    await BrowserTestbenchPreview.close(sessionId).catch(() => undefined);
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
            if (this.recordingTimer) clearInterval(this.recordingTimer);
            this.recordingStartedAt = Date.now();
            this.recordingElapsedMs = 0;
            this.recordingActive = true;
            this.recordingTimer = setInterval(() => {
                this.recordingElapsedMs = Date.now() - this.recordingStartedAt;
            }, 250);
        },
        stopRecordingIndicator(): void {
            if (this.recordingTimer) clearInterval(this.recordingTimer);
            this.recordingTimer = undefined;
            this.recordingActive = false;
        },
        stopRecordingWorkflow(): void {
            if (!this.recordingActive) return;
            this.recordingStopRequested = true;
            this.stopPlayback();
        },
        togglePanelMaximized(panel: WorkspacePanel | null): void {
            this.maximizedPanel = this.maximizedPanel === panel ? null : panel;
            requestAnimationFrame(() => {
                this.renderGraph();
                this.updatePreviewFitScale();
            });
        },
        setMobilePanel(panel: WorkspacePanel): void {
            this.mobileActivePanel = panel;
            void nextTick(() => {
                if (panel === 'graph') this.renderGraph();
                if (panel === 'preview') this.updatePreviewFitScale();
            });
        },
        selectNode(id: string | null): void {
            this.activeConnectionId = null;
            this.activeNodeId = id;
            if (!id) this.mobileActivePanel = 'graph';
            this.observePreviewStage();
        },
        observePreviewStage(): void {
            void nextTick(() => {
                this.previewResizeObserver?.disconnect();
                const stage = this.$refs['previewStage'];
                if (stage instanceof HTMLElement) {
                    this.previewResizeObserver?.observe(stage);
                    this.updatePreviewFitScale();
                }
            });
        },
        updatePreviewFitScale(): void {
            const stage = this.$refs['previewStage'];
            if (!(stage instanceof HTMLElement)) return;
            const style = getComputedStyle(stage);
            const availableWidth =
                stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const availableHeight =
                stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
            if (availableWidth <= 0 || availableHeight <= 0) return;
            this.previewFitScale = Math.min(
                availableWidth / this.project.viewport.width,
                availableHeight / this.project.viewport.height,
            );
        },
        changeGraphZoom(delta: number): void {
            this.setGraphZoom(this.graphZoom + delta);
        },
        setGraphZoom(zoom: number): void {
            this.graphZoom = Math.min(2, Math.max(0.25, zoom));
            this.graph?.setZoom(this.graphZoom);
        },
        setGraphZoomAt(
            zoom: number,
            from: { x: number; y: number },
            to: { x: number; y: number } = from,
        ): void {
            const stage = this.$refs['graph'];
            if (!(stage instanceof HTMLElement)) return;
            const bounds = stage.getBoundingClientRect();
            this.graphZoom = Math.min(2, Math.max(0.25, zoom));
            this.graph?.setZoomAt(
                this.graphZoom,
                from.x - bounds.left,
                from.y - bounds.top,
                to.x - bounds.left,
                to.y - bounds.top,
            );
        },
        resetGraphZoom(): void {
            this.graphZoom = 1;
            this.graph?.setZoom(this.graphZoom);
        },
        async autoLayoutGraph(): Promise<void> {
            if (this.executionRunning || this.graphLayoutRunning) return;
            this.graphLayoutRunning = true;
            try {
                for (const node of this.project.nodes) node.position = null;
                this.markDirty();
                this.renderGraph();
                this.graphZoom =
                    (await this.graph?.arrangeAutomatically(
                        this.project.nodes,
                        this.project.connections,
                        true,
                    )) ?? this.graphZoom;
                this.showNotice(this.t('graph.autoLayoutCompleted'));
            } catch (error) {
                this.showNotice(`${this.t('graph.autoLayoutFailed')} ${this.errorMessage(error)}`);
            } finally {
                this.graphLayoutRunning = false;
            }
        },
        startStageGesture(stage: 'graph', event: PointerEvent): void {
            const isTouch = event.pointerType === 'touch';
            const isRightMouseButton = event.pointerType === 'mouse' && event.button === 2;
            if (!isTouch && !isRightMouseButton) return;
            const element = event.currentTarget;
            if (element instanceof HTMLElement) {
                try {
                    element.setPointerCapture(event.pointerId);
                } catch {
                    // Synthetic browser checks cannot establish native pointer capture.
                }
            }
            if (isTouch) {
                this.graphZoomGesture.begin(
                    event.pointerId,
                    event.clientX,
                    event.clientY,
                    this.graphZoom,
                );
            }
            this.graphPanGesture.begin(event.pointerId, event.clientX, event.clientY);
            if (isRightMouseButton) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        moveStageGesture(stage: 'graph', event: PointerEvent): void {
            const zoomUpdate = this.graphZoomGesture.move(
                event.pointerId,
                event.clientX,
                event.clientY,
            );
            const pan = this.graphPanGesture.move(
                event.pointerId,
                event.clientX,
                event.clientY,
                zoomUpdate === null,
            );
            if (zoomUpdate === null && pan === null) return;
            event.preventDefault();
            event.stopPropagation();
            if (zoomUpdate !== null) {
                this.setGraphZoomAt(zoomUpdate.zoom, zoomUpdate.previousCenter, zoomUpdate.center);
            } else if (pan) {
                this.panStage(stage, pan.x, pan.y);
            }
        },
        endStageGesture(stage: 'graph', event: PointerEvent): void {
            this.graphZoomGesture.end(event.pointerId);
            this.graphPanGesture.end(event.pointerId);
            if (event.pointerType === 'mouse' && event.button === 2) event.stopPropagation();
        },
        panStage(stage: 'graph', x: number, y: number): void {
            this.graph?.panBy(x, y);
        },
        zoomFromWheel(stage: 'graph', event: WheelEvent): void {
            event.preventDefault();
            if (!event.ctrlKey && !event.metaKey) {
                this.panStage(stage, -event.deltaX, -event.deltaY);
                return;
            }
            const zoom = this.graphZoom * Math.exp(-event.deltaY * 0.003);
            const center = { x: event.clientX, y: event.clientY };
            this.setGraphZoomAt(zoom, center);
        },
        startResize(splitter: Splitter, event: PointerEvent): void {
            if (window.matchMedia('(max-width: 760px)').matches) return;
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) {
                event.currentTarget.setPointerCapture(event.pointerId);
            }
            this.activeSplitter = splitter;
            document.body.classList.add('is-resizing-workspace');
            window.addEventListener('pointermove', this.resizeFromPointer);
            window.addEventListener('pointerup', this.stopResize);
            window.addEventListener('pointercancel', this.stopResize);
        },
        resizeFromPointer(event: PointerEvent): void {
            if (!this.activeSplitter) return;
            const workspace = this.$refs['workspace'];
            if (!(workspace instanceof HTMLElement)) return;
            const bounds = workspace.getBoundingClientRect();
            const portrait = this.previewOrientation === 'portrait';
            const coordinate =
                this.activeSplitter === 'outer'
                    ? portrait
                        ? event.clientX - bounds.left
                        : event.clientY - bounds.top
                    : portrait
                      ? event.clientY - bounds.top
                      : event.clientX - bounds.left;
            const extent =
                this.activeSplitter === 'outer'
                    ? portrait
                        ? bounds.width
                        : bounds.height
                    : portrait
                      ? bounds.height
                      : bounds.width;
            this.setSplitterPosition(this.activeSplitter, (coordinate / extent) * 100);
        },
        stopResize(): void {
            if (!this.activeSplitter) return;
            this.activeSplitter = null;
            document.body.classList.remove('is-resizing-workspace');
            window.removeEventListener('pointermove', this.resizeFromPointer);
            window.removeEventListener('pointerup', this.stopResize);
            window.removeEventListener('pointercancel', this.stopResize);
            WorkspaceLayoutPreferences.write(this.layout);
            requestAnimationFrame(() => this.renderGraph());
        },
        resizeFromKeyboard(splitter: Splitter, event: KeyboardEvent): void {
            const portrait = this.previewOrientation === 'portrait';
            const relevantKeys =
                (splitter === 'outer' && portrait) || (splitter === 'inner' && !portrait)
                    ? ['ArrowLeft', 'ArrowRight']
                    : ['ArrowUp', 'ArrowDown'];
            if (!relevantKeys.includes(event.key)) return;
            event.preventDefault();
            const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
            const current =
                splitter === 'inner'
                    ? this.layout.toolsSplit
                    : portrait
                      ? this.layout.portraitTools
                      : this.layout.landscapePreview;
            this.setSplitterPosition(splitter, current + direction * 2);
            WorkspaceLayoutPreferences.write(this.layout);
            requestAnimationFrame(() => this.renderGraph());
        },
        setSplitterPosition(splitter: Splitter, percentage: number): void {
            const minimum = splitter === 'outer' ? 24 : 22;
            const maximum = splitter === 'outer' ? 72 : 78;
            const value = Math.min(maximum, Math.max(minimum, percentage));
            if (splitter === 'inner') this.layout.toolsSplit = value;
            else if (this.previewOrientation === 'portrait') this.layout.portraitTools = value;
            else this.layout.landscapePreview = value;
        },
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
            if (this.activeNode.type === 'website') void this.runPlayback('root');
            else this.playNode(this.activeNode.id);
        },
        playNode(id: string): void {
            if (this.executionRunning || this.browserTargetOpening) return;
            if (
                ['input', 'capability'].includes(
                    this.project.nodes.find((node) => node.id === id)?.type ?? '',
                )
            )
                return;
            this.activeNodeId = id;
            void this.runPlayback('node', id);
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
        async runPlayback(
            mode: PlaybackMode,
            nodeId?: string,
            recording = false,
        ): Promise<boolean> {
            const plan = WorkflowPlanner.plan(this.project, mode, nodeId);
            const nodeIds = [
                ...plan.inputs.map((input) => input.id),
                ...(plan.resetWebsite && plan.website ? [plan.website.id] : []),
                ...plan.steps.map((step) => step.node.id),
            ];
            const runId = this.executionController.begin(nodeIds);
            if (runId === null) return false;
            if (this.remotePreviewSessionId) this.remotePreviewError = '';
            this.preparedNodeId = null;
            this.publishExecutionState();
            const remoteIsAuthoritative = Boolean(this.remotePreviewSessionId);
            try {
                await this.preparePlanInputs(plan, runId);
                await Promise.all([
                    remoteIsAuthoritative ? Promise.resolve() : this.executeLocalPlan(plan, runId),
                    this.syncRemotePreview(nodeId, plan, runId, recording),
                ]);
                this.preparedNodeId =
                    mode === 'current'
                        ? null
                        : (plan.steps.at(-1)?.node.id ?? plan.website?.id ?? null);
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
                this.preparedNodeId = null;
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
            return accepted.some((value) => {
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
                if (plan.website) this.updateExecution(runId, plan.website.id, 'running');
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
                steps: cloned.steps.map((step) => ({ ...step, speed: 'catchup' })),
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
                    PreviewDocument.buildPlan(
                        { ...plan, website: null },
                        null,
                        this.lastPreviewInputs,
                    ),
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
            const frame = this.$refs['previewFrame'];
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
            const frame = this.$refs['previewFrame'];
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
                    await BrowserTestbenchPreview.execute(sessionId, [step]);
                }
                this.updateExecution(runId, step.id, 'success');
            }
        },
        async stopPlayback(): Promise<void> {
            if (!this.executionController.stop()) return;
            this.preparedNodeId = null;
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
            const frame = this.$refs['previewFrame'];
            if (!(frame instanceof HTMLIFrameElement) || event.source !== frame.contentWindow)
                return;
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
        ): Promise<string> {
            this.remotePreviewDirect = this.usesDirectRemoteWebsite(plan, target);
            if (this.remotePreviewDirect) {
                return BrowserTestbenchPreview.openWebsite(
                    target,
                    plan.website!.url.trim(),
                    this.project.browserSession,
                    this.inputFiles,
                    plan.inputs,
                    plan.cameraInputId,
                );
            }
            const inputs = await BrowserTestbenchPreview.prepareRuntimeInputs(
                this.inputFiles,
                plan.inputs,
            );
            return BrowserTestbenchPreview.open(
                target.id,
                nodeId,
                await this.remoteShellDocument(plan, inputs),
            );
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
                    const input = this.$refs['projectFileInput'];
                    if (input instanceof HTMLInputElement) input.click();
                    return;
                }
                this.setProject(await ProjectFiles.read(selected.file), selected.file.name, false);
                this.projectFileHandle = markRaw(selected.handle);
                await this.restoreProjectInputs();
                this.showNotice(this.t('project.loaded', { name: selected.file.name }));
            } catch (error) {
                if (error instanceof DOMException && error.name === 'AbortError') return;
                this.showNotice(`${this.t('project.loadError')} ${this.errorMessage(error)}`);
            }
        },
        async loadProject(event: Event): Promise<void> {
            const input = event.target;
            if (!(input instanceof HTMLInputElement) || !input.files?.[0]) return;
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
            if (this.savingProject) return;
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
                if (error instanceof DOMException && error.name === 'AbortError') return;
                this.showNotice(`${this.t('project.saveError')} ${this.errorMessage(error)}`);
            } finally {
                this.savingProject = false;
            }
        },
        async restoreProjectInputs(): Promise<void> {
            for (const input of this.inputNodes) {
                if (!input.file) continue;
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
            this.remotePreviewDirect = false;
            this.selectedBrowserTargetId = '';
            this.remotePreviewError = '';
            if (previousRemoteSessionId) {
                void BrowserTestbenchPreview.close(previousRemoteSessionId).catch(() => undefined);
            }
            this.project = ProjectFormat.clone(project);
            this.activeConnectionId = null;
            this.selectedViewportPresetId =
                [...this.viewportPresets]
                    .reverse()
                    .find(
                        (preset) =>
                            preset.viewport.width === this.project.viewport.width &&
                            preset.viewport.height === this.project.viewport.height &&
                            preset.output.width === this.project.output.width &&
                            preset.output.height === this.project.output.height,
                    )?.id ?? null;
            this.filename = filename;
            this.inputFiles = {};
            this.inputData = {};
            this.inputFileStores = {};
            this.inputFileSelectionRevisions = {};
            this.inputAcceptQueries = {};
            this.activeInputAcceptId = null;
            const selectedRecordingTarget = this.compatibleRecordingTargets.find(
                (target) =>
                    target.id === this.selectedRecordingTargetId && target.ready && !target.busy,
            );
            this.selectedRecordingTargetId =
                selectedRecordingTarget?.id ??
                this.compatibleRecordingTargets.find((target) => target.ready && !target.busy)
                    ?.id ??
                '';
            this.activeNodeId = (this.project.nodes.find((node) => node.type === 'layer') ??
                this.project.nodes[0])!.id;
            this.activeSource = 'html';
            this.deviceMenuOpen = false;
            this.mobileActivePanel = 'graph';
            this.dirty = dirty;
            this.hasPlayed = false;
            this.preparedNodeId = null;
            this.staleNodeIds.clear();
            this.lastPreviewPlan = null;
            this.lastPreviewInputs = {};
            this.renderGraph();
            this.observePreviewStage();
            void this.initializePreview();
        },
        showNotice(message: string): void {
            this.notice = message;
            if (this.noticeTimer) clearTimeout(this.noticeTimer);
            this.noticeTimer = setTimeout(() => {
                this.notice = '';
            }, 3200);
        },
        errorMessage(error: unknown): string {
            return error instanceof Error ? error.message : String(error);
        },
    },
});

import { markRaw, nextTick } from 'vue';

import { BrowserTestbenchPreview } from '../core/browser-testbench-preview.js';
import { DelayNodeSource } from '../core/delay-node-source.js';
import { positionFlyout } from '../core/flyout-position.js';
import { ProjectAssets } from '../core/project-assets.js';
import { ProjectNodes } from '../core/project-nodes.js';
import { SourceFormatter } from '../core/source-formatter.js';
import { TextLayerSource } from '../core/text-layer-source.js';
import type {
    DirectorNode,
    BrowserPermission,
    HorizontalAlignment,
    InputNode,
    ProjectFileInput,
    VerticalAlignment,
    WorkflowConnection,
} from '../core/project-format.js';
import { Translator } from '../core/translator.js';
import { WorkflowConnectionError, WorkflowGraph } from '../core/workflow-graph.js';
import {
    commonInputTypes,
    type CreatableNodeType,
    type WorkspaceMethodMap,
} from './workspace-model.js';

export const workspaceEditingMethods: WorkspaceMethodMap = {
    workspaceElement(name: string): HTMLElement | null {
        return document.querySelector<HTMLElement>(`[data-workspace-ref="${CSS.escape(name)}"]`);
    },
    t(key: string, parameters: Record<string, string | number> = {}): string {
        return Translator.text(key, parameters);
    },
    renderGraph(): void {
        this.graph?.render(this.project.nodes, this.project.connections, {
            selectedNodeId: this.activeNodeId,
            selectedConnectionId: this.activeConnectionId,
            states: this.executionState.nodes,
            connectedNodeIds: WorkflowGraph.connectedNodeIds(this.project),
            disconnectedLabel: this.t('graph.disconnected'),
            staleNodeIds: this.staleNodeIds,
            inputFileNames: Object.fromEntries(
                Object.entries(this.inputFiles as Record<string, File>).map(([id, file]) => [
                    id,
                    file.name,
                ]),
            ),
            chooseFileLabel: this.t('input.chooseFile'),
            recordingActive: this.recordingActive,
            lockedNodeIds: this.executionLockedNodeIds,
            playbackTriggerNodeId: this.playbackTriggerNodeId,
            executionRunning: this.executionRunning,
            recordingReady: this.browserSessionInputsReady,
            pausedAudioNodeId:
                this.executionRunning && this.audioPaused ? this.instantAudioNodeId : null,
        });
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

        if (!connectionId || this.executionRunning) {
            return;
        }

        const index = this.project.connections.findIndex(
            (connection: WorkflowConnection) => connection.id === connectionId,
        );

        if (index < 0) {
            return;
        }

        this.project.connections.splice(index, 1);
        this.activeConnectionId = null;
        this.markExecutionDirty();
        this.renderGraph();
        this.showNotice(this.t('graph.connectionDeleted'));
    },
    addNode(type: CreatableNodeType): void {
        if (this.executionRunning) {
            return;
        }

        this.nodeMenuOpen = false;
        const node = this.createNode(type);
        node.position = this.graph?.centeredNodePosition() ?? null;
        this.project.nodes.push(node);
        this.activeNodeId = node.id;
        this.activeConnectionId = null;
        this.activeSource = 'html';
        this.markExecutionDirty();
        this.graph?.preserveViewportOnNextRender();
        this.renderGraph();
        this.recenterNewNode(node);
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

        if (type === 'text-layer') {
            return ProjectNodes.createTextLayer(this.project, this.t('node.defaultTextLayerName'));
        }

        if (type === 'javascript') {
            return ProjectNodes.createJavaScript(
                this.project,
                this.t('node.defaultJavaScriptName'),
            );
        }

        if (type === 'delay') {
            return ProjectNodes.createDelay(this.project, this.t('node.defaultDelayName'));
        }

        if (type === 'browser-action') {
            return ProjectNodes.createBrowserAction(
                this.project,
                this.t('node.defaultBrowserActionName'),
            );
        }

        if (type === 'merge') {
            return ProjectNodes.createMerge(this.project, this.t('node.defaultMergeName'));
        }

        if (type === 'audio') {
            return ProjectNodes.createAudio(this.project, this.t('node.defaultAudioName'));
        }

        if (type === 'video-output') {
            return ProjectNodes.createVideoOutput(
                this.project,
                this.t('node.defaultVideoOutputName'),
            );
        }

        return ProjectNodes.createBrowserWait(this.project, this.t('node.defaultBrowserWaitName'));
    },
    duplicateActiveNode(): void {
        if (
            !this.activeNode ||
            !ProjectNodes.canDuplicate(this.activeNode) ||
            this.executionRunning
        ) {
            return;
        }

        this.nodeMenuOpen = false;
        const duplicate = ProjectNodes.duplicate(
            this.project,
            this.activeNode,
            this.t('node.copyName', { name: this.activeNode.name }),
        );

        if (!duplicate) {
            return;
        }

        duplicate.position = this.graph?.centeredNodePosition() ?? null;
        this.project.nodes.push(duplicate);
        this.activeNodeId = duplicate.id;
        this.activeConnectionId = null;
        this.markExecutionDirty();
        this.graph?.preserveViewportOnNextRender();
        this.renderGraph();
        this.recenterNewNode(duplicate);
        this.showNotice(this.t('node.duplicated', { name: duplicate.name }));
    },
    recenterNewNode(node: DirectorNode): void {
        void nextTick(() => {
            if (!this.project.nodes.some((candidate: DirectorNode) => candidate.id === node.id)) {
                return;
            }

            node.position = this.graph?.centeredNodePosition() ?? node.position;
            this.renderGraph();
        });
    },
    deleteActiveNode(): void {
        if (!this.activeNodeId || this.executionRunning) {
            return;
        }

        this.nodeMenuOpen = false;
        const deleted = this.activeNode;

        if (!deleted || !ProjectNodes.remove(this.project, deleted.id)) {
            return;
        }

        if (deleted.type === 'input') {
            delete this.inputFiles[deleted.id];
            delete this.inputData[deleted.id];
            delete this.inputAcceptQueries[deleted.id];
        }

        this.activeNodeId = null;
        this.activeConnectionId = null;
        this.staleNodeIds.delete(deleted.id);
        this.markExecutionDirty();
        this.renderGraph();
        this.showNotice(this.t('node.deleted', { name: deleted.name }));
    },
    convertActiveTextLayer(): void {
        const layer = this.activeLayer;

        if (!layer?.text || this.activeNodeLocked) {
            return;
        }

        this.pendingSourceConversion = { id: layer.id, kind: 'text-layer' };
    },
    convertActiveDelay(): void {
        const delay = this.activeDelay;

        if (!delay || this.activeNodeLocked) {
            return;
        }

        this.pendingSourceConversion = { id: delay.id, kind: 'delay' };
    },
    cancelSourceConversion(): void {
        this.pendingSourceConversion = null;
    },
    confirmSourceConversion(): void {
        const request = this.pendingSourceConversion;
        this.pendingSourceConversion = null;

        if (!request || this.activeNodeLocked) {
            return;
        }

        if (request.kind === 'delay') {
            const delay = this.activeDelay;

            if (!delay || delay.id !== request.id) {
                return;
            }

            delay.source = DelayNodeSource.render(delay.delay!);
            delete delay.delay;
            this.markActiveNodeStale();
            return;
        }

        const layer = this.activeLayer;

        if (!layer?.text || layer.id !== request.id) {
            return;
        }

        layer.source = TextLayerSource.render(layer.text, layer.id);

        if (layer.text.font === 'project') {
            layer.fontInputId = layer.text.fontInputId;
        }

        delete layer.text;
        this.markActiveNodeStale();
    },
    updateActiveDelay(): void {
        const delay = this.activeDelay;

        if (!delay) {
            return;
        }

        delay.source = DelayNodeSource.render(delay.delay!);
        this.markActiveNodeStale();
        this.renderGraph();
    },
    markDirty(): void {
        this.dirty = true;
    },
    markExecutionDirty(): void {
        this.markDirty();
    },
    markActiveNodeStale(): void {
        this.markDirty();
        const node = this.activeNode;
        const becameStale = Boolean(
            node && !['website', 'input'].includes(node.type) && !this.staleNodeIds.has(node.id),
        );

        if (node && !['website', 'input'].includes(node.type)) {
            this.staleNodeIds.add(node.id);
        }

        if (becameStale) {
            this.renderGraph();
        }
    },
    updateSource(source: string): void {
        if (!this.activeLayer) {
            return;
        }

        this.activeLayer.source[this.activeSource] = source;
        this.markActiveNodeStale();
    },
    updateBrowserWaitScript(source: string): void {
        if (this.activeBrowserWait?.condition !== 'script') {
            return;
        }

        this.activeBrowserWait.script = source;
        this.markActiveNodeStale();
    },
    async formatActiveSource(): Promise<void> {
        if (this.formattingSource) {
            return;
        }

        const layer = this.activeLayer;
        const javaScriptNode = this.activeJavaScript;
        const scriptWait =
            this.activeBrowserWait?.condition === 'script' ? this.activeBrowserWait : null;

        if (!layer && !javaScriptNode && !scriptWait) {
            return;
        }

        const language = layer ? this.activeSource : 'javascript';
        const source = layer
            ? layer.source[language]
            : (javaScriptNode?.source ?? scriptWait!.script);
        this.formattingSource = true;

        try {
            const formatted = await SourceFormatter.format(source, language);
            const currentSource = layer
                ? layer.source[language]
                : (javaScriptNode?.source ?? scriptWait!.script);

            if (currentSource !== source) {
                return;
            }

            if (layer) {
                layer.source[language] = formatted;
            } else if (javaScriptNode) {
                javaScriptNode.source = formatted;
            } else {
                scriptWait!.script = formatted;
            }

            this.markActiveNodeStale();
            await nextTick();
            document.querySelector<HTMLTextAreaElement>('.source-editor textarea')?.focus();
        } catch (error) {
            this.showNotice(`${this.t('editor.formatFailed')} ${this.errorMessage(error)}`);
        } finally {
            this.formattingSource = false;
        }
    },
    updateWebsiteUrl(event: Event): void {
        const input = event.target;

        if (!(input instanceof HTMLInputElement) || !this.activeWebsite) {
            return;
        }

        this.activeWebsite.url = input.value;
        this.markExecutionDirty();
        this.renderGraph();
    },
    updateBrowserSessionSetting(setting: 'language' | 'locale', event: Event): void {
        const input = event.target;

        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        const value = input.value.trim();

        if (this.project.browserSession[setting] === value) {
            return;
        }

        this.project.browserSession[setting] = value;
        this.markBrowserSessionChanged();
    },
    setBrowserPermission(permission: BrowserPermission, event: Event): void {
        const input = event.target;

        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        const permissions = this.project.browserSession.permissions;
        const selected = new Set(permissions);

        if (input.checked) {
            selected.add(permission);
        } else {
            selected.delete(permission);
        }

        this.project.browserSession.permissions = [...this.browserPermissions].filter((candidate) =>
            selected.has(candidate),
        );
        this.markBrowserSessionChanged();
    },
    markBrowserSessionChanged(): void {
        this.markExecutionDirty();

        if (this.remotePreviewSessionId || this.selectedBrowserTargetId) {
            void this.switchToLocalPreview();
        }
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
            if (this.activeInputAcceptId === inputId) {
                this.activeInputAcceptId = null;
            }
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

            if (values.length) {
                this.removeInputAccept(input, values.at(-1)!);
            }

            return;
        }

        if (!['Enter', ',', 'Tab'].includes(event.key) || !query.trim()) {
            return;
        }

        if (event.key !== 'Tab') {
            event.preventDefault();
        }

        this.addInputAccept(input, query);
    },
    addInputAccept(input: ProjectFileInput, value: string): void {
        const values = this.inputAcceptValues(input);

        for (const candidate of value.split(',')) {
            const normalized = candidate.trim().toLowerCase();

            if (normalized && !values.includes(normalized)) {
                values.push(normalized);
            }
        }

        input.accept = values.join(',');
        this.inputAcceptQueries[input.id] = '';
        this.activeInputAcceptId = input.id;
        this.markExecutionDirty();
    },
    removeInputAccept(input: ProjectFileInput, value: string): void {
        input.accept = this.inputAcceptValues(input)
            .filter((candidate: string) => candidate !== value)
            .join(',');
        this.markExecutionDirty();
    },
    addInputPreparation(inputId: string): void {
        const input = this.inputNodes.find((candidate: InputNode) => candidate.id === inputId);

        if (!input) {
            return;
        }

        input.prepare ??= { modules: [] };
        input.prepare.modules.push('');
        this.markExecutionDirty();
    },
    removeInputPreparation(inputId: string, index: number): void {
        const input = this.inputNodes.find((candidate: InputNode) => candidate.id === inputId);

        if (!input?.prepare) {
            return;
        }

        input.prepare.modules.splice(index, 1);

        if (input.prepare.modules.length === 0) {
            delete input.prepare;
        }

        this.markExecutionDirty();
    },
    updateInputPreparation(inputId: string, index: number, event: Event): void {
        const field = event.target;

        if (!(field instanceof HTMLInputElement)) {
            return;
        }

        const input = this.inputNodes.find((candidate: InputNode) => candidate.id === inputId);

        if (!input?.prepare || index < 0 || index >= input.prepare.modules.length) {
            return;
        }

        input.prepare.modules[index] = field.value;
        this.markExecutionDirty();
    },
    async updateInputFile(inputId: string, event: Event): Promise<void> {
        const input = event.target;

        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        const file = input.files?.[0];

        if (!file) {
            this.clearInputFile(inputId);
            return;
        }

        this.inputFiles[inputId] = markRaw(file);
        const selectionRevision = (this.inputFileSelectionRevisions[inputId] ?? 0) + 1;
        this.inputFileSelectionRevisions[inputId] = selectionRevision;
        this.renderGraph();
        const store = (async (): Promise<void> => {
            const [reference, data] = await Promise.all([
                ProjectAssets.store(file),
                BrowserTestbenchPreview.runtimeInputs({ [inputId]: file }),
            ]);

            if (this.inputFileSelectionRevisions[inputId] !== selectionRevision) {
                return;
            }

            const node = this.inputNodes.find((candidate: InputNode) => candidate.id === inputId);

            if (!node) {
                return;
            }

            node.file = reference;
            this.inputData[inputId] = data[inputId]!;
            this.dirty = true;

            if (this.executionController.clear(inputId)) {
                this.executionState = this.executionController.snapshot();
            }

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
        const inputNode = this.inputNodes.find((candidate: InputNode) => candidate.id === inputId);

        if (inputNode) {
            delete inputNode.file;
        }

        this.inputFileSelectionRevisions[inputId] =
            (this.inputFileSelectionRevisions[inputId] ?? 0) + 1;
        delete this.inputFiles[inputId];
        delete this.inputData[inputId];
        this.dirty = true;
        const field = document.querySelector<HTMLInputElement>(
            `[data-testid="project-input-${CSS.escape(inputId)}"]`,
        );

        if (field) {
            field.value = '';
        }

        this.renderGraph();
    },
    updateJavaScriptSource(source: string): void {
        if (!this.activeJavaScript) {
            return;
        }

        this.activeJavaScript.source = source;
        this.markActiveNodeStale();
    },
    setBrowserWaitCondition(event: Event): void {
        const input = event.target;

        if (!(input instanceof HTMLSelectElement) || !this.activeBrowserWait) {
            return;
        }

        const condition = input.value as 'element' | 'url' | 'script';

        if (condition === this.activeBrowserWait.condition) {
            return;
        }

        const current = this.activeBrowserWait;
        const common = {
            id: current.id,
            type: current.type,
            name: current.name,
            position: current.position,
            timeoutMs: current.timeoutMs,
            omitFromRecording: current.omitFromRecording,
        } as const;
        const replacement =
            condition === 'url'
                ? { ...common, condition, value: '/' }
                : condition === 'script'
                  ? { ...common, condition, script: 'return true;' }
                  : { ...common, condition, selector: 'body' };
        const index = this.project.nodes.findIndex((node: DirectorNode) => node.id === current.id);

        if (index < 0) {
            return;
        }

        this.project.nodes.splice(index, 1, replacement);
        this.markActiveNodeStale();
        this.renderGraph();
    },
    setPlacementReference(event: Event): void {
        const input = event.target;

        if (!(input instanceof HTMLSelectElement) || !this.activeLayer) {
            return;
        }

        const type = input.value as 'viewport' | 'layer' | 'dom';

        if (type === 'layer') {
            const parent = this.availableParentLayers.at(-1);

            if (!parent) {
                return;
            }

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

        if (!(input instanceof HTMLSelectElement) || !this.activeLayer) {
            return;
        }

        this.activeLayer.placement.reference = { type: 'layer', nodeId: input.value };
        this.markActiveNodeStale();
    },
    setHorizontalAlignment(horizontal: HorizontalAlignment): void {
        if (!this.activeLayer) {
            return;
        }

        this.activeLayer.placement = {
            ...this.activeLayer.placement,
            horizontal,
            vertical: this.verticalAlignment,
        };
        this.markActiveNodeStale();
    },
    setVerticalAlignment(vertical: VerticalAlignment): void {
        if (!this.activeLayer) {
            return;
        }

        this.activeLayer.placement = {
            ...this.activeLayer.placement,
            horizontal: this.horizontalAlignment,
            vertical,
        };
        this.markActiveNodeStale();
    },
    setLayerOffset(axis: 'x' | 'y', event: Event): void {
        if (!this.activeLayer) {
            return;
        }

        const value = Number((event.target as HTMLInputElement).value);

        if (!Number.isFinite(value)) {
            return;
        }

        this.activeLayer.placement[axis === 'x' ? 'offsetXPercent' : 'offsetYPercent'] = value;
        this.markActiveNodeStale();
    },
    toggleNodeMenu(): void {
        this.nodeMenuOpen = !this.nodeMenuOpen;
        this.nodeMenuCategory = '';

        if (this.nodeMenuOpen) {
            this.positionFlyout('nodeFlyout');
        }
    },
    positionFlyout(refName: string): void {
        void nextTick(() => {
            const flyout = this.workspaceElement(refName) as HTMLElement | null;

            if (!flyout) {
                return;
            }

            const menu = flyout.querySelector<HTMLElement>('.flyout-menu');

            if (menu) {
                positionFlyout(menu);
            }
        });
    },
    positionOpenFlyouts(): void {
        document.querySelectorAll<HTMLElement>('.flyout-menu').forEach(positionFlyout);
    },
    closeNodeMenu(event: PointerEvent): void {
        const flyout = this.workspaceElement('nodeFlyout');

        if (flyout instanceof HTMLElement && flyout.contains(event.target as Node)) {
            return;
        }

        this.nodeMenuOpen = false;
        this.nodeMenuCategory = '';
    },
};

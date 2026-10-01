import { nextTick } from 'vue';

import {
    WorkspaceLayoutPreferences,
    type Splitter,
    type WorkspaceMethodMap,
    type WorkspacePanel,
} from './workspace-model.js';

export const workspaceLayoutMethods: WorkspaceMethodMap = {
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
            if (panel === 'graph') {
                this.renderGraph();
            }

            if (panel === 'preview') {
                this.updatePreviewFitScale();
            }
        });
    },
    selectNode(id: string | null): void {
        this.activeConnectionId = null;
        this.activeNodeId = id;

        if (!id) {
            this.mobileActivePanel = 'graph';
        }

        this.observePreviewStage();
    },
    observePreviewStage(): void {
        void nextTick(() => {
            this.previewResizeObserver?.disconnect();
            const stage = this.workspaceElement('previewStage');

            if (stage instanceof HTMLElement) {
                this.previewResizeObserver?.observe(stage);
                this.updatePreviewFitScale();
            }
        });
    },
    updatePreviewFitScale(): void {
        const stage = this.workspaceElement('previewStage');

        if (!(stage instanceof HTMLElement)) {
            return;
        }

        const style = getComputedStyle(stage);
        const availableWidth =
            stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const availableHeight =
            stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

        if (availableWidth <= 0 || availableHeight <= 0) {
            return;
        }

        this.previewFitScale = Math.min(
            availableWidth / this.previewViewport.width,
            availableHeight / this.previewViewport.height,
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
        const stage = this.workspaceElement('graph');

        if (!(stage instanceof HTMLElement)) {
            return;
        }

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
        if (this.executionRunning || this.graphLayoutRunning) {
            return;
        }

        this.graphLayoutRunning = true;

        try {
            for (const node of this.project.nodes) {
                node.position = null;
            }

            this.markDirty();
            await this.graph?.arrangeAutomatically(
                this.project.nodes,
                this.project.connections,
                false,
            );
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

        if (!isTouch && !isRightMouseButton) {
            return;
        }

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

        if (zoomUpdate === null && pan === null) {
            return;
        }

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

        if (event.pointerType === 'mouse' && event.button === 2) {
            event.stopPropagation();
        }
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
        if (window.matchMedia('(max-width: 760px)').matches) {
            return;
        }

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
        if (!this.activeSplitter) {
            return;
        }

        const workspace = this.$refs['workspace'];

        if (!(workspace instanceof HTMLElement)) {
            return;
        }

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
        if (!this.activeSplitter) {
            return;
        }

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

        if (!relevantKeys.includes(event.key)) {
            return;
        }

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

        if (splitter === 'inner') {
            this.layout.toolsSplit = value;
        } else if (this.previewOrientation === 'portrait') {
            this.layout.portraitTools = value;
        } else {
            this.layout.landscapePreview = value;
        }
    },
};

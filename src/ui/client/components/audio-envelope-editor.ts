import { defineComponent, type PropType } from 'vue';

import template from '../templates/audio-envelope-editor.html?raw';
import { TemplateRegistry } from '../core/template-registry.js';
import type { AudioEnvelopePoint } from '../core/project-format.js';

const drawingHeight = 112;

export const AudioEnvelopeEditor = defineComponent({
    name: 'AudioEnvelopeEditor',
    props: {
        modelValue: {
            type: Array as PropType<readonly AudioEnvelopePoint[]>,
            required: true,
        },
        label: {
            type: String,
            required: true,
        },
        deleteLabel: {
            type: String,
            required: true,
        },
    },
    emits: {
        'update:modelValue': (_points: AudioEnvelopePoint[]) => true,
        change: () => true,
    },
    data: () => ({
        canvasWidth: 600,
        resizeObserver: null as ResizeObserver | null,
        selectedIndex: null as number | null,
        draggingPointerId: null as number | null,
    }),
    computed: {
        viewBox(): string {
            return `0 0 ${this.canvasWidth} ${drawingHeight}`;
        },
        renderedPoints(): Array<AudioEnvelopePoint & { x: number; y: number }> {
            return this.modelValue.map((point) => ({
                ...point,
                x: point.time * this.canvasWidth,
                y: (1 - point.gain) * drawingHeight,
            }));
        },
        linePoints(): string {
            return this.renderedPoints.map((point) => `${point.x},${point.y}`).join(' ');
        },
        fillPoints(): string {
            return `0,${drawingHeight} ${this.linePoints} ${this.canvasWidth},${drawingHeight}`;
        },
        selectedPoint(): AudioEnvelopePoint | null {
            return this.selectedIndex === null
                ? null
                : (this.modelValue[this.selectedIndex] ?? null);
        },
        canDeleteSelected(): boolean {
            return (
                this.selectedIndex !== null &&
                this.selectedIndex > 0 &&
                this.selectedIndex < this.modelValue.length - 1
            );
        },
    },
    mounted(): void {
        const canvas = this.$refs['canvas'];

        if (!(canvas instanceof SVGSVGElement)) {
            return;
        }

        this.updateCanvasWidth();
        this.resizeObserver = new ResizeObserver(() => this.updateCanvasWidth());
        this.resizeObserver.observe(canvas);
    },
    beforeUnmount(): void {
        this.resizeObserver?.disconnect();
    },
    methods: {
        updateCanvasWidth(): void {
            const canvas = this.$refs['canvas'];

            if (canvas instanceof SVGSVGElement) {
                this.canvasWidth = Math.max(1, canvas.getBoundingClientRect().width);
            }
        },
        addPoint(event: MouseEvent): void {
            const point = this.pointerPoint(event);

            if (!point || point.time <= 0 || point.time >= 1) {
                return;
            }

            if (
                this.modelValue.some(
                    (candidate) => Math.abs(candidate.time - point.time) < 16 / this.canvasWidth,
                )
            ) {
                return;
            }

            const next = [...this.modelValue, point].sort((left, right) => left.time - right.time);
            this.selectedIndex = next.indexOf(point);
            this.update(next, true);
        },
        startDragging(index: number, event: PointerEvent): void {
            event.stopPropagation();
            this.selectedIndex = index;
            this.draggingPointerId = event.pointerId;
            (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
        },
        dragPoint(index: number, event: PointerEvent): void {
            if (this.draggingPointerId !== event.pointerId) {
                return;
            }

            const point = this.pointerPoint(event);

            if (!point) {
                return;
            }

            this.movePoint(index, point.time, point.gain);
        },
        stopDragging(event: PointerEvent): void {
            if (this.draggingPointerId !== event.pointerId) {
                return;
            }

            this.draggingPointerId = null;
            this.$emit('change');
        },
        moveWithKeyboard(index: number, event: KeyboardEvent): void {
            const point = this.modelValue[index];

            if (!point) {
                return;
            }

            const horizontal =
                event.key === 'ArrowLeft' ? -0.01 : event.key === 'ArrowRight' ? 0.01 : 0;
            const vertical = event.key === 'ArrowDown' ? -0.02 : event.key === 'ArrowUp' ? 0.02 : 0;

            if (!horizontal && !vertical) {
                return;
            }

            event.preventDefault();
            this.selectedIndex = index;
            this.movePoint(index, point.time + horizontal, point.gain + vertical, true);
        },
        deleteSelected(): void {
            if (!this.canDeleteSelected || this.selectedIndex === null) {
                return;
            }

            const next = this.modelValue.filter((_point, index) => index !== this.selectedIndex);
            this.selectedIndex = Math.min(this.selectedIndex, next.length - 1);
            this.update(next, true);
        },
        pointLabel(point: AudioEnvelopePoint): string {
            return `${Math.round(point.time * 100)} %, ${Math.round(point.gain * 100)} %`;
        },
        movePoint(index: number, time: number, gain: number, finished = false): void {
            const previous = this.modelValue[index - 1];
            const next = this.modelValue[index + 1];
            const fixedTime = index === 0 ? 0 : index === this.modelValue.length - 1 ? 1 : time;
            const minimumTime = previous ? previous.time + 16 / this.canvasWidth : 0;
            const maximumTime = next ? next.time - 16 / this.canvasWidth : 1;
            const moved = {
                time: Math.min(maximumTime, Math.max(minimumTime, fixedTime)),
                gain: Math.min(1, Math.max(0, gain)),
            };
            const points = this.modelValue.map((point, pointIndex) =>
                pointIndex === index ? moved : point,
            );
            this.update(points, finished);
        },
        update(points: AudioEnvelopePoint[], finished: boolean): void {
            this.$emit('update:modelValue', points);

            if (finished) {
                this.$emit('change');
            }
        },
        pointerPoint(event: MouseEvent | PointerEvent): AudioEnvelopePoint | null {
            const svg = this.$refs['canvas'];

            if (!(svg instanceof SVGSVGElement)) {
                return null;
            }

            const bounds = svg.getBoundingClientRect();

            if (bounds.width <= 0 || bounds.height <= 0) {
                return null;
            }

            return {
                time: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
                gain: Math.min(1, Math.max(0, 1 - (event.clientY - bounds.top) / bounds.height)),
            };
        },
    },
});

TemplateRegistry.attach(AudioEnvelopeEditor, template);

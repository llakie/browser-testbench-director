import { defineComponent, type PropType } from 'vue';

import template from '../templates/audio-envelope-editor.html?raw';
import { TemplateRegistry } from '../core/template-registry.js';
import type { AudioEnvelopePoint } from '../core/project-format.js';

const drawing = { left: 16, top: 12, width: 568, height: 116 } as const;
const minimumPointDistance = 16 / drawing.width;

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
        selectedIndex: null as number | null,
        draggingPointerId: null as number | null,
    }),
    computed: {
        renderedPoints(): Array<AudioEnvelopePoint & { x: number; y: number }> {
            return this.modelValue.map((point) => ({
                ...point,
                x: drawing.left + point.time * drawing.width,
                y: drawing.top + (1 - point.gain) * drawing.height,
            }));
        },
        linePoints(): string {
            return this.renderedPoints.map((point) => `${point.x},${point.y}`).join(' ');
        },
        fillPoints(): string {
            const bottom = drawing.top + drawing.height;
            return `${drawing.left},${bottom} ${this.linePoints} ${drawing.left + drawing.width},${bottom}`;
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
    methods: {
        addPoint(event: MouseEvent): void {
            const point = this.pointerPoint(event);

            if (!point || point.time <= 0 || point.time >= 1) {
                return;
            }

            if (
                this.modelValue.some(
                    (candidate) => Math.abs(candidate.time - point.time) < minimumPointDistance,
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
            const minimumTime = previous ? previous.time + minimumPointDistance : 0;
            const maximumTime = next ? next.time - minimumPointDistance : 1;
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

            const x = ((event.clientX - bounds.left) / bounds.width) * 600;
            const y = ((event.clientY - bounds.top) / bounds.height) * 140;
            return {
                time: Math.min(1, Math.max(0, (x - drawing.left) / drawing.width)),
                gain: Math.min(1, Math.max(0, 1 - (y - drawing.top) / drawing.height)),
            };
        },
    },
});

TemplateRegistry.attach(AudioEnvelopeEditor, template);

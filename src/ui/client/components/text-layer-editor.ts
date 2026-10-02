import { defineComponent, type PropType } from 'vue';

import type { InputNode, LayerNode } from '../core/project-format.js';
import { TextLayerSource, type TextEffect } from '../core/text-layer-source.js';
import { Translator } from '../core/translator.js';
import { TemplateRegistry } from '../core/template-registry.js';
import template from '../templates/text-layer-editor.html?raw';

export const TextLayerEditor = defineComponent({
    name: 'TextLayerEditor',
    props: {
        layer: { type: Object as PropType<LayerNode>, required: true },
        fontInputs: { type: Array as PropType<readonly InputNode[]>, required: true },
    },
    emits: ['change'],
    data() {
        return {
            draggedLineId: null as string | null,
            dropTargetId: null as string | null,
            dragPointerId: null as number | null,
        };
    },
    computed: {
        fontValue(): string {
            const text = this.layer.text!;
            return text.font === 'project' ? `input:${text.fontInputId}` : text.font;
        },
        fontSummary(): string {
            const text = this.layer.text!;
            return text.font === 'project'
                ? (this.fontInputs.find((input) => input.id === text.fontInputId)?.name ??
                      text.font)
                : text.font;
        },
    },
    methods: {
        t(key: string, parameters: Record<string, string | number> = {}): string {
            return Translator.text(key, parameters);
        },
        update(): void {
            this.layer.source = TextLayerSource.render(this.layer.text!, this.layer.id);
            this.$emit('change');
        },
        selectFont(event: Event): void {
            const value = (event.target as HTMLSelectElement).value;
            const text = this.layer.text!;
            text.font = value.startsWith('input:') ? 'project' : (value as typeof text.font);
            text.fontInputId = value.startsWith('input:') ? value.slice(6) : '';
            this.update();
        },
        addLine(): void {
            this.layer.text!.lines.push(TextLayerSource.line());
            this.update();
        },
        removeLine(index: number): void {
            const lines = this.layer.text!.lines;

            if (lines.length === 1) {
                return;
            }

            const removed = lines.splice(index, 1)[0]!;

            if (index === 0) {
                lines[0]!.offsetMs = 0;
            } else if (lines[index]) {
                lines[index]!.offsetMs += removed.offsetMs;
            }

            this.update();
        },
        moveLine(index: number, direction: -1 | 1): void {
            const lines = this.layer.text!.lines;
            const target = index + direction;

            if (target < 0 || target >= lines.length) {
                return;
            }

            this.reorderLine(index, target);
        },
        reorderLine(from: number, to: number): void {
            const lines = this.layer.text!.lines;

            if (from === to || from < 0 || to < 0 || from >= lines.length || to >= lines.length) {
                return;
            }

            const offsets = lines.map((line) => line.offsetMs);
            const [line] = lines.splice(from, 1);
            lines.splice(to, 0, line!);
            lines.forEach((item, index) => {
                item.offsetMs = offsets[index]!;
            });
            this.update();
        },
        startLineDrag(event: PointerEvent, id: string): void {
            event.preventDefault();
            event.stopPropagation();
            this.draggedLineId = id;
            this.dragPointerId = event.pointerId;
            (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        },
        moveLineDrag(event: PointerEvent): void {
            if (event.pointerId !== this.dragPointerId) {
                return;
            }

            const target = document.elementFromPoint(event.clientX, event.clientY);
            const id = target?.closest<HTMLElement>('[data-line-id]')?.dataset.lineId;
            this.dropTargetId = id && id !== this.draggedLineId ? id : null;
        },
        endLineDrag(event: PointerEvent): void {
            if (event.pointerId !== this.dragPointerId) {
                return;
            }

            event.preventDefault();
            const lines = this.layer.text!.lines;
            const from = lines.findIndex((line) => line.id === this.draggedLineId);
            const to = lines.findIndex((line) => line.id === this.dropTargetId);
            this.cancelLineDrag();
            this.reorderLine(from, to);
        },
        cancelLineDrag(): void {
            this.draggedLineId = null;
            this.dropTargetId = null;
            this.dragPointerId = null;
        },
        setEffect(effect: TextEffect, event: Event): void {
            effect.name = (event.target as HTMLSelectElement).value as TextEffect['name'];
            this.update();
        },
    },
});

TemplateRegistry.attach(TextLayerEditor, template);

import { defineComponent, type PropType } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';
import { Translator } from '../core/translator.js';
import template from '../templates/node-add-menu.html?raw';
import type { CreatableNodeType } from './workspace-model.js';

type NodeMenuCategory = 'inputs' | 'layers' | 'browser' | 'flow';

interface NodeMenuCategoryItem {
    readonly id: NodeMenuCategory;
    readonly icon: string;
}

interface NodeMenuItem {
    readonly category: NodeMenuCategory;
    readonly type: CreatableNodeType;
    readonly icon: string;
    readonly testId: string;
    readonly labelKey: string;
}

const categories: readonly NodeMenuCategoryItem[] = [
    { id: 'inputs', icon: 'bi-box-arrow-in-right' },
    { id: 'layers', icon: 'bi-layers' },
    { id: 'browser', icon: 'bi-cursor' },
    { id: 'flow', icon: 'bi-diagram-3' },
];

const items: readonly NodeMenuItem[] = [
    {
        category: 'inputs',
        type: 'input',
        icon: 'bi-file-earmark-arrow-up',
        testId: 'add-input-node',
        labelKey: 'node.addInput',
    },
    {
        category: 'inputs',
        type: 'camera-capability',
        icon: 'bi-camera-video',
        testId: 'add-camera-capability-node',
        labelKey: 'node.addCameraCapability',
    },
    {
        category: 'layers',
        type: 'layer',
        icon: 'bi-layers',
        testId: 'add-layer-node',
        labelKey: 'node.addLayer',
    },
    {
        category: 'layers',
        type: 'text-layer',
        icon: 'bi-fonts',
        testId: 'add-text-layer-node',
        labelKey: 'node.addTextLayer',
    },
    {
        category: 'layers',
        type: 'audio',
        icon: 'bi-volume-up',
        testId: 'add-audio-node',
        labelKey: 'node.addAudio',
    },
    {
        category: 'browser',
        type: 'javascript',
        icon: 'bi-braces',
        testId: 'add-javascript-node',
        labelKey: 'node.addJavaScript',
    },
    {
        category: 'browser',
        type: 'browser-action',
        icon: 'bi-cursor',
        testId: 'add-browser-action-node',
        labelKey: 'node.addBrowserAction',
    },
    {
        category: 'browser',
        type: 'browser-wait',
        icon: 'bi-hourglass-split',
        testId: 'add-browser-wait-node',
        labelKey: 'node.addBrowserWait',
    },
    {
        category: 'flow',
        type: 'delay',
        icon: 'bi-clock',
        testId: 'add-delay-node',
        labelKey: 'node.addDelay',
    },
    {
        category: 'flow',
        type: 'merge',
        icon: 'bi-sign-merge-right',
        testId: 'add-merge-node',
        labelKey: 'node.addMerge',
    },
    {
        category: 'flow',
        type: 'video-output',
        icon: 'bi-camera-reels',
        testId: 'add-video-output-node',
        labelKey: 'node.addVideoOutput',
    },
];

export const NodeAddMenu = defineComponent({
    name: 'NodeAddMenu',
    props: {
        open: { type: Boolean, required: true },
        category: {
            type: String as PropType<NodeMenuCategory | ''>,
            required: true,
        },
        disabled: { type: Boolean, default: false },
        videoOutputAvailable: { type: Boolean, required: true },
    },
    emits: ['toggle', 'close', 'update:category', 'add'],
    computed: {
        categories(): readonly NodeMenuCategoryItem[] {
            return categories;
        },
        visibleItems(): readonly NodeMenuItem[] {
            return items.filter(
                (item) =>
                    item.category === this.category &&
                    (item.type !== 'video-output' || this.videoOutputAvailable),
            );
        },
    },
    methods: {
        t(key: string): string {
            return Translator.text(key);
        },
        closeLevel(): void {
            if (this.category) {
                this.$emit('update:category', '');

                return;
            }

            this.$emit('close');
        },
        add(type: CreatableNodeType): void {
            this.$emit('add', type);
        },
    },
});

TemplateRegistry.attach(NodeAddMenu, template);

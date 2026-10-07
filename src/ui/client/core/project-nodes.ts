import type {
    BrowserActionNode,
    BrowserWaitNode,
    AudioNode,
    DirectorNode,
    DirectorProject,
    InputNode,
    JavaScriptNode,
    LayerNode,
    MergeNode,
    CapabilityNode,
    VideoOutputNode,
    ScreenshotOutputNode,
} from './project-format.js';
import { DelayNodeSource } from './delay-node-source.js';
import { TextLayerSource } from './text-layer-source.js';

export class ProjectNodes {
    static canDuplicate(node: DirectorNode): boolean {
        return !['website', 'video-output', 'screenshot-output'].includes(node.type);
    }

    static createInput(project: DirectorProject, name: string): InputNode {
        return {
            id: ProjectNodes.uniqueId(project, 'input'),
            type: 'input',
            name,
            position: null,
            accept: '',
            required: false,
        };
    }

    static createVariablesInput(project: DirectorProject, name: string): InputNode {
        return {
            ...ProjectNodes.createInput(project, name),
            variables: {},
        };
    }

    static createCameraCapability(project: DirectorProject, name: string): CapabilityNode {
        return {
            id: ProjectNodes.uniqueId(project, 'camera'),
            type: 'capability',
            name,
            position: null,
            capability: 'camera',
        };
    }

    static createLayer(project: DirectorProject, name: string): LayerNode {
        return {
            id: ProjectNodes.uniqueId(project, 'layer'),
            type: 'layer',
            name,
            position: null,
            placement: {
                reference: { type: 'viewport' },
                horizontal: 'center',
                vertical: 'center',
            },
            playback: { durationMs: 0, removeAfter: false },
            source: {
                html: '<div class="layer"></div>',
                css: '.layer { }',
                javascript: '',
            },
        };
    }

    static createTextLayer(project: DirectorProject, name: string): LayerNode {
        const layer = ProjectNodes.createLayer(project, name);
        layer.text = TextLayerSource.create();
        layer.source = TextLayerSource.render(layer.text, layer.id);
        return layer;
    }

    static createMerge(project: DirectorProject, name: string): MergeNode {
        return {
            id: ProjectNodes.uniqueId(project, 'merge'),
            type: 'merge',
            name,
            position: null,
            waitFor: 'all',
        };
    }

    static createAudio(project: DirectorProject, name: string): AudioNode {
        return {
            id: ProjectNodes.uniqueId(project, 'audio'),
            type: 'audio',
            name,
            position: null,
            volume: 1,
            envelope: [
                { time: 0, gain: 1 },
                { time: 1, gain: 1 },
            ],
            waitForEnd: true,
            loop: false,
            startOffsetMs: 0,
            fadeInMs: 0,
            fadeOutMs: 0,
        };
    }

    static createVideoOutput(project: DirectorProject, name: string): VideoOutputNode {
        return {
            id: ProjectNodes.uniqueId(project, 'video-output'),
            type: 'video-output',
            name,
            position: null,
            targetId: '',
            filename: 'video.mp4',
        };
    }

    static createScreenshotOutput(project: DirectorProject, name: string): ScreenshotOutputNode {
        return {
            id: ProjectNodes.uniqueId(project, 'screenshot-output'),
            type: 'screenshot-output',
            name,
            position: null,
            targetId: '',
            filename: 'screenshot.jpg',
            format: 'jpeg',
            quality: 0.9,
        };
    }

    static createJavaScript(project: DirectorProject, name: string): JavaScriptNode {
        return {
            id: ProjectNodes.uniqueId(project, 'javascript'),
            type: 'javascript',
            name,
            position: null,
            source: '',
        };
    }

    static createDelay(project: DirectorProject, name: string): JavaScriptNode {
        const node = ProjectNodes.createJavaScript(project, name);
        node.delay = DelayNodeSource.create();
        node.source = DelayNodeSource.render(node.delay);
        return node;
    }

    static createBrowserAction(project: DirectorProject, name: string): BrowserActionNode {
        return {
            id: ProjectNodes.uniqueId(project, 'browser-action'),
            type: 'browser-action',
            name,
            position: null,
            selector: 'button',
        };
    }

    static createBrowserWait(project: DirectorProject, name: string): BrowserWaitNode {
        return {
            id: ProjectNodes.uniqueId(project, 'browser-wait'),
            type: 'browser-wait',
            name,
            position: null,
            condition: 'element',
            selector: 'body',
            timeoutMs: 30_000,
            omitFromRecording: true,
        };
    }

    static duplicate(
        project: DirectorProject,
        node: DirectorNode,
        name: string,
    ): DirectorNode | null {
        if (!ProjectNodes.canDuplicate(node)) {
            return null;
        }

        const id = ProjectNodes.uniqueId(project, node.type);
        const position = null;

        if (node.type === 'javascript') {
            return {
                ...node,
                id,
                name,
                position,
                ...(node.delay ? { delay: { ...node.delay } } : {}),
            };
        }

        if (node.type === 'capability') {
            return { ...node, id, name, position };
        }

        if (node.type === 'merge') {
            return { ...node, id, name, position };
        }

        if (node.type === 'audio') {
            return {
                ...node,
                id,
                name,
                position,
                envelope: node.envelope.map((point) => ({ ...point })),
            };
        }

        if (node.type === 'input') {
            return {
                ...node,
                id,
                name,
                position,
                ...(node.file ? { file: { ...node.file } } : {}),
                ...(node.prepare ? { prepare: { modules: [...node.prepare.modules] } } : {}),
            };
        }

        if (node.type === 'layer') {
            const duplicate: LayerNode = {
                ...node,
                id,
                name,
                position,
                placement: { ...node.placement, reference: { ...node.placement.reference } },
                playback: { ...node.playback },
                source: { ...node.source },
                ...(node.text ? { text: structuredClone(node.text) } : {}),
            };

            if (duplicate.text) {
                duplicate.source = TextLayerSource.render(duplicate.text, duplicate.id);
            }

            return duplicate;
        }

        return { ...node, id, name, position };
    }

    static remove(project: DirectorProject, nodeId: string): boolean {
        const index = project.nodes.findIndex((node) => node.id === nodeId);

        if (index < 0 || project.nodes[index]?.type === 'website') {
            return false;
        }

        project.nodes.splice(index, 1);
        project.connections = project.connections.filter(
            (connection) => connection.source !== nodeId && connection.target !== nodeId,
        );

        for (const node of project.nodes) {
            if (node.type !== 'layer' || node.placement.reference.type !== 'layer') {
                continue;
            }

            if (node.placement.reference.nodeId !== nodeId) {
                continue;
            }

            node.placement.reference = { type: 'viewport' };
        }

        return true;
    }

    private static uniqueId(project: DirectorProject, prefix: string): string {
        const ids = new Set(project.nodes.map((node) => node.id));
        let suffix = 1;

        while (ids.has(`${prefix}-${suffix}`)) {
            suffix += 1;
        }

        return `${prefix}-${suffix}`;
    }
}

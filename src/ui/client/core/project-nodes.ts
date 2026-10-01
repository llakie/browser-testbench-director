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
} from './project-format.js';

export class ProjectNodes {
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

    static createJavaScript(project: DirectorProject, name: string): JavaScriptNode {
        return {
            id: ProjectNodes.uniqueId(project, 'javascript'),
            type: 'javascript',
            name,
            position: null,
            source: '',
        };
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
        if (node.type === 'website') {
            return null;
        }

        const id = ProjectNodes.uniqueId(project, node.type);
        const position = null;

        if (node.type === 'javascript') {
            return { ...node, id, name, position };
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
            return {
                ...node,
                id,
                name,
                position,
                placement: { ...node.placement, reference: { ...node.placement.reference } },
                playback: { ...node.playback },
                source: { ...node.source },
            };
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

import { WorkflowGraph } from './workflow-graph.js';

export const DIRECTOR_PROJECT_FORMAT = 'browser-testbench-director' as const;
export const DIRECTOR_PROJECT_VERSION = 7 as const;

export interface Point {
    readonly x: number;
    readonly y: number;
}

export interface LayerSource {
    html: string;
    css: string;
    javascript: string;
}

export type HorizontalAlignment = 'left' | 'center' | 'right';
export type VerticalAlignment = 'top' | 'center' | 'bottom';

export type LayerPlacementReference =
    { type: 'viewport' } | { type: 'layer'; nodeId: string } | { type: 'dom'; selector: string };

export interface LayerPlacement {
    reference: LayerPlacementReference;
    horizontal: HorizontalAlignment;
    vertical: VerticalAlignment;
}

export interface LayerNode {
    readonly id: string;
    readonly type: 'layer';
    name: string;
    position: Point | null;
    placement: LayerPlacement;
    playback: {
        durationMs: number;
        removeAfter: boolean;
    };
    source: LayerSource;
}

export interface WebsiteNode {
    readonly id: string;
    readonly type: 'website';
    name: string;
    position: Point | null;
    url: string;
}

export interface InputNode {
    readonly id: string;
    readonly type: 'input';
    name: string;
    position: Point | null;
    accept: string;
    required: boolean;
    file?: InputFileReference;
    prepare?: { modules: string[] };
}

export interface CapabilityNode {
    readonly id: string;
    readonly type: 'capability';
    name: string;
    position: Point | null;
    capability: 'camera';
}

export interface InputFileReference {
    readonly asset: string;
    readonly name: string;
    readonly type: string;
    readonly size: number;
    readonly sha256: string;
}

export interface JavaScriptNode {
    readonly id: string;
    readonly type: 'javascript';
    name: string;
    position: Point | null;
    source: string;
}

export interface BrowserActionNode {
    readonly id: string;
    readonly type: 'browser-action';
    name: string;
    position: Point | null;
    action: 'click';
    selector: string;
}

export interface BrowserWaitNode {
    readonly id: string;
    readonly type: 'browser-wait';
    name: string;
    position: Point | null;
    condition: 'element' | 'url' | 'script';
    selector: string;
    value: string;
    script: string;
    timeoutMs: number;
    omitFromRecording: boolean;
}

export type ExecutableNode = LayerNode | JavaScriptNode | BrowserActionNode | BrowserWaitNode;
export type DirectorNode = InputNode | CapabilityNode | WebsiteNode | ExecutableNode;

export interface WorkflowConnection {
    readonly id: string;
    readonly source: string;
    readonly target: string;
}

export type ProjectFileInput = InputNode;

export interface BrowserSessionConfiguration {
    target: {
        browser: 'chrome-android' | null;
        deviceKind: 'emulator' | 'simulator' | 'physical' | null;
    };
    localOrigins: 'reverse' | 'emulator-host' | null;
    permissions: Array<'camera' | 'microphone' | 'geolocation' | 'notifications'>;
    language: string;
    locale: string;
}

export interface DirectorProject {
    readonly format: typeof DIRECTOR_PROJECT_FORMAT;
    readonly version: typeof DIRECTOR_PROJECT_VERSION;
    name: string;
    viewport: {
        readonly width: number;
        readonly height: number;
    };
    output: {
        readonly width: number;
        readonly height: number;
    };
    nodes: DirectorNode[];
    connections: WorkflowConnection[];
    browserSession: BrowserSessionConfiguration;
}

export class ProjectFormat {
    static create(name = 'Untitled project'): DirectorProject {
        return {
            format: DIRECTOR_PROJECT_FORMAT,
            version: DIRECTOR_PROJECT_VERSION,
            name,
            viewport: { width: 360, height: 640 },
            output: { width: 1080, height: 1920 },
            browserSession: {
                target: { browser: null, deviceKind: null },
                localOrigins: null,
                permissions: [],
                language: '',
                locale: '',
            },
            nodes: [
                ProjectFormat.createWebsiteNode(),
                {
                    id: 'layer-1',
                    type: 'layer',
                    name: 'Layer 1',
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
                },
            ],
            connections: [
                { id: 'website-root--layer-1', source: 'website-root', target: 'layer-1' },
            ],
        };
    }

    static parse(source: string): DirectorProject {
        let value: unknown;
        try {
            value = JSON.parse(source);
        } catch (error) {
            throw new TypeError(`Invalid project JSON: ${ProjectFormat.errorMessage(error)}`);
        }
        value = ProjectFormat.migrate(value);
        ProjectFormat.assertProject(value);
        return value;
    }

    static stringify(project: DirectorProject): string {
        ProjectFormat.assertProject(project);
        return `${JSON.stringify(project, null, 4)}\n`;
    }

    static clone(project: DirectorProject): DirectorProject {
        return ProjectFormat.parse(ProjectFormat.stringify(project));
    }

    static createWebsiteNode(url = ''): WebsiteNode {
        return {
            id: 'website-root',
            type: 'website',
            name: 'Website',
            position: null,
            url,
        };
    }

    private static migrate(value: unknown): unknown {
        if (
            !ProjectFormat.isRecord(value) ||
            ![5, 6].includes(value['version'] as number)
        )
            return value;
        const viewport = value['viewport'];
        if (
            !ProjectFormat.isRecord(viewport) ||
            !ProjectFormat.isPositiveNumber(viewport['width']) ||
            !ProjectFormat.isPositiveNumber(viewport['height'])
        ) {
            return value;
        }
        const outputValue =
            value['version'] === 5
                ? { width: viewport['width'], height: viewport['height'] }
                : value['output'];
        if (
            !ProjectFormat.isRecord(outputValue) ||
            !ProjectFormat.isPositiveNumber(outputValue['width']) ||
            !ProjectFormat.isPositiveNumber(outputValue['height'])
        ) {
            return value;
        }
        const output = { width: outputValue['width'], height: outputValue['height'] };
        const browserSession = ProjectFormat.isRecord(value['browserSession'])
            ? value['browserSession']
            : {};
        const cameraInputId =
            typeof browserSession['cameraInputId'] === 'string'
                ? browserSession['cameraInputId']
                : null;
        const { cameraInputId: _legacyCameraInputId, ...session } = browserSession;
        return {
            ...value,
            version: DIRECTOR_PROJECT_VERSION,
            viewport:
                value['version'] === 5
                    ? ProjectFormat.migrateViewport(output, value['browserSession'])
                    : viewport,
            output,
            nodes:
                Array.isArray(value['nodes']) && cameraInputId
                    ? [
                          ...value['nodes'],
                          {
                              id: 'camera-capability',
                              type: 'capability',
                              name: 'Virtual camera',
                              position: null,
                              capability: 'camera',
                          },
                      ]
                    : value['nodes'],
            connections:
                Array.isArray(value['connections']) && cameraInputId
                    ? [
                          ...value['connections'].filter(
                              (connection) =>
                                  !ProjectFormat.isRecord(connection) ||
                                  connection['source'] !== cameraInputId,
                          ),
                          {
                              id: `${cameraInputId}--camera-capability`,
                              source: cameraInputId,
                              target: 'camera-capability',
                          },
                          {
                              id: 'camera-capability--website-root',
                              source: 'camera-capability',
                              target: 'website-root',
                          },
                      ]
                    : value['connections'],
            browserSession: {
                ...session,
                permissions: Array.isArray(session['permissions'])
                    ? session['permissions'].filter(
                          (permission) => permission !== 'camera' || !cameraInputId,
                      )
                    : session['permissions'],
            },
        };
    }

    private static migrateViewport(
        output: { readonly width: number; readonly height: number },
        browserSession: unknown,
    ): { readonly width: number; readonly height: number } {
        const knownSizes = new Map([
            ['1080x1920', { width: 360, height: 640 }],
            ['1536x2048', { width: 768, height: 1024 }],
            ['2048x1536', { width: 1024, height: 768 }],
        ]);
        const known = knownSizes.get(`${output.width}x${output.height}`);
        if (known) return known;
        const mobileLandscape =
            output.width === 1920 &&
            output.height === 1080 &&
            ProjectFormat.isRecord(browserSession) &&
            ProjectFormat.isRecord(browserSession['target']) &&
            browserSession['target']['browser'] === 'chrome-android';
        return mobileLandscape ? { width: 640, height: 360 } : { ...output };
    }

    private static assertProject(value: unknown): asserts value is DirectorProject {
        if (!ProjectFormat.isRecord(value)) throw new TypeError('Project must be an object.');
        if (value['format'] !== DIRECTOR_PROJECT_FORMAT) {
            throw new TypeError(`Unsupported project format: ${String(value['format'])}`);
        }
        if (value['version'] !== DIRECTOR_PROJECT_VERSION) {
            throw new TypeError(`Unsupported project version: ${String(value['version'])}`);
        }
        if (typeof value['name'] !== 'string' || !value['name'].trim()) {
            throw new TypeError('Project name must be a non-empty string.');
        }
        const viewport = value['viewport'];
        if (
            !ProjectFormat.isRecord(viewport) ||
            !ProjectFormat.isPositiveNumber(viewport['width']) ||
            !ProjectFormat.isPositiveNumber(viewport['height'])
        ) {
            throw new TypeError('Project viewport must contain positive width and height values.');
        }
        const output = value['output'];
        if (
            !ProjectFormat.isRecord(output) ||
            !ProjectFormat.isPositiveNumber(output['width']) ||
            !ProjectFormat.isPositiveNumber(output['height'])
        ) {
            throw new TypeError('Project output must contain positive width and height values.');
        }
        if (!Array.isArray(value['nodes']) || value['nodes'].length === 0) {
            throw new TypeError('Project must contain at least one node.');
        }
        const identifiers = new Set<string>();
        let websiteCount = 0;
        for (const node of value['nodes']) {
            ProjectFormat.assertNode(node);
            if (identifiers.has(node.id)) throw new TypeError(`Duplicate node id: ${node.id}`);
            identifiers.add(node.id);
            if (node.type === 'website') websiteCount += 1;
        }
        if (websiteCount !== 1)
            throw new TypeError('Project must contain exactly one website root.');
        if (!Array.isArray(value['connections'])) {
            throw new TypeError('Project must contain workflow connections.');
        }
        for (const connection of value['connections']) {
            if (
                !ProjectFormat.isRecord(connection) ||
                typeof connection['id'] !== 'string' ||
                typeof connection['source'] !== 'string' ||
                typeof connection['target'] !== 'string'
            ) {
                throw new TypeError('Project contains an invalid workflow connection.');
            }
        }
        ProjectFormat.assertBrowserSession(value['browserSession']);
        const project = value as unknown as DirectorProject;
        WorkflowGraph.assertValid(project);
        const websiteId = project.nodes.find((node) => node.type === 'website')!.id;
        const connectedCameras = project.nodes.filter(
            (node) =>
                node.type === 'capability' &&
                node.capability === 'camera' &&
                project.connections.some(
                    (connection) =>
                        connection.source === node.id && connection.target === websiteId,
                ),
        );
        if (connectedCameras.length > 1) {
            throw new TypeError('A project may connect only one virtual camera to its website.');
        }
        const nodes = new Map(value['nodes'].map((node) => [node.id, node]));
        for (const node of value['nodes']) {
            if (node.type !== 'layer' || node.placement.reference.type !== 'layer') continue;
            const parent = nodes.get(node.placement.reference.nodeId);
            if (parent?.type !== 'layer' || parent.id === node.id) {
                throw new TypeError(`Layer node ${node.id} references an invalid parent layer.`);
            }
            const component = WorkflowGraph.componentNodeIds(
                value as unknown as DirectorProject,
                node.id,
            );
            const parentIndex = component.indexOf(parent.id);
            if (parentIndex < 0 || parentIndex >= component.indexOf(node.id)) {
                throw new TypeError(
                    `Layer node ${node.id} must reference a preceding parent layer.`,
                );
            }
        }
    }

    private static assertNode(value: unknown): asserts value is DirectorNode {
        if (!ProjectFormat.isRecord(value)) throw new TypeError('Project node must be an object.');
        if (value['type'] === 'website') {
            ProjectFormat.assertWebsiteNode(value);
            return;
        }
        if (value['type'] === 'input') {
            ProjectFormat.assertInputNode(value);
            return;
        }
        if (value['type'] === 'capability') {
            ProjectFormat.assertCapabilityNode(value);
            return;
        }
        if (value['type'] === 'javascript') {
            ProjectFormat.assertJavaScriptNode(value);
            return;
        }
        if (value['type'] === 'browser-action') {
            ProjectFormat.assertBrowserActionNode(value);
            return;
        }
        if (value['type'] === 'browser-wait') {
            ProjectFormat.assertBrowserWaitNode(value);
            return;
        }
        ProjectFormat.assertLayerNode(value);
    }

    private static assertWebsiteNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & WebsiteNode {
        if (typeof value['id'] !== 'string' || !value['id'].trim()) {
            throw new TypeError('Website node id must be a non-empty string.');
        }
        if (typeof value['name'] !== 'string' || !value['name'].trim()) {
            throw new TypeError(`Website node ${value['id']} must have a name.`);
        }
        if (typeof value['url'] !== 'string') {
            throw new TypeError(`Website node ${value['id']} must contain a URL.`);
        }
        ProjectFormat.assertPosition(value, 'Website');
    }

    private static assertInputNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & InputNode {
        ProjectFormat.assertCommonExecutable(value, 'Input');
        if (
            typeof value['accept'] !== 'string' ||
            typeof value['required'] !== 'boolean' ||
            (value['prepare'] !== undefined &&
                (!ProjectFormat.isRecord(value['prepare']) ||
                    !Array.isArray(value['prepare']['modules']) ||
                    value['prepare']['modules'].length === 0 ||
                    value['prepare']['modules'].some(
                        (module) =>
                            typeof module !== 'string' || !/^projects\/.+\.mjs$/u.test(module),
                    ))) ||
            (value['file'] !== undefined && !ProjectFormat.isInputFileReference(value['file']))
        ) {
            throw new TypeError(`Input node ${value['id']} contains invalid settings.`);
        }
    }

    private static assertCapabilityNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & CapabilityNode {
        ProjectFormat.assertCommonExecutable(value, 'Capability');
        if (value['capability'] !== 'camera') {
            throw new TypeError(`Capability node ${value['id']} contains an invalid capability.`);
        }
    }

    private static assertLayerNode(value: unknown): asserts value is LayerNode {
        if (!ProjectFormat.isRecord(value) || value['type'] !== 'layer') {
            throw new TypeError('Only known node types are supported by this project version.');
        }
        if (typeof value['id'] !== 'string' || !value['id'].trim()) {
            throw new TypeError('Layer node id must be a non-empty string.');
        }
        if (typeof value['name'] !== 'string' || !value['name'].trim()) {
            throw new TypeError(`Layer node ${value['id']} must have a name.`);
        }
        ProjectFormat.assertPosition(value, 'Layer');
        const source = value['source'];
        if (
            !ProjectFormat.isRecord(source) ||
            typeof source['html'] !== 'string' ||
            typeof source['css'] !== 'string' ||
            typeof source['javascript'] !== 'string'
        ) {
            throw new TypeError(`Layer node ${value['id']} must contain HTML, CSS and JavaScript.`);
        }
        const placement = value['placement'];
        if (!ProjectFormat.isRecord(placement)) {
            throw new TypeError(`Layer node ${value['id']} must contain a placement.`);
        }
        const reference = placement['reference'];
        const validReference =
            ProjectFormat.isRecord(reference) &&
            (reference['type'] === 'viewport' ||
                (reference['type'] === 'layer' &&
                    typeof reference['nodeId'] === 'string' &&
                    Boolean(reference['nodeId'].trim())) ||
                (reference['type'] === 'dom' &&
                    typeof reference['selector'] === 'string' &&
                    Boolean(reference['selector'].trim())));
        const validPlacement =
            validReference &&
            ['left', 'center', 'right'].includes(String(placement['horizontal'])) &&
            ['top', 'center', 'bottom'].includes(String(placement['vertical']));
        if (!validPlacement) {
            throw new TypeError(`Layer node ${value['id']} contains an invalid placement.`);
        }
        ProjectFormat.assertLayerPlayback(value);
    }

    private static isInputFileReference(value: unknown): value is InputFileReference {
        return (
            ProjectFormat.isRecord(value) &&
            typeof value['asset'] === 'string' &&
            /^[a-f0-9]{64}\/[A-Za-z0-9%._~-]+$/u.test(value['asset']) &&
            typeof value['name'] === 'string' &&
            Boolean(value['name']) &&
            typeof value['type'] === 'string' &&
            Number.isInteger(value['size']) &&
            Number(value['size']) >= 0 &&
            typeof value['sha256'] === 'string' &&
            /^[a-f0-9]{64}$/u.test(value['sha256'])
        );
    }

    private static assertLayerPlayback(value: Record<string, unknown>): void {
        const playback = value['playback'];
        if (
            !ProjectFormat.isRecord(playback) ||
            typeof playback['durationMs'] !== 'number' ||
            !Number.isFinite(playback['durationMs']) ||
            playback['durationMs'] < 0 ||
            typeof playback['removeAfter'] !== 'boolean'
        ) {
            throw new TypeError(`Layer node ${value['id']} contains invalid playback settings.`);
        }
    }

    private static assertJavaScriptNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & JavaScriptNode {
        if (typeof value['id'] !== 'string' || !value['id'].trim()) {
            throw new TypeError('JavaScript node id must be a non-empty string.');
        }
        if (typeof value['name'] !== 'string' || !value['name'].trim()) {
            throw new TypeError(`JavaScript node ${String(value['id'])} must have a name.`);
        }
        if (typeof value['source'] !== 'string') {
            throw new TypeError(`JavaScript node ${value['id']} must contain JavaScript source.`);
        }
        ProjectFormat.assertPosition(value, 'JavaScript');
    }

    private static assertBrowserActionNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & BrowserActionNode {
        ProjectFormat.assertCommonExecutable(value, 'Browser action');
        if (value['action'] !== 'click') {
            throw new TypeError(`Browser action node ${value['id']} contains an invalid action.`);
        }
        ProjectFormat.assertSelector(value, 'Browser action');
    }

    private static assertBrowserWaitNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & BrowserWaitNode {
        ProjectFormat.assertCommonExecutable(value, 'Browser wait');
        if (!['element', 'url', 'script'].includes(String(value['condition']))) {
            throw new TypeError(`Browser wait node ${value['id']} contains an invalid condition.`);
        }
        if (typeof value['selector'] !== 'string') {
            throw new TypeError(`Browser wait node ${value['id']} must contain a selector.`);
        }
        if (typeof value['value'] !== 'string') {
            throw new TypeError(`Browser wait node ${value['id']} must contain a URL value.`);
        }
        if (typeof value['script'] !== 'string') {
            throw new TypeError(`Browser wait node ${value['id']} must contain a script.`);
        }
        if (value['condition'] === 'element') ProjectFormat.assertSelector(value, 'Browser wait');
        if (value['condition'] === 'url' && !value['value'].trim()) {
            throw new TypeError(`Browser wait node ${value['id']} must have a URL value.`);
        }
        if (value['condition'] === 'script' && !value['script'].trim()) {
            throw new TypeError(`Browser wait node ${value['id']} must have a script.`);
        }
        if (!ProjectFormat.isPositiveNumber(value['timeoutMs'])) {
            throw new TypeError(`Browser wait node ${value['id']} must have a positive timeout.`);
        }
        if (typeof value['omitFromRecording'] !== 'boolean') {
            throw new TypeError(
                `Browser wait node ${value['id']} must define its recording behavior.`,
            );
        }
    }

    private static assertCommonExecutable(value: Record<string, unknown>, type: string): void {
        if (typeof value['id'] !== 'string' || !value['id'].trim()) {
            throw new TypeError(`${type} node id must be a non-empty string.`);
        }
        if (typeof value['name'] !== 'string' || !value['name'].trim()) {
            throw new TypeError(`${type} node ${String(value['id'])} must have a name.`);
        }
        ProjectFormat.assertPosition(value, type);
    }

    private static assertSelector(value: Record<string, unknown>, type: string): void {
        if (typeof value['selector'] !== 'string' || !value['selector'].trim()) {
            throw new TypeError(`${type} node ${value['id']} must have a selector.`);
        }
    }

    private static assertPosition(value: Record<string, unknown>, type: string): void {
        const position = value['position'];
        if (position === null) return;
        if (
            !ProjectFormat.isRecord(position) ||
            typeof position['x'] !== 'number' ||
            typeof position['y'] !== 'number'
        ) {
            throw new TypeError(
                `${type} node ${String(value['id'])} must have a numeric position or null.`,
            );
        }
    }

    private static assertBrowserSession(
        value: unknown,
    ): asserts value is BrowserSessionConfiguration {
        if (!ProjectFormat.isRecord(value) || !ProjectFormat.isRecord(value['target'])) {
            throw new TypeError('Project must contain Browser Testbench session settings.');
        }
        const target = value['target'];
        if (
            ![null, 'chrome-android'].includes(target['browser'] as null | string) ||
            ![null, 'emulator', 'simulator', 'physical'].includes(
                target['deviceKind'] as null | string,
            ) ||
            ![null, 'reverse', 'emulator-host'].includes(value['localOrigins'] as null | string) ||
            !Array.isArray(value['permissions']) ||
            value['permissions'].some(
                (permission) =>
                    !['camera', 'microphone', 'geolocation', 'notifications'].includes(
                        String(permission),
                    ),
            ) ||
            typeof value['language'] !== 'string' ||
            typeof value['locale'] !== 'string'
        ) {
            throw new TypeError('Project contains invalid Browser Testbench session settings.');
        }
    }

    private static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private static isPositiveNumber(value: unknown): value is number {
        return typeof value === 'number' && Number.isFinite(value) && value > 0;
    }

    private static errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

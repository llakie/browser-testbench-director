import { WorkflowGraph } from './workflow-graph.js';
import { PREVIEW_PRESET_IDS, type PreviewPresetId } from './media-presets.js';
import { TextLayerSource, type TextLayerSettings } from './text-layer-source.js';

export const DIRECTOR_PROJECT_FORMAT = 'browser-testbench-director' as const;
export const DIRECTOR_PROJECT_VERSION = 15 as const;

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
    offsetXPercent?: number;
    offsetYPercent?: number;
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
    text?: TextLayerSettings;
    fontInputId?: string;
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

export interface MergeNode {
    readonly id: string;
    readonly type: 'merge';
    name: string;
    position: Point | null;
    waitFor: 'all' | 'any';
}

export interface AudioNode {
    readonly id: string;
    readonly type: 'audio';
    name: string;
    position: Point | null;
    volume: number;
    envelope: AudioEnvelopePoint[];
    waitForEnd: boolean;
    loop?: boolean;
}

export interface AudioEnvelopePoint {
    readonly time: number;
    readonly gain: number;
}

export interface VideoOutputNode {
    readonly id: string;
    readonly type: 'video-output';
    name: string;
    position: Point | null;
    targetId: string;
    filename: string;
}

export interface InputFileReference {
    readonly asset: string;
    readonly name: string;
    readonly type: string;
    readonly size: number;
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
    selector: string;
}

interface BrowserWaitNodeBase {
    readonly id: string;
    readonly type: 'browser-wait';
    name: string;
    position: Point | null;
    timeoutMs: number;
    omitFromRecording: boolean;
}

export type BrowserWaitNode =
    | (BrowserWaitNodeBase & { condition: 'element'; selector: string })
    | (BrowserWaitNodeBase & { condition: 'url'; value: string })
    | (BrowserWaitNodeBase & { condition: 'script'; script: string });

export type ExecutableNode =
    LayerNode | JavaScriptNode | BrowserActionNode | BrowserWaitNode | MergeNode | AudioNode;
export type DirectorNode =
    InputNode | CapabilityNode | WebsiteNode | VideoOutputNode | ExecutableNode;

export interface WorkflowConnection {
    readonly id: string;
    readonly source: string;
    readonly target: string;
}

export type ProjectFileInput = InputNode;

export const BROWSER_PERMISSIONS = [
    'camera',
    'microphone',
    'geolocation',
    'notifications',
] as const;
export type BrowserPermission = (typeof BROWSER_PERMISSIONS)[number];

export interface BrowserSessionConfiguration {
    permissions: BrowserPermission[];
    language: string;
    locale: string;
}

export interface DirectorProject {
    readonly format: typeof DIRECTOR_PROJECT_FORMAT;
    readonly version: typeof DIRECTOR_PROJECT_VERSION;
    name: string;
    preview: {
        preset: PreviewPresetId;
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
            preview: { preset: 'phone-portrait' },
            browserSession: {
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

        ProjectFormat.assertProject(value);
        ProjectFormat.refreshTextSources(value);
        return value;
    }

    static stringify(project: DirectorProject): string {
        ProjectFormat.assertProject(project);
        ProjectFormat.refreshTextSources(project);
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

    private static assertProject(value: unknown): asserts value is DirectorProject {
        if (!ProjectFormat.isRecord(value)) {
            throw new TypeError('Project must be an object.');
        }

        if (value['format'] !== DIRECTOR_PROJECT_FORMAT) {
            throw new TypeError(`Unsupported project format: ${String(value['format'])}`);
        }

        if (value['version'] !== DIRECTOR_PROJECT_VERSION) {
            throw new TypeError(`Unsupported project version: ${String(value['version'])}`);
        }

        if (typeof value['name'] !== 'string' || !value['name'].trim()) {
            throw new TypeError('Project name must be a non-empty string.');
        }

        ProjectFormat.assertOnlyKeys(
            value,
            ['format', 'version', 'name', 'preview', 'nodes', 'connections', 'browserSession'],
            'Project',
        );
        const preview = value['preview'];

        if (
            !ProjectFormat.isRecord(preview) ||
            !PREVIEW_PRESET_IDS.includes(preview['preset'] as PreviewPresetId)
        ) {
            throw new TypeError('Project preview must reference a known preset.');
        }

        ProjectFormat.assertOnlyKeys(preview, ['preset'], 'Project preview');

        if (!Array.isArray(value['nodes']) || value['nodes'].length === 0) {
            throw new TypeError('Project must contain at least one node.');
        }

        const identifiers = new Set<string>();
        let websiteCount = 0;

        for (const node of value['nodes']) {
            ProjectFormat.assertNode(node);

            if (identifiers.has(node.id)) {
                throw new TypeError(`Duplicate node id: ${node.id}`);
            }

            identifiers.add(node.id);

            if (node.type === 'website') {
                websiteCount += 1;
            }
        }

        if (websiteCount !== 1) {
            throw new TypeError('Project must contain exactly one website root.');
        }

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

            ProjectFormat.assertOnlyKeys(connection, ['id', 'source', 'target'], 'Connection');
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
            if (node.type !== 'layer' || node.placement.reference.type !== 'layer') {
                continue;
            }

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

        for (const node of value['nodes']) {
            if (node.type !== 'layer') {
                continue;
            }

            const fontInputId =
                node.fontInputId ?? (node.text?.font === 'project' ? node.text.fontInputId : '');

            if (!fontInputId) {
                continue;
            }

            const font = nodes.get(fontInputId);

            if (font?.type !== 'input' || !font.accept.includes('font/')) {
                throw new TypeError(`Text layer ${node.id} references an invalid font input.`);
            }
        }
    }

    private static refreshTextSources(project: DirectorProject): void {
        for (const node of project.nodes) {
            if (node.type === 'layer' && node.text) {
                node.source = TextLayerSource.render(node.text, node.id);
            }
        }
    }

    private static assertNode(value: unknown): asserts value is DirectorNode {
        if (!ProjectFormat.isRecord(value)) {
            throw new TypeError('Project node must be an object.');
        }

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

        if (value['type'] === 'merge') {
            ProjectFormat.assertMergeNode(value);
            return;
        }

        if (value['type'] === 'audio') {
            ProjectFormat.assertAudioNode(value);
            return;
        }

        if (value['type'] === 'video-output') {
            ProjectFormat.assertVideoOutputNode(value);
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

    private static assertVideoOutputNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & VideoOutputNode {
        ProjectFormat.assertCommonExecutable(value, 'Video output');

        if (
            typeof value['targetId'] !== 'string' ||
            typeof value['filename'] !== 'string' ||
            !/^[^\\/]+\.mp4$/iu.test(value['filename'])
        ) {
            throw new TypeError(`Video output node ${value['id']} contains invalid settings.`);
        }

        ProjectFormat.assertOnlyKeys(
            value,
            ['id', 'type', 'name', 'position', 'targetId', 'filename'],
            'Video output node',
        );
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
        ProjectFormat.assertOnlyKeys(
            value,
            ['id', 'type', 'name', 'position', 'url'],
            'Website node',
        );
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

        if (ProjectFormat.isRecord(value['prepare'])) {
            ProjectFormat.assertOnlyKeys(value['prepare'], ['modules'], 'Input preparation');
        }

        ProjectFormat.assertOnlyKeys(
            value,
            ['id', 'type', 'name', 'position', 'accept', 'required', 'file', 'prepare'],
            'Input node',
        );
    }

    private static assertCapabilityNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & CapabilityNode {
        ProjectFormat.assertCommonExecutable(value, 'Capability');

        if (value['capability'] !== 'camera') {
            throw new TypeError(`Capability node ${value['id']} contains an invalid capability.`);
        }

        ProjectFormat.assertOnlyKeys(
            value,
            ['id', 'type', 'name', 'position', 'capability'],
            'Capability node',
        );
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

        ProjectFormat.assertOnlyKeys(source, ['html', 'css', 'javascript'], 'Layer source');
        const placement = value['placement'];

        if (!ProjectFormat.isRecord(placement)) {
            throw new TypeError(`Layer node ${value['id']} must contain a placement.`);
        }

        const reference = placement['reference'];
        const referenceType = ProjectFormat.isRecord(reference) ? reference['type'] : undefined;
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
            ['top', 'center', 'bottom'].includes(String(placement['vertical'])) &&
            ['offsetXPercent', 'offsetYPercent'].every(
                (key) =>
                    placement[key] === undefined ||
                    (typeof placement[key] === 'number' &&
                        Number.isFinite(placement[key]) &&
                        Number(placement[key]) >= -100 &&
                        Number(placement[key]) <= 100),
            );

        if (!validPlacement) {
            throw new TypeError(`Layer node ${value['id']} contains an invalid placement.`);
        }

        ProjectFormat.assertOnlyKeys(
            placement,
            ['reference', 'horizontal', 'vertical', 'offsetXPercent', 'offsetYPercent'],
            'Layer placement',
        );
        ProjectFormat.assertOnlyKeys(
            reference as Record<string, unknown>,
            referenceType === 'layer'
                ? ['type', 'nodeId']
                : referenceType === 'dom'
                  ? ['type', 'selector']
                  : ['type'],
            'Layer placement reference',
        );
        ProjectFormat.assertLayerPlayback(value);

        if (value['text'] !== undefined && !TextLayerSource.validate(value['text'])) {
            throw new TypeError(`Layer node ${value['id']} contains invalid text settings.`);
        }

        if (value['fontInputId'] !== undefined && typeof value['fontInputId'] !== 'string') {
            throw new TypeError(`Layer node ${value['id']} contains an invalid font input.`);
        }

        ProjectFormat.assertOnlyKeys(
            value,
            [
                'id',
                'type',
                'name',
                'position',
                'placement',
                'playback',
                'source',
                'text',
                'fontInputId',
            ],
            'Layer node',
        );
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
            ProjectFormat.hasOnlyKeys(value, ['asset', 'name', 'type', 'size'])
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

        ProjectFormat.assertOnlyKeys(playback, ['durationMs', 'removeAfter'], 'Layer playback');
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
        ProjectFormat.assertOnlyKeys(
            value,
            ['id', 'type', 'name', 'position', 'source'],
            'JavaScript node',
        );
    }

    private static assertMergeNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & MergeNode {
        ProjectFormat.assertCommonExecutable(value, 'Merge');

        if (!['all', 'any'].includes(String(value['waitFor']))) {
            throw new TypeError(`Merge node ${value['id']} contains an invalid wait strategy.`);
        }

        ProjectFormat.assertOnlyKeys(
            value,
            ['id', 'type', 'name', 'position', 'waitFor'],
            'Merge node',
        );
    }

    private static assertAudioNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & AudioNode {
        ProjectFormat.assertCommonExecutable(value, 'Audio');

        if (
            typeof value['volume'] !== 'number' ||
            !Number.isFinite(value['volume']) ||
            value['volume'] < 0 ||
            value['volume'] > 1 ||
            typeof value['waitForEnd'] !== 'boolean'
        ) {
            throw new TypeError(`Audio node ${value['id']} contains invalid playback settings.`);
        }

        if (value['loop'] !== undefined && typeof value['loop'] !== 'boolean') {
            throw new TypeError(`Audio node ${value['id']} contains an invalid loop setting.`);
        }

        if (!Array.isArray(value['envelope']) || value['envelope'].length < 2) {
            throw new TypeError(`Audio node ${value['id']} must contain an envelope.`);
        }

        for (const [index, point] of value['envelope'].entries()) {
            if (
                !ProjectFormat.isRecord(point) ||
                typeof point['time'] !== 'number' ||
                !Number.isFinite(point['time']) ||
                point['time'] < 0 ||
                point['time'] > 1 ||
                typeof point['gain'] !== 'number' ||
                !Number.isFinite(point['gain']) ||
                point['gain'] < 0 ||
                point['gain'] > 1 ||
                (index > 0 && point['time'] <= value['envelope'][index - 1]['time'])
            ) {
                throw new TypeError(`Audio node ${value['id']} contains an invalid envelope.`);
            }

            ProjectFormat.assertOnlyKeys(point, ['time', 'gain'], 'Audio envelope point');
        }

        if (value['envelope'][0]['time'] !== 0 || value['envelope'].at(-1)?.['time'] !== 1) {
            throw new TypeError(`Audio node ${value['id']} envelope must span the whole file.`);
        }

        ProjectFormat.assertOnlyKeys(
            value,
            ['id', 'type', 'name', 'position', 'volume', 'envelope', 'waitForEnd', 'loop'],
            'Audio node',
        );
    }

    private static assertBrowserActionNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & BrowserActionNode {
        ProjectFormat.assertCommonExecutable(value, 'Browser action');
        ProjectFormat.assertSelector(value, 'Browser action');
        ProjectFormat.assertOnlyKeys(
            value,
            ['id', 'type', 'name', 'position', 'selector'],
            'Browser action node',
        );
    }

    private static assertBrowserWaitNode(
        value: Record<string, unknown>,
    ): asserts value is Record<string, unknown> & BrowserWaitNode {
        ProjectFormat.assertCommonExecutable(value, 'Browser wait');

        if (!['element', 'url', 'script'].includes(String(value['condition']))) {
            throw new TypeError(`Browser wait node ${value['id']} contains an invalid condition.`);
        }

        if (value['condition'] === 'element') {
            ProjectFormat.assertSelector(value, 'Browser wait');
        }

        if (
            value['condition'] === 'url' &&
            (typeof value['value'] !== 'string' || !value['value'].trim())
        ) {
            throw new TypeError(`Browser wait node ${value['id']} must have a URL value.`);
        }

        if (
            value['condition'] === 'script' &&
            (typeof value['script'] !== 'string' || !value['script'].trim())
        ) {
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

        const conditionKey =
            value['condition'] === 'element'
                ? 'selector'
                : value['condition'] === 'url'
                  ? 'value'
                  : 'script';
        ProjectFormat.assertOnlyKeys(
            value,
            [
                'id',
                'type',
                'name',
                'position',
                'condition',
                conditionKey,
                'timeoutMs',
                'omitFromRecording',
            ],
            'Browser wait node',
        );
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

        if (position === null) {
            return;
        }

        if (
            !ProjectFormat.isRecord(position) ||
            typeof position['x'] !== 'number' ||
            typeof position['y'] !== 'number'
        ) {
            throw new TypeError(
                `${type} node ${String(value['id'])} must have a numeric position or null.`,
            );
        }

        ProjectFormat.assertOnlyKeys(position, ['x', 'y'], `${type} node position`);
    }

    private static assertBrowserSession(
        value: unknown,
    ): asserts value is BrowserSessionConfiguration {
        if (!ProjectFormat.isRecord(value)) {
            throw new TypeError('Project must contain Browser Testbench session settings.');
        }

        if (
            !Array.isArray(value['permissions']) ||
            value['permissions'].some(
                (permission) => !BROWSER_PERMISSIONS.includes(permission as BrowserPermission),
            ) ||
            typeof value['language'] !== 'string' ||
            typeof value['locale'] !== 'string'
        ) {
            throw new TypeError('Project contains invalid Browser Testbench session settings.');
        }

        ProjectFormat.assertOnlyKeys(
            value,
            ['permissions', 'language', 'locale'],
            'Browser session',
        );
    }

    private static assertOnlyKeys(
        value: Record<string, unknown>,
        keys: readonly string[],
        type: string,
    ): void {
        const unexpected = Object.keys(value).find((key) => !keys.includes(key));

        if (unexpected) {
            throw new TypeError(`${type} contains an unknown property: ${unexpected}`);
        }
    }

    private static hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
        return Object.keys(value).every((key) => keys.includes(key));
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

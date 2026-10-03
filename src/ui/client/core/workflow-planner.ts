import type { DirectorProject, ExecutableNode, InputNode, WebsiteNode } from './project-format.js';
import { WorkflowGraph } from './workflow-graph.js';

export type PlaybackMode = 'root' | 'node' | 'prepare' | 'current' | 'workflow';
export type PlaybackSpeed = 'catchup' | 'live';

export interface WorkflowStep {
    readonly node: ExecutableNode;
    readonly speed: PlaybackSpeed;
    readonly after: readonly string[];
    readonly inputId?: string;
}

export interface WorkflowPlan {
    readonly mode: PlaybackMode;
    readonly website: WebsiteNode | null;
    readonly inputs: readonly InputNode[];
    readonly cameraInputId: string | null;
    readonly globalStylesheetInputIds: readonly string[];
    readonly resetWebsite: boolean;
    readonly steps: readonly WorkflowStep[];
}

export class WorkflowPlanner {
    static plan(project: DirectorProject, mode: PlaybackMode, nodeId?: string): WorkflowPlan {
        const website = project.nodes.find((node) => node.type === 'website') ?? null;
        const connected = WorkflowGraph.connectedNodeIds(project);
        const inputIds = new Set(
            project.nodes
                .filter((node) => node.type === 'input' && connected.has(node.id))
                .map((node) => node.id),
        );
        const inputs = project.nodes.filter(
            (node): node is InputNode => node.type === 'input' && inputIds.has(node.id),
        );
        const globalStylesheetInputIds = inputs
            .filter(
                (input) =>
                    input.accept.split(',').some((type) => type.trim() === 'text/css') &&
                    project.connections.some(
                        (connection) =>
                            connection.source === input.id && connection.target === website?.id,
                    ),
            )
            .map((input) => input.id);
        const cameraCapability = project.nodes.find(
            (node) =>
                node.type === 'capability' &&
                node.capability === 'camera' &&
                project.connections.some(
                    (connection) =>
                        connection.source === node.id && connection.target === website?.id,
                ),
        );
        const cameraInputId =
            project.connections.find((connection) => connection.target === cameraCapability?.id)
                ?.source ?? null;
        const nodes = new Map(project.nodes.map((node) => [node.id, node]));
        const orderedIds = WorkflowGraph.orderedNodeIds(project);
        const executable = orderedIds
            .map((id) => nodes.get(id))
            .filter(WorkflowPlanner.isExecutableNode);

        if (mode === 'root') {
            return {
                mode,
                website,
                inputs: [],
                cameraInputId: null,
                globalStylesheetInputIds: [],
                resetWebsite: true,
                steps: [],
            };
        }

        if (mode === 'workflow') {
            const executableIds = new Set(executable.map((node) => node.id));
            return {
                mode,
                website,
                inputs,
                cameraInputId,
                globalStylesheetInputIds,
                resetWebsite: true,
                steps: executable.map((node) =>
                    WorkflowPlanner.step(project, node, 'live', executableIds),
                ),
            };
        }

        const selected = project.nodes.find(
            (node): node is ExecutableNode =>
                node.id === nodeId && WorkflowPlanner.isExecutableNode(node),
        );

        if (!selected) {
            throw new TypeError(`Executable node not found: ${String(nodeId)}`);
        }

        if (mode === 'current') {
            const currentNode =
                selected.type === 'audio'
                    ? { ...selected, waitForEnd: true, loop: false }
                    : selected;
            const step = WorkflowPlanner.step(project, currentNode, 'live', new Set());
            const selectedInputIds = new Set(
                [
                    step.inputId,
                    selected.type === 'layer'
                        ? (selected.fontInputId ??
                          (selected.text?.font === 'project'
                              ? selected.text.fontInputId
                              : undefined))
                        : undefined,
                ].filter((id): id is string => Boolean(id)),
            );
            const selectedInputs = inputs.filter(
                (input) =>
                    selectedInputIds.has(input.id) || globalStylesheetInputIds.includes(input.id),
            );
            return {
                mode,
                website,
                inputs: selectedInputs,
                cameraInputId: null,
                globalStylesheetInputIds,
                resetWebsite: false,
                steps: [step],
            };
        }

        const predecessors = WorkflowGraph.componentNodeIds(project, selected.id)
            .map((id) => nodes.get(id))
            .filter(WorkflowPlanner.isExecutableNode);
        const included = new Set(predecessors.map((node) => node.id));
        const sideEffects =
            mode === 'node'
                ? WorkflowPlanner.sideEffectAudioIds(project, executable, included)
                : new Set<string>();

        for (const id of sideEffects) {
            included.add(id);
        }

        const plannedNodes = executable.filter((node) => included.has(node.id));

        return {
            mode,
            website,
            inputs,
            cameraInputId,
            globalStylesheetInputIds,
            resetWebsite: true,
            steps: plannedNodes.map((node) =>
                WorkflowPlanner.step(
                    project,
                    sideEffects.has(node.id) && node.type === 'audio'
                        ? { ...node, waitForEnd: false }
                        : node,
                    mode === 'prepare' && node.id !== selected.id ? 'catchup' : 'live',
                    included,
                ),
            ),
        };
    }

    private static sideEffectAudioIds(
        project: DirectorProject,
        executable: readonly ExecutableNode[],
        included: ReadonlySet<string>,
    ): Set<string> {
        const sideEffects = new Set<string>();
        let changed = true;

        while (changed) {
            changed = false;

            for (const node of executable) {
                if (node.type !== 'audio' || included.has(node.id) || sideEffects.has(node.id)) {
                    continue;
                }

                const launchedByPlan = WorkflowGraph.predecessorIds(project, node.id).some(
                    (id) => included.has(id) || sideEffects.has(id),
                );

                if (launchedByPlan) {
                    sideEffects.add(node.id);
                    changed = true;
                }
            }
        }

        return sideEffects;
    }

    private static step(
        project: DirectorProject,
        node: ExecutableNode,
        speed: PlaybackSpeed,
        included: ReadonlySet<string>,
    ): WorkflowStep {
        const inputId =
            node.type === 'audio'
                ? project.connections.find(
                      (connection) =>
                          connection.target === node.id &&
                          project.nodes.some(
                              (candidate) =>
                                  candidate.id === connection.source && candidate.type === 'input',
                          ),
                  )?.source
                : undefined;
        return {
            node,
            speed,
            after: WorkflowGraph.predecessorIds(project, node.id).filter((id) => included.has(id)),
            ...(inputId ? { inputId } : {}),
        };
    }

    private static isExecutableNode(node: unknown): node is ExecutableNode {
        return Boolean(
            node &&
            typeof node === 'object' &&
            'type' in node &&
            ['layer', 'javascript', 'browser-action', 'browser-wait', 'merge', 'audio'].includes(
                String(node.type),
            ),
        );
    }
}

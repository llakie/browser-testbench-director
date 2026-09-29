import type { DirectorProject, ExecutableNode, InputNode, WebsiteNode } from './project-format.js';
import { WorkflowGraph } from './workflow-graph.js';

export type PlaybackMode = 'root' | 'node' | 'current' | 'workflow';
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
            const step = WorkflowPlanner.step(project, selected, 'live', new Set());
            const selectedInputs = step.inputId
                ? inputs.filter((input) => input.id === step.inputId)
                : [];
            return {
                mode,
                website,
                inputs: selectedInputs,
                cameraInputId: null,
                resetWebsite: false,
                steps: [step],
            };
        }

        const component = WorkflowGraph.componentNodeIds(project, selected.id)
            .map((id) => nodes.get(id))
            .filter(WorkflowPlanner.isExecutableNode);
        const selectedIndex = component.findIndex((node) => node.id === selected.id);
        const included = new Set(component.slice(0, selectedIndex + 1).map((node) => node.id));

        return {
            mode,
            website,
            inputs,
            cameraInputId,
            resetWebsite: true,
            steps: component
                .slice(0, selectedIndex + 1)
                .map((node, index) =>
                    WorkflowPlanner.step(
                        project,
                        node,
                        index < selectedIndex ? 'catchup' : 'live',
                        included,
                    ),
                ),
        };
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

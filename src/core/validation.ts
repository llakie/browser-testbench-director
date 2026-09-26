import { isRunNode, isWaitNode } from './nodes.js';
import type { RunNode, TimelineDefinition, TimelineGraph } from './types.js';

export interface RunValidation {
    readonly hasOpenClip: boolean;
    readonly duration: number;
    readonly hasDuration: boolean;
}

export function validateGraph(graph: TimelineGraph): Readonly<{
    byId: ReadonlyMap<string, TimelineDefinition>;
}> {
    if (!graph || graph.type !== 'graph' || !Array.isArray(graph.timelines)) {
        throw new TypeError('Ein gültiger Timeline-Graph wird benötigt.');
    }
    if (graph.timelines.length === 0) throw new Error('Der Timeline-Graph ist leer.');

    const byId = new Map<string, TimelineDefinition>();
    for (const entry of graph.timelines) {
        if (!entry || entry.type !== 'timeline')
            throw new TypeError('Der Graph enthält keine Timeline.');
        if (byId.has(entry.id)) throw new Error(`Timeline-ID mehrfach vergeben: ${entry.id}`);
        if (!isWaitNode(entry.trigger)) throw new Error(`Ungültiger Trigger: ${entry.id}`);
        if (typeof entry.run !== 'function' && !isRunNode(entry.run)) {
            throw new Error(`Ungültiger Ablauf: ${entry.id}`);
        }
        byId.set(entry.id, entry);
    }

    for (const entry of graph.timelines) {
        for (const predecessor of entry.after) {
            if (!byId.has(predecessor)) {
                throw new Error(
                    `Timeline "${entry.id}" referenziert unbekannten Vorgänger "${predecessor}".`,
                );
            }
            if (predecessor === entry.id)
                throw new Error(`Timeline "${entry.id}" kann nicht von sich selbst abhängen.`);
        }
    }

    assertAcyclic(graph.timelines, byId);
    assertLayerOrdering(graph.timelines, byId);
    return Object.freeze({ byId });
}

export function validateRunNode(node: RunNode, owner = 'run'): RunValidation {
    if (!isRunNode(node)) throw new TypeError(`${owner} ist kein gültiger Ablaufknoten.`);
    if (node.type === 'sequence' || node.type === 'parallel') {
        for (const child of node.entries) validateRunNode(child, owner);
    }
    if (node.type === 'clip' && node.duration === undefined) {
        return { hasOpenClip: true, duration: 0, hasDuration: false };
    }
    if (node.type === 'delay' || node.type === 'hold' || node.type === 'clip') {
        const duration = node.duration ?? 0;
        return { hasOpenClip: false, duration, hasDuration: duration > 0 };
    }
    if (node.type === 'sequence') {
        const children = node.entries.map((child) => validateRunNode(child, owner));
        return {
            hasOpenClip: children.some((child) => child.hasOpenClip),
            duration: children.reduce((sum, child) => sum + child.duration, 0),
            hasDuration: children.some((child) => child.hasDuration),
        };
    }
    if (node.type === 'parallel') {
        const children = node.entries.map((child) => validateRunNode(child, owner));
        return {
            hasOpenClip: children.some((child) => child.hasOpenClip),
            duration: Math.max(0, ...children.map((child) => child.duration)),
            hasDuration: children.some((child) => child.hasDuration),
        };
    }
    return { hasOpenClip: false, duration: 0, hasDuration: false };
}

function assertAcyclic(
    timelines: readonly TimelineDefinition[],
    byId: ReadonlyMap<string, TimelineDefinition>,
): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
        if (visiting.has(id)) throw new Error(`Zyklus im Timeline-Graph bei "${id}".`);
        if (visited.has(id)) return;
        visiting.add(id);
        for (const predecessor of byId.get(id)?.after ?? []) visit(predecessor);
        visiting.delete(id);
        visited.add(id);
    };
    for (const entry of timelines) visit(entry.id);
}

function assertLayerOrdering(
    timelines: readonly TimelineDefinition[],
    byId: ReadonlyMap<string, TimelineDefinition>,
): void {
    const ancestors = new Map<string, Set<string>>();
    const collect = (id: string): Set<string> => {
        if (ancestors.has(id)) return ancestors.get(id)!;
        const result = new Set<string>();
        for (const predecessor of byId.get(id)?.after ?? []) {
            result.add(predecessor);
            for (const ancestor of collect(predecessor)) result.add(ancestor);
        }
        ancestors.set(id, result);
        return result;
    };
    for (const entry of timelines) collect(entry.id);

    for (let firstIndex = 0; firstIndex < timelines.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < timelines.length; secondIndex++) {
            const first = timelines[firstIndex];
            const second = timelines[secondIndex];
            if (first.layer !== second.layer) continue;
            if (
                !ancestors.get(first.id)?.has(second.id) &&
                !ancestors.get(second.id)?.has(first.id)
            ) {
                throw new Error(
                    `Timelines "${first.id}" und "${second.id}" können Layer "${first.layer}" gleichzeitig belegen.`,
                );
            }
        }
    }
}

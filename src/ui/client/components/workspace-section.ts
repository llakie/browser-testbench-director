import { defineComponent, type Component } from 'vue';

import { TemplateRegistry } from '../core/template-registry.js';

type WorkspaceViewModel = Record<string, unknown>;

interface WorkspaceSectionOptions {
    readonly name: string;
    readonly template: string;
    readonly bindings: readonly string[];
    readonly components?: Readonly<Record<string, Component>>;
}

export function defineWorkspaceSection(options: WorkspaceSectionOptions): Component {
    const computed = Object.fromEntries(
        options.bindings.map((binding) => [
            binding,
            {
                get(this: { workspace: WorkspaceViewModel }): unknown {
                    return this.workspace[binding];
                },
                set(this: { workspace: WorkspaceViewModel }, value: unknown): void {
                    this.workspace[binding] = value;
                },
            },
        ]),
    );

    const component = defineComponent({
        name: options.name,
        props: {
            workspace: {
                type: Object,
                required: true,
            },
        },
        components: options.components,
        computed,
    });
    TemplateRegistry.attach(component, options.template);
    return component;
}

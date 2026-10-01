import type { Component } from 'vue';

export class TemplateRegistry {
    static attach(component: Component, source: string): void {
        const template = document.createElement('template');
        template.innerHTML = source.trim();
        const root = template.content.firstElementChild;

        if (!(root instanceof HTMLTemplateElement)) {
            throw new Error('A component template must contain one root <template> element.');
        }

        (component as Component & { template: string }).template = root.innerHTML;
    }
}

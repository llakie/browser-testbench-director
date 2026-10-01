import { renderPreviewShellTemplate } from '../templates/preview-shell-template.js';
import type { LayerNode } from './project-format.js';
import { renderPreviewRuntimeScript } from './preview-runtime-script.js';
import type { RuntimeStep } from './runtime-protocol.js';
import type { WorkflowPlan, WorkflowStep } from './workflow-planner.js';

export class PreviewDocument {
    static build(layer: LayerNode | null, websiteUrl = ''): string {
        return PreviewDocument.buildPlan({
            mode: 'node',
            inputs: [],
            cameraInputId: null,
            website: websiteUrl
                ? {
                      id: 'website-root',
                      type: 'website',
                      name: 'Website',
                      position: { x: 0, y: 0 },
                      url: websiteUrl,
                  }
                : null,
            resetWebsite: true,
            steps: layer ? [{ node: layer, speed: 'live', after: [] }] : [],
        });
    }

    static buildPlan(
        plan: WorkflowPlan,
        executionId: number | null = null,
        inputs: Readonly<Record<string, string>> = {},
    ): string {
        const websiteUrl = plan.website?.url.trim() ?? '';
        const websiteMarkup = websiteUrl
            ? `<iframe class="director-website" data-director-src="${PreviewDocument.safeAttribute(websiteUrl)}" title="Website" allow="camera; microphone"></iframe>`
            : '';
        const runtimeScript = renderPreviewRuntimeScript({
            steps: PreviewDocument.runtimeSteps(plan),
            executionId,
            inputs,
            cameraInputId: plan.cameraInputId,
        });

        return renderPreviewShellTemplate({
            pageBackground: websiteUrl ? 'transparent' : '#fff',
            websiteMarkup,
            runtimeScript: PreviewDocument.safeScript(runtimeScript),
        });
    }

    static runtimeSteps(plan: WorkflowPlan): RuntimeStep[] {
        return plan.steps.map(PreviewDocument.serializeStep);
    }

    private static serializeStep(step: WorkflowStep): RuntimeStep {
        if (step.node.type === 'audio') {
            return {
                id: step.node.id,
                type: step.node.type,
                speed: step.speed,
                after: step.after,
                source: '',
                inputId: step.inputId,
                volume: step.node.volume,
                envelope: step.node.envelope,
                waitForEnd: step.node.waitForEnd,
            };
        }

        if (step.node.type === 'merge') {
            return {
                id: step.node.id,
                type: step.node.type,
                speed: step.speed,
                after: step.after,
                source: '',
                waitFor: step.node.waitFor,
            };
        }

        if (step.node.type === 'browser-action') {
            return {
                id: step.node.id,
                type: step.node.type,
                speed: step.speed,
                after: step.after,
                source: '',
                selector: step.node.selector,
            };
        }

        if (step.node.type === 'browser-wait') {
            const common = {
                id: step.node.id,
                type: step.node.type,
                speed: step.speed,
                after: step.after,
                source: '',
                condition: step.node.condition,
                timeoutMs: step.node.timeoutMs,
                omitFromRecording: step.node.omitFromRecording,
            };

            if (step.node.condition === 'element') {
                return { ...common, selector: step.node.selector };
            }

            if (step.node.condition === 'url') {
                return { ...common, value: step.node.value };
            }

            return { ...common, script: step.node.script };
        }

        if (step.node.type === 'javascript') {
            return {
                id: step.node.id,
                type: step.node.type,
                speed: step.speed,
                after: step.after,
                source: step.node.source,
            };
        }

        return {
            id: step.node.id,
            type: step.node.type,
            speed: step.speed,
            after: step.after,
            source: step.node.source.javascript,
            html: step.node.source.html,
            css: step.node.source.css,
            placement: step.node.placement,
            playback: step.node.playback,
        };
    }

    private static safeScript(value: string): string {
        return value.replace(/<\/script/giu, '<\\/script');
    }

    private static safeAttribute(value: string): string {
        return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    }
}

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PreviewDocument } from '../src/ui/client/core/preview-document.js';
import { ProjectFormat } from '../src/ui/client/core/project-format.js';
import { ProjectNodes } from '../src/ui/client/core/project-nodes.js';
import { renderPreviewRuntimeScript } from '../src/ui/client/core/preview-runtime-script.js';
import { TextLayerSource } from '../src/ui/client/core/text-layer-source.js';
import { WorkflowPlanner } from '../src/ui/client/core/workflow-planner.js';

test('Text layer generates readable, escaped HTML and cumulative line animations', () => {
    const text = TextLayerSource.create();
    text.lines[0]!.text = 'Guess & <Win>';
    text.lines[0]!.effect = { name: 'fly', durationMs: 500, direction: 'right' };
    text.lines.push({
        ...TextLayerSource.line(),
        text: 'The Price',
        color: '#65ff63',
        offsetMs: 400,
        effect: { name: 'fade', durationMs: 300, direction: 'left' },
    });
    text.lines.push({
        ...TextLayerSource.line(),
        text: 'The Price',
        offsetMs: 500,
    });
    text.effect = { name: 'pop', durationMs: 600, direction: 'left' };

    const source = TextLayerSource.render(text, 'intro');
    assert.match(source.html, /Guess &amp; &lt;Win&gt;/u);
    assert.match(source.html, /text-layer__line--guess-win/u);
    assert.match(source.html, /text-layer__line--the-price-2/u);
    assert.match(source.html, /id="tl-[a-z0-9]+"/u);
    assert.match(source.css, /#tl-[a-z0-9]+ \.text-layer__line--guess-win/u);
    assert.match(source.css, /tl-[a-z0-9]+-fade 300ms ease-out 400ms both/u);
    assert.match(source.css, /tl-[a-z0-9]+-show 1ms ease-out 900ms both/u);
    assert.match(source.css, /tl-[a-z0-9]+-pop 600ms ease-out 0ms both/u);
    assert.notEqual(TextLayerSource.render(text, 'outro').html, source.html);
    assert.equal(source.javascript, '');
    assert.equal(TextLayerSource.latestEnd(text), 900);
});

test('Text editor settings survive project save and convert to a plain layer source', () => {
    const project = ProjectFormat.create();
    const layer = ProjectNodes.createTextLayer(project, 'Title');
    layer.text!.lines[0]!.text = 'Hello';
    project.nodes.push(layer);
    project.connections.push({ id: `layer-1--${layer.id}`, source: 'layer-1', target: layer.id });

    const parsed = ProjectFormat.parse(ProjectFormat.stringify(project));
    const loaded = parsed.nodes.find((node) => node.id === layer.id);
    assert.equal(loaded?.type, 'layer');

    if (loaded?.type !== 'layer') {
        return;
    }

    assert.equal(loaded.text?.lines[0]?.text, 'Hello');
    assert.match(loaded.source.html, /Hello/u);
    delete loaded.text;
    assert.match(ProjectFormat.stringify(parsed), /text-layer__line--hello/u);
});

test('Project font is carried into runtime and required for direct playback', () => {
    const project = ProjectFormat.create();
    const font = ProjectNodes.createInput(project, 'Title font');
    font.accept = 'font/woff2';
    project.nodes.push(font);
    project.connections.push({
        id: `${font.id}--website-root`,
        source: font.id,
        target: 'website-root',
    });
    const layer = ProjectNodes.createTextLayer(project, 'Title');
    layer.text!.font = 'project';
    layer.text!.fontInputId = font.id;
    project.nodes.push(layer);
    project.connections.push({ id: `layer-1--${layer.id}`, source: 'layer-1', target: layer.id });

    const plan = WorkflowPlanner.plan(
        ProjectFormat.parse(ProjectFormat.stringify(project)),
        'current',
        layer.id,
    );
    assert.deepEqual(
        plan.inputs.map((input) => input.id),
        [font.id],
    );
    assert.equal(PreviewDocument.runtimeSteps(plan)[0]?.fontInputId, font.id);
    layer.fontInputId = font.id;
    delete layer.text;
    const converted = ProjectFormat.parse(ProjectFormat.stringify(project));
    const convertedPlan = WorkflowPlanner.plan(converted, 'current', layer.id);
    assert.equal(PreviewDocument.runtimeSteps(convertedPlan)[0]?.fontInputId, font.id);
    assert.doesNotThrow(
        () =>
            new Function(
                renderPreviewRuntimeScript({
                    steps: PreviewDocument.runtimeSteps(plan),
                    executionId: null,
                    inputs: {},
                    cameraInputId: null,
                    globalStylesheetInputIds: [],
                }),
            ),
    );
});

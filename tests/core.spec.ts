import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
    audio,
    BrowserScript,
    BrowserScriptRunner,
    call,
    clip,
    compileRun,
    defineProduction,
    DomAssetInstaller,
    DomOverlayRenderer,
    FfmpegAudioMixer,
    graph,
    hold,
    overlay,
    parallel,
    ProductionCompiler,
    RecordingTimeMapper,
    sequence,
    timeline,
    TimelineRecording,
    TimelineVideoRenderer,
    TimelineRunner,
    validateGraph,
    wait,
} from '../src/index.js';
import type { BrowserSession } from '../src/index.js';

const silentLogger = { debug() {} };
const emptySession: BrowserSession = {
    click: async () => undefined,
    evaluate: async () => undefined,
    navigate: async () => undefined,
    waitForElement: async () => undefined,
    waitForNetworkIdle: async () => undefined,
    waitForScript: async () => undefined,
    waitForUrl: async () => undefined,
};
const production = defineProduction({
    id: 'test.production',
    actionTimeout: 100,
    triggerTimeout: 100,
});

test('Browser-Scripts werden typisiert ausgelagert und mit Argumenten ausgeführt', async () => {
    const calls: Array<{ script: string; arguments: readonly unknown[] }> = [];
    const session: BrowserSession = {
        ...emptySession,
        evaluate(script: string, arguments_: readonly unknown[] = []) {
            calls.push({ script, arguments: arguments_ });
            return { text: 'aus dem Browser' };
        },
    };
    const script = BrowserScript.define<{ selector: string }, { text: string }>(
        'test.read-text',
        ({ selector }) => ({
            text: document.querySelector(selector)?.textContent ?? '',
        }),
    );

    const result = await new BrowserScriptRunner(session).run(script, { selector: '#result' });

    assert.deepEqual(result, { text: 'aus dem Browser' });
    assert.deepEqual(calls[0]?.arguments, [{ selector: '#result' }]);
    assert.match(calls[0]?.script ?? '', /document\.querySelector/);
    assert.match(calls[0]?.script ?? '', /sourceURL=browser-script:test\.read-text/);
});

test('Recording-Zeitabbildung verwendet Browser-Testbench-Marken', () => {
    const mapping = RecordingTimeMapper.fromMarks(
        { recordingTimeMs: 200 },
        { recordingTimeMs: 1_300 },
        1_000,
    );

    assert.equal(mapping.recordingStartSeconds, 0.2);
    assert.equal(mapping.recordingEndSeconds, 1.3);
    assert.equal(mapping.toRecordingSeconds(500), 0.75);
    assert.equal(mapping.drift, 1.1);
});

test('Timeline-Aufnahme steuert Viewport-Recording und Marken in richtiger Reihenfolge', async () => {
    const calls: string[] = [];
    const session = {
        recording: {
            async start(options: { scope: string }) {
                calls.push(`start:${options.scope}`);
            },
            async stop() {
                calls.push('stop');
                return {
                    actualScope: 'viewport',
                    width: 412,
                    height: 786,
                    durationMs: 1_200,
                };
            },
        },
        async mark(name: string) {
            calls.push(`mark:${name}`);
            return { recordingTimeMs: name.endsWith('start') ? 100 : 1_100 };
        },
    };
    const timeline = { runtimeDurationMs: 1_000 };

    const result = await TimelineRecording.capture({
        session: session as never,
        outputPath: '/tmp/raw.mp4',
        run: async () => {
            calls.push('run');
            return timeline as never;
        },
    });

    assert.deepEqual(calls, [
        'start:viewport',
        'mark:video-timeline.start',
        'run',
        'mark:video-timeline.end',
        'stop',
    ]);
    assert.equal(result.timeMap.toRecordingSeconds(500), 0.6);
});

test('Timeline-Video-Renderer erzeugt Schnitt und Hochformat aus der Viewport-Aufnahme', () => {
    const invocation = TimelineVideoRenderer.arguments({
        rawVideoPath: '/tmp/raw.mp4',
        outputPath: '/tmp/final.mp4',
        recordingIntervals: [
            { start: 1.25, end: 2.5 },
            { start: 4, end: 5 },
        ],
    });

    const filterIndex = invocation.arguments.indexOf('-filter_complex');
    const filter = invocation.arguments[filterIndex + 1] ?? '';
    assert.match(filter, /trim=start=1\.250:end=2\.500/);
    assert.match(filter, /concat=n=2:v=1:a=0/);
    assert.doesNotMatch(filter, /crop=/);
    assert.match(filter, /scale=1080:1920/);
    assert.equal(invocation.temporaryVideoPath, '/tmp/final.mp4.video-only.mp4');
});

test('sequence addiert und parallel verwendet die längste Dauer', () => {
    const plan = compileRun(
        sequence(
            clip.custom({ id: 'fill', start() {}, end() {} }),
            hold(10),
            parallel(hold(25), hold(15)),
        ),
        35,
    );

    assert.equal(plan.duration, 35);
    assert.deepEqual(
        plan.events.map(({ kind, offset }) => ({ kind, offset })),
        [
            { kind: 'start', offset: 0 },
            { kind: 'end', offset: 35 },
        ],
    );
});

test('Validator lehnt Zyklen und ungeordnete Nutzung desselben Layers ab', () => {
    assert.throws(
        () =>
            validateGraph(
                graph(
                    timeline({ id: 'a', layer: 'story', after: ['b'], run: hold(1) }),
                    timeline({ id: 'b', layer: 'story', after: ['a'], run: hold(1) }),
                ),
            ),
        /Zyklus/,
    );

    assert.throws(
        () =>
            validateGraph(
                graph(
                    timeline({ id: 'a', layer: 'story', run: hold(1) }),
                    timeline({ id: 'b', layer: 'story', run: hold(1) }),
                ),
            ),
        /gleichzeitig belegen/,
    );
});

test('Trigger eines Nachfolgers wird erst nach dem vollständigen Vorgänger aktiviert', async () => {
    let predecessorEnded = false;
    let triggerObservedEnd = false;
    const flow = graph(
        timeline({
            id: 'first',
            layer: 'story',
            run: sequence(
                hold(12),
                call.action('finish-first', () => {
                    predecessorEnded = true;
                }),
            ),
        }),
        timeline({
            id: 'second',
            layer: 'story',
            after: ['first'],
            trigger: wait.custom('observe-first', () => {
                triggerObservedEnd = predecessorEnded;
            }),
            run: hold(8),
        }),
    );

    const result = await new TimelineRunner({
        production,
        graph: flow,
        session: emptySession,
        logger: silentLogger,
    }).run();

    assert.equal(triggerObservedEnd, true);
    assert.equal(result.states.first, 'completed');
    assert.equal(result.states.second, 'completed');
    assert.ok(result.mediaDurationMs >= 18);
});

test('vollständig inaktive Trigger-Wartezeit bleibt außerhalb der Medienintervalle', async () => {
    const flow = graph(
        timeline({ id: 'first', layer: 'story', run: hold(8) }),
        timeline({
            id: 'second',
            layer: 'story',
            after: ['first'],
            trigger: wait.custom('external-result', () => pause(25)),
            run: hold(8),
        }),
    );

    const result = await new TimelineRunner({
        production,
        graph: flow,
        session: emptySession,
        logger: silentLogger,
    }).run();

    assert.equal(result.keepIntervals.length, 2);
    assert.ok(result.runtimeDurationMs - result.mediaDurationMs >= 20);
});

test('eine parallele sichtbare Timeline erhält Runtime während eines anderen Triggers', async () => {
    const flow = graph(
        timeline({ id: 'background', layer: 'browser', run: hold(45) }),
        timeline({ id: 'first', layer: 'story', run: hold(8) }),
        timeline({
            id: 'second',
            layer: 'story',
            after: ['first'],
            trigger: wait.custom('external-result', () => pause(20)),
            run: hold(8),
        }),
    );

    const result = await new TimelineRunner({
        production,
        graph: flow,
        session: emptySession,
        logger: silentLogger,
    }).run();

    assert.equal(result.keepIntervals.length, 1);
    assert.ok(result.mediaDurationMs >= 40);
});

test('eine asynchrone Action verlängert den Graphzustand, aber nicht die Medienzeit', async () => {
    const flow = graph(
        timeline({
            id: 'action',
            layer: 'control',
            run: parallel(
                call.action('slow', () => pause(30)),
                hold(8),
            ),
        }),
    );

    const result = await new TimelineRunner({
        production,
        graph: flow,
        session: emptySession,
        logger: silentLogger,
    }).run();

    assert.ok(result.runtimeDurationMs >= 25);
    assert.ok(result.mediaDurationMs < 15);
    assert.equal(result.states.action, 'completed');
});

test('Action-Timeout bricht die Production ab und liefert ein partielles Event-Log', async () => {
    let clipEnded = false;
    const flow = graph(
        timeline({
            id: 'timeout',
            layer: 'control',
            run: parallel(
                clip.custom({
                    id: 'active',
                    duration: 50,
                    start() {},
                    end() {
                        clipEnded = true;
                    },
                }),
                call.action('never', () => new Promise(() => {}), { timeout: 10 }),
            ),
        }),
    );

    await assert.rejects(
        () =>
            new TimelineRunner({
                production,
                graph: flow,
                session: emptySession,
                logger: silentLogger,
            }).run(),
        (error: unknown) => {
            assert.ok(error instanceof Error);
            const timelineError = error as Error & {
                code: string;
                timelineResult: { states: Record<string, string> };
            };
            assert.equal(timelineError.code, 'TIMELINE_TIMEOUT');
            assert.equal(timelineError.timelineResult.states.timeout, 'running');
            return true;
        },
    );
    assert.equal(clipEnded, true);
});

test('Audio-Clips werden auf die finale Medienzeit abgebildet', async () => {
    const flow = graph(
        timeline({
            id: 'sound',
            layer: 'sfx',
            run: audio.clip({ id: 'hit', src: './hit.wav', duration: 20, gainDb: -3 }),
        }),
    );

    const result = await new TimelineRunner({
        production,
        graph: flow,
        session: emptySession,
        logger: silentLogger,
    }).run();

    assert.equal(result.audioClips.length, 1);
    assert.equal(result.audioClips[0].src, './hit.wav');
    assert.ok(result.audioClips[0].startMs < 1);
    assert.ok(result.audioClips[0].duration >= 15);
});

test('Overlay-Builder verwendet den isolierten Renderer aus dem Production-Context', async () => {
    const calls: unknown[][] = [];
    const fakeSession = {
        ...emptySession,
        evaluate(_script: string, arguments_: readonly unknown[] = []) {
            calls.push([...arguments_]);
            return { missing: false };
        },
    };
    const overlays = new DomOverlayRenderer(fakeSession, { layers: { story: { zIndex: 20 } } });
    const flow = graph(
        timeline({
            id: 'caption',
            layer: 'story',
            run: overlay.text({
                id: 'caption-text',
                layer: 'story',
                text: 'Hallo',
                duration: 5,
                anchor: { selector: '#card', point: 'center', mode: 'snapshot' },
            }),
        }),
    );

    await new TimelineRunner({
        production,
        graph: flow,
        session: fakeSession,
        logger: silentLogger,
    }).run({ overlays });

    const shown = calls[0]?.[0] as {
        id: string;
        zIndex: number;
        anchor: { selector: string };
    };
    assert.equal(shown.id, 'caption-text');
    assert.equal(shown.zIndex, 20);
    assert.equal(shown.anchor.selector, '#card');
    assert.equal(calls.at(-1)?.[0], 'caption-text');
});

test('FFmpeg-Audio-Mix übernimmt Cue-Zeit, Gain und Fades', () => {
    const invocation = FfmpegAudioMixer.arguments({
        videoPath: 'video.mp4',
        outputPath: 'mixed.mp4',
        clips: [
            {
                id: 'reveal',
                src: 'hit.wav',
                startMs: 4250,
                duration: 800,
                gainDb: -3,
                fadeIn: 20,
                fadeOut: 80,
            },
        ],
    });

    assert.equal(invocation.command, 'ffmpeg');
    const filter = invocation.arguments[invocation.arguments.indexOf('-filter_complex') + 1];
    assert.match(filter, /\[1:a\]atrim=start=0\.000:duration=0\.800/);
    assert.match(filter, /volume=-3dB/);
    assert.match(filter, /afade=t=in:st=0:d=0\.020/);
    assert.match(filter, /afade=t=out:st=0\.720:d=0\.080/);
    assert.match(filter, /adelay=4250:all=1/);
});

test('FFmpeg-Audio-Mix erzeugt ohne Clips einen bewusst leeren Track', () => {
    const invocation = FfmpegAudioMixer.arguments({
        videoPath: 'video.mp4',
        outputPath: 'mixed.mp4',
        clips: [],
    });
    const filter = invocation.arguments[invocation.arguments.indexOf('-filter_complex') + 1];
    assert.equal(filter, 'anullsrc=channel_layout=stereo:sample_rate=48000[audio]');
});

test('Production-Compiler importiert SCSS, CSS und HTML als Strings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'video-timeline-assets-'));
    const entryPath = join(directory, 'production.ts');
    const outputPath = join(directory, 'production.mjs');
    await Promise.all([
        writeFile(
            entryPath,
            [
                "import scss from './theme.scss';",
                "import css from './plain.css';",
                "import template from './template.html';",
                'export default { scss, css, template };',
            ].join('\n'),
        ),
        writeFile(
            join(directory, 'theme.scss'),
            '$accent: #ff0000; @font-face { src: url("./font.woff2"); } .title { color: $accent; }',
        ),
        writeFile(join(directory, 'plain.css'), '.card { display: grid; }'),
        writeFile(join(directory, 'template.html'), '<strong>Guess the price</strong>'),
        writeFile(join(directory, 'font.woff2'), Buffer.from([0, 1, 2, 3])),
    ]);

    const artifact = await ProductionCompiler.compile(entryPath, { outputPath });
    try {
        const module = (await artifact.load()) as {
            default: { scss: string; css: string; template: string };
        };
        assert.match(module.default.scss, /color: #ff0000/);
        assert.match(module.default.scss, /data:font\/woff2;base64,AAECAw==/);
        assert.match(module.default.css, /display: grid/);
        assert.equal(module.default.template, '<strong>Guess the price</strong>');
    } finally {
        await artifact.dispose();
        await rm(directory, { recursive: true, force: true });
    }
});

test('DOM-Asset-Installer überträgt große Inhalte in begrenzten Chunks', async () => {
    const calls: Array<{ script: string; arguments: readonly unknown[] }> = [];
    const session: BrowserSession = {
        ...emptySession,
        evaluate(script: string, arguments_: readonly unknown[] = []) {
            calls.push({ script, arguments: arguments_ });
            return undefined;
        },
    };

    await new DomAssetInstaller(session, { chunkSize: 4 }).installStyle({
        id: 'theme',
        content: 'abcdefghij',
    });

    const chunks = calls
        .filter(({ script }) => script.includes('+= arguments[1]'))
        .map(({ arguments: arguments_ }) => arguments_[1]);
    assert.deepEqual(chunks, ['abcd', 'efgh', 'ij']);
    assert.ok(calls.some(({ script }) => script.includes("document.createElement('style')")));
    assert.ok(calls.at(-1)?.script.includes('delete window'));
});

function pause(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

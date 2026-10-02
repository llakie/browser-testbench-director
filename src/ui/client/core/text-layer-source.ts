import type { LayerSource } from './project-format.js';

export type TextEffectName = 'none' | 'fade' | 'fly' | 'pop';

export interface TextEffect {
    name: TextEffectName;
    durationMs: number;
    direction: 'left' | 'right';
}

export interface TextLine {
    id: string;
    text: string;
    color: string;
    align: 'left' | 'center' | 'right';
    offsetMs: number;
    effect: TextEffect;
}

export interface TextLayerSettings {
    font: 'sans-serif' | 'serif' | 'monospace' | 'project';
    fontInputId: string;
    sizeVw: number;
    weight: 400 | 700;
    lineHeight: number;
    maxWidthPercent: number;
    effect: TextEffect;
    lines: TextLine[];
}

export class TextLayerSource {
    static create(): TextLayerSettings {
        return {
            font: 'sans-serif',
            fontInputId: '',
            sizeVw: 8,
            weight: 700,
            lineHeight: 1,
            maxWidthPercent: 90,
            effect: TextLayerSource.effect(),
            lines: [TextLayerSource.line()],
        };
    }

    static effect(): TextEffect {
        return { name: 'none', durationMs: 500, direction: 'left' };
    }

    static line(): TextLine {
        return {
            id: crypto.randomUUID(),
            text: '',
            color: '#ffffff',
            align: 'center',
            offsetMs: 0,
            effect: TextLayerSource.effect(),
        };
    }

    static render(settings: TextLayerSettings, nodeId: string): LayerSource {
        const scope = `tl-${TextLayerSource.hash(nodeId)}`;
        const names = new Set<string>();
        const lines = settings.lines.map((line, index) => {
            const base = TextLayerSource.slug(line.text) || `line-${index + 1}`;
            let name = base;
            let suffix = 2;

            while (names.has(name)) {
                name = `${base}-${suffix++}`;
            }

            names.add(name);
            return { ...line, className: `text-layer__line--${name}` };
        });
        const family =
            settings.font === 'project'
                ? `"Director Font ${TextLayerSource.cssString(settings.fontInputId)}", sans-serif`
                : settings.font;
        const html = [
            `<div id="${scope}" class="text-layer">`,
            ...lines.map(
                (line) =>
                    `    <div class="text-layer__line ${line.className}">${TextLayerSource.html(line.text)}</div>`,
            ),
            '</div>',
        ].join('\n');
        const css = [
            `#${scope} {`,
            '    width: max-content;',
            `    max-width: ${settings.maxWidthPercent}vw;`,
            `    font-family: ${family};`,
            `    font-size: clamp(1rem, ${settings.sizeVw}vw, 12rem);`,
            `    font-weight: ${settings.weight};`,
            `    line-height: ${settings.lineHeight};`,
            '    overflow-wrap: anywhere;',
            ...(settings.effect.name !== 'none'
                ? [`    animation: ${TextLayerSource.animation(scope, settings.effect, 0)};`]
                : []),
            '}',
            '',
            `#${scope} .text-layer__line {`,
            '    display: block;',
            '}',
        ];
        let delay = 0;

        for (const line of lines) {
            delay += line.offsetMs;
            css.push(
                '',
                `#${scope} .${line.className} {`,
                `    color: ${line.color};`,
                `    text-align: ${line.align};`,
                ...(line.effect.name !== 'none' || delay > 0
                    ? [`    animation: ${TextLayerSource.animation(scope, line.effect, delay)};`]
                    : []),
                '}',
            );
        }

        const effects = new Set([
            settings.effect.name,
            ...settings.lines.map((line) => line.effect.name),
            ...(delay > 0 ? ['show'] : []),
        ]);

        for (const effect of effects) {
            const keyframes = TextLayerSource.keyframes(scope, effect);

            if (keyframes) {
                css.push('', keyframes);
            }
        }

        return { html, css: css.join('\n'), javascript: '' };
    }

    static validate(value: unknown): value is TextLayerSettings {
        if (!TextLayerSource.record(value)) {
            return false;
        }

        const effect = (candidate: unknown): candidate is TextEffect =>
            TextLayerSource.record(candidate) &&
            ['none', 'fade', 'fly', 'pop'].includes(String(candidate['name'])) &&
            Number.isInteger(candidate['durationMs']) &&
            Number(candidate['durationMs']) >= 100 &&
            Number(candidate['durationMs']) <= 10_000 &&
            ['left', 'right'].includes(String(candidate['direction'])) &&
            TextLayerSource.keys(candidate, ['name', 'durationMs', 'direction']);
        return (
            ['sans-serif', 'serif', 'monospace', 'project'].includes(String(value['font'])) &&
            typeof value['fontInputId'] === 'string' &&
            (value['font'] !== 'project' || Boolean(value['fontInputId'])) &&
            TextLayerSource.range(value['sizeVw'], 2, 30) &&
            [400, 700].includes(Number(value['weight'])) &&
            TextLayerSource.range(value['lineHeight'], 0.7, 2) &&
            TextLayerSource.range(value['maxWidthPercent'], 20, 100) &&
            effect(value['effect']) &&
            Array.isArray(value['lines']) &&
            value['lines'].length > 0 &&
            value['lines'].every(
                (line: unknown) =>
                    TextLayerSource.record(line) &&
                    typeof line['id'] === 'string' &&
                    Boolean(line['id']) &&
                    typeof line['text'] === 'string' &&
                    /^#[0-9a-fA-F]{6}$/u.test(String(line['color'])) &&
                    ['left', 'center', 'right'].includes(String(line['align'])) &&
                    Number.isInteger(line['offsetMs']) &&
                    Number(line['offsetMs']) >= 0 &&
                    Number(line['offsetMs']) <= 60_000 &&
                    effect(line['effect']) &&
                    TextLayerSource.keys(line, [
                        'id',
                        'text',
                        'color',
                        'align',
                        'offsetMs',
                        'effect',
                    ]),
            ) &&
            TextLayerSource.keys(value, [
                'font',
                'fontInputId',
                'sizeVw',
                'weight',
                'lineHeight',
                'maxWidthPercent',
                'effect',
                'lines',
            ])
        );
    }

    static latestEnd(settings: TextLayerSettings): number {
        let offset = 0;
        let end = settings.effect.name === 'none' ? 0 : settings.effect.durationMs;

        for (const line of settings.lines) {
            offset += line.offsetMs;
            end = Math.max(
                end,
                offset + (line.effect.name === 'none' ? 0 : line.effect.durationMs),
            );
        }

        return end;
    }

    private static animation(scope: string, effect: TextEffect, delay: number): string {
        const name = effect.name === 'none' ? `${scope}-show` : `${scope}-${effect.name}`;
        const direction = effect.name === 'fly' ? `-${effect.direction}` : '';
        const duration = effect.name === 'none' ? 1 : effect.durationMs;
        return `${name}${direction} ${duration}ms ease-out ${delay}ms both`;
    }

    private static keyframes(scope: string, name: string): string {
        const frames: Record<string, string> = {
            show: `@keyframes ${scope}-show {
    from { visibility: hidden; }
    to { visibility: visible; }
}`,
            fade: `@keyframes ${scope}-fade {
    from { opacity: 0; }
    to { opacity: 1; }
}`,
            fly: `@keyframes ${scope}-fly-left {
    from { opacity: 0; transform: translateX(-100vw); }
    to { opacity: 1; transform: none; }
}

@keyframes ${scope}-fly-right {
    from { opacity: 0; transform: translateX(100vw); }
    to { opacity: 1; transform: none; }
}`,
            pop: `@keyframes ${scope}-pop {
    from { opacity: 0; transform: scale(.65); }
    70% { opacity: 1; transform: scale(1.08); }
    to { opacity: 1; transform: none; }
}`,
        };
        return frames[name] ?? '';
    }

    private static slug(value: string): string {
        return value
            .normalize('NFKD')
            .toLowerCase()
            .replace(/[^a-z0-9]+/gu, '-')
            .replace(/^-|-$/gu, '')
            .slice(0, 32);
    }

    private static hash(value: string): string {
        let hash = 2166136261;

        for (const character of value) {
            hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
        }

        return (hash >>> 0).toString(36);
    }

    private static html(value: string): string {
        return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    }

    private static cssString(value: string): string {
        return value.replace(/[^a-zA-Z0-9_-]/gu, '-');
    }

    private static record(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    private static keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
        return Object.keys(value).every((key) => allowed.includes(key));
    }

    private static range(value: unknown, min: number, max: number): boolean {
        return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
    }
}

export interface DelaySettings {
    durationMs: number;
}

export class DelayNodeSource {
    static create(): DelaySettings {
        return { durationMs: 1_000 };
    }

    static render(settings: DelaySettings): string {
        return `await director.wait(${settings.durationMs});`;
    }

    static validate(value: unknown): value is DelaySettings {
        return (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            Object.keys(value).length === 1 &&
            'durationMs' in value &&
            typeof value.durationMs === 'number' &&
            Number.isFinite(value.durationMs) &&
            value.durationMs >= 0
        );
    }
}

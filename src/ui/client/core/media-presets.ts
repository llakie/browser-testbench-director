export const PREVIEW_PRESET_IDS = [
    'phone-portrait',
    'phone-landscape',
    'tablet-portrait',
    'tablet-landscape',
    'desktop',
] as const;

export type PreviewPresetId = (typeof PREVIEW_PRESET_IDS)[number];

export interface MediaSize {
    readonly width: number;
    readonly height: number;
}

export interface PreviewPresetDefinition {
    readonly id: PreviewPresetId;
    readonly viewport: MediaSize;
    readonly devicePixelRatio: number;
}

export const previewPresetDefinitions: readonly PreviewPresetDefinition[] = [
    {
        id: 'phone-portrait',
        viewport: { width: 360, height: 640 },
        devicePixelRatio: 3,
    },
    {
        id: 'phone-landscape',
        viewport: { width: 640, height: 360 },
        devicePixelRatio: 3,
    },
    {
        id: 'tablet-portrait',
        viewport: { width: 768, height: 1024 },
        devicePixelRatio: 2,
    },
    {
        id: 'tablet-landscape',
        viewport: { width: 1024, height: 768 },
        devicePixelRatio: 2,
    },
    {
        id: 'desktop',
        viewport: { width: 1920, height: 1080 },
        devicePixelRatio: 1,
    },
];

export function previewPreset(id: PreviewPresetId): PreviewPresetDefinition {
    return previewPresetDefinitions.find((preset) => preset.id === id)!;
}

export function previewOutputSize(id: PreviewPresetId): MediaSize {
    const preset = previewPreset(id);
    return {
        width: preset.viewport.width * preset.devicePixelRatio,
        height: preset.viewport.height * preset.devicePixelRatio,
    };
}

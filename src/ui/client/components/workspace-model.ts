import type { BrowserTestbenchTarget } from '../core/browser-testbench-preview.js';
import type { NodeExecutionStatus } from '../core/execution-controller.js';
import { previewPresetDefinitions, type PreviewPresetId } from '../core/media-presets.js';
import type { LayerSource } from '../core/project-format.js';
import type { WorkflowPlan } from '../core/workflow-planner.js';

export type SourceType = keyof LayerSource;
export type Splitter = 'outer' | 'inner';
export type WorkspacePanel = 'preview' | 'graph' | 'editor';
export type BrowserTestbenchState = 'checking' | 'running' | 'stopped' | 'starting' | 'stopping';
export type CreatableNodeType =
    | 'input'
    | 'camera-capability'
    | 'layer'
    | 'javascript'
    | 'browser-action'
    | 'browser-wait'
    | 'audio'
    | 'merge';

export interface ViewportPreset {
    readonly id: PreviewPresetId;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly devicePixelRatio: number;
    readonly icon: string;
    readonly labelKey: string;
}

export interface PreviewRuntime {
    readonly ready: Promise<void>;
    run(steps: readonly unknown[], executionId?: number | null): Promise<void>;
    cancel(): void;
}

export interface RuntimeMessage {
    readonly type: 'director:execution';
    readonly executionId: number | null;
    readonly nodeId: string;
    readonly status: NodeExecutionStatus;
    readonly error?: string;
}

export interface McpClientStatus {
    readonly id: string;
    readonly label: string;
    readonly installed: boolean;
    readonly registered: boolean;
    readonly command: string;
    readonly automatic: boolean;
}

const viewportPresentation: Record<PreviewPresetId, Pick<ViewportPreset, 'icon' | 'labelKey'>> = {
    'phone-portrait': { icon: 'bi-phone', labelKey: 'preview.phonePortrait' },
    'phone-landscape': { icon: 'bi-phone-landscape', labelKey: 'preview.phoneLandscape' },
    'tablet-portrait': { icon: 'bi-tablet', labelKey: 'preview.tabletPortrait' },
    'tablet-landscape': {
        icon: 'bi-tablet-landscape',
        labelKey: 'preview.tabletLandscape',
    },
    desktop: { icon: 'bi-display', labelKey: 'preview.desktop' },
};

export const viewportPresets: readonly ViewportPreset[] = previewPresetDefinitions.map(
    (preset) => ({
        ...preset,
        ...viewportPresentation[preset.id],
    }),
);

export const commonInputTypes = [
    'image/*',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/svg+xml',
    'video/*',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/*',
    'audio/mpeg',
    'audio/wav',
    'application/pdf',
    'application/json',
    'application/zip',
    'application/octet-stream',
    'text/plain',
    'text/csv',
    'font/ttf',
    'font/otf',
    'font/woff',
    'font/woff2',
] as const;

export function cloneWorkflowPlan(plan: WorkflowPlan): WorkflowPlan {
    return JSON.parse(JSON.stringify(plan)) as WorkflowPlan;
}

const layoutStorageKey = 'browser-testbench-director.layout';

export interface LayoutPreferences {
    portraitTools: number;
    landscapePreview: number;
    toolsSplit: number;
}

const defaultLayoutPreferences: LayoutPreferences = {
    portraitTools: 38,
    landscapePreview: 48,
    toolsSplit: 38,
};

export class WorkspaceLayoutPreferences {
    static read(): LayoutPreferences {
        if (typeof localStorage === 'undefined') {
            return { ...defaultLayoutPreferences };
        }

        try {
            const stored = JSON.parse(
                localStorage.getItem(layoutStorageKey) ?? '{}',
            ) as Partial<LayoutPreferences>;
            return {
                portraitTools: WorkspaceLayoutPreferences.valid(
                    stored.portraitTools,
                    defaultLayoutPreferences.portraitTools,
                ),
                landscapePreview: WorkspaceLayoutPreferences.valid(
                    stored.landscapePreview,
                    defaultLayoutPreferences.landscapePreview,
                ),
                toolsSplit: WorkspaceLayoutPreferences.valid(
                    stored.toolsSplit,
                    defaultLayoutPreferences.toolsSplit,
                ),
            };
        } catch {
            return { ...defaultLayoutPreferences };
        }
    }

    static write(preferences: LayoutPreferences): void {
        try {
            localStorage.setItem(layoutStorageKey, JSON.stringify(preferences));
        } catch {
            // The editor remains usable when browser storage is unavailable.
        }
    }

    private static valid(value: unknown, fallback: number): number {
        return typeof value === 'number' && Number.isFinite(value) && value >= 20 && value <= 80
            ? value
            : fallback;
    }
}

export type WorkspaceMethodMap = Record<
    string,
    // Controller modules deliberately share the Vue workspace instance as their context.
    (...args: any[]) => any
> &
    ThisType<any>;

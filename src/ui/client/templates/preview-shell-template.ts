import template from './preview-shell.html?raw';

export interface PreviewShellTemplateValues {
    readonly pageBackground: string;
    readonly websiteMarkup: string;
    readonly runtimeScript: string;
}

export function renderPreviewShellTemplate(values: PreviewShellTemplateValues): string {
    return template
        .replace('/* director:page-background */', values.pageBackground)
        .replace('<!-- director:website -->', values.websiteMarkup)
        .replace('/* director:runtime */', values.runtimeScript);
}

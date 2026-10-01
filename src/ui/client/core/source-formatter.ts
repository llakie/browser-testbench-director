import type { Plugin } from 'prettier';

export type SourceLanguage = 'html' | 'css' | 'javascript';

const parserByLanguage: Readonly<Record<SourceLanguage, string>> = {
    html: 'html',
    css: 'css',
    javascript: 'babel',
};

export class SourceFormatter {
    static async format(source: string, language: SourceLanguage): Promise<string> {
        const [{ format }, plugins] = await Promise.all([
            import('prettier/standalone'),
            SourceFormatter.plugins(language),
        ]);

        return format(source, {
            parser: parserByLanguage[language],
            plugins,
            printWidth: 100,
            singleQuote: true,
            tabWidth: 4,
            useTabs: false,
        });
    }

    private static async plugins(language: SourceLanguage): Promise<Plugin[]> {
        if (language === 'javascript') {
            const [babel, estree] = await Promise.all([
                import('prettier/plugins/babel'),
                import('prettier/plugins/estree'),
            ]);
            return [babel.default, estree.default];
        }

        if (language === 'css') {
            return [(await import('prettier/plugins/postcss')).default];
        }

        return [(await import('prettier/plugins/html')).default];
    }
}

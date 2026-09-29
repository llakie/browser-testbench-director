export type SourceLanguage = 'html' | 'css' | 'javascript';

const parserByLanguage: Readonly<Record<SourceLanguage, string>> = {
    html: 'html',
    css: 'css',
    javascript: 'babel',
};

export class SourceFormatter {
    static async format(source: string, language: SourceLanguage): Promise<string> {
        const [{ format }, babel, estree, html, postcss] = await Promise.all([
            import('prettier/standalone'),
            import('prettier/plugins/babel'),
            import('prettier/plugins/estree'),
            import('prettier/plugins/html'),
            import('prettier/plugins/postcss'),
        ]);

        return format(source, {
            parser: parserByLanguage[language],
            plugins: [babel.default, estree.default, html.default, postcss.default],
            printWidth: 100,
            singleQuote: true,
            tabWidth: 4,
            useTabs: false,
        });
    }
}

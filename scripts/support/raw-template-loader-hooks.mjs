import { readFile } from 'node:fs/promises';

export async function load(url, context, nextLoad) {
    const templateUrl = new URL(url);

    if (
        templateUrl.protocol === 'file:' &&
        templateUrl.pathname.endsWith('.html') &&
        templateUrl.searchParams.has('raw')
    ) {
        templateUrl.search = '';
        const template = await readFile(templateUrl, 'utf8');

        return {
            format: 'module',
            shortCircuit: true,
            source: `export default ${JSON.stringify(template)};`,
        };
    }

    return nextLoad(url, context);
}

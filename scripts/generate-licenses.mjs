import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { getLicenseFileText } from 'generate-license-file';

const outputPath = 'THIRD_PARTY_LICENSES.txt';
const configPath = '.glf.json';
const config = JSON.parse(await readFile(configPath, 'utf8'));
const replacements = Object.fromEntries(
    Object.entries(config.replace).map(([packageName, replacementPath]) => [
        packageName,
        resolve(dirname(configPath), replacementPath),
    ]),
);
const generated = await getLicenseFileText('package.json', {
    lineEnding: 'lf',
    replace: replacements,
});

if (process.argv.includes('--check')) {
    const current = await readFile(outputPath, 'utf8');

    if (current !== generated) {
        throw new Error(`${outputPath} is out of date. Run npm run licenses.`);
    }
} else {
    await writeFile(outputPath, generated, 'utf8');
}

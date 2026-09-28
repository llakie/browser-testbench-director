import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface BrowserTestbenchPackage {
    readonly version: string;
    readonly bin: { readonly 'browser-testbench': string };
}

export interface BrowserTestbenchInstallationDetails {
    readonly version: string;
    readonly executable: string;
}

export class BrowserTestbenchInstallation {
    static async resolve(): Promise<BrowserTestbenchInstallationDetails> {
        const clientEntry = fileURLToPath(import.meta.resolve('browser-testbench/client'));
        const packageRoot = resolve(dirname(clientEntry), '../..');
        const packageJson = JSON.parse(
            await readFile(resolve(packageRoot, 'package.json'), 'utf8'),
        ) as BrowserTestbenchPackage;
        const executable = resolve(packageRoot, packageJson.bin['browser-testbench']);
        return { version: packageJson.version, executable };
    }
}

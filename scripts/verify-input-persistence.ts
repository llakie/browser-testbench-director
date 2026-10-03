import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RemoteTestbench } from 'browser-testbench/client';

import { ProjectFormat } from '../src/ui/client/core/project-format.js';
import { selectGraphNode } from './support/director-ui.js';

const applicationUrl = process.env['DIRECTOR_UI_URL'] ?? 'https://127.0.0.1:5173/';
const testbench = new RemoteTestbench({
    server: process.env['BROWSER_TESTBENCH_URL'] ?? 'http://127.0.0.1:55808',
    requestTimeoutMs: 30_000,
});
const directory = await mkdtemp(join(tmpdir(), 'director-input-persistence-'));
const fixtureDirectory = join(directory, 'fixtures');
await mkdir(fixtureDirectory);
const project = ProjectFormat.create('Input persistence');
project.nodes.unshift({
    id: 'persistent-input',
    type: 'input',
    name: 'Persistent input',
    position: null,
    accept: 'text/plain',
    required: false,
});
project.connections.push({
    id: 'persistent-input--website-root',
    source: 'persistent-input',
    target: 'website-root',
});
const projectPath = join(fixtureDirectory, 'input-persistence.btd.json');
const inputPath = join(fixtureDirectory, 'persistent-input.txt');
await Promise.all([
    writeFile(projectPath, ProjectFormat.stringify(project), 'utf8'),
    writeFile(inputPath, 'persistent input', 'utf8'),
]);

const browser = await testbench.open({
    target: process.env['BROWSER_TESTBENCH_TARGET'] ?? 'chrome',
    url: applicationUrl,
    headless: true,
    downloadDir: directory,
    capabilities: { acceptInsecureCerts: true },
});

try {
    await browser.waitForElement('.workspace', 10_000);
    await browser.setViewport(1440, 1000);
    await browser.upload('[data-testid="project-file-input"]', projectPath);
    await selectGraphNode(browser, 'persistent-input');
    await browser.waitForElement('[data-testid="project-input-persistent-input"]', 5_000);
    await browser.evaluate(`
        Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            value: undefined,
        });
        window.__inputPersistenceFetch = window.fetch;
        window.fetch = async (...args) => {
            const [input, options] = args;
            if (String(input) === '/director-api/assets' && options?.method === 'POST') {
                await new Promise(resolve => setTimeout(resolve, 600));
            }
            return window.__inputPersistenceFetch(...args);
        };
    `);
    await browser.upload('[data-testid="project-input-persistent-input"]', inputPath);
    await browser.waitForScript(
        `return document.querySelector(
            '[model-id="persistent-input"] [joint-selector="fileName"]'
        )?.textContent.includes('persistent-input.txt');`,
        [],
        5_000,
    );
    await browser.click('[data-testid="save-project"]');
    await browser.waitForElement('[data-testid="save-project"] .icon-spinner', 5_000);
    const download = await browser.waitForDownload('input-persistence.btd.json', 10_000);
    const saved = JSON.parse(await readFile(download.path, 'utf8')) as {
        nodes: Array<{ id: string; file?: { name: string } }>;
    };
    assert.equal(
        saved.nodes.find((node) => node.id === 'persistent-input')?.file?.name,
        'persistent-input.txt',
    );
    await browser.click('[data-testid="new-project"]');
    await browser.upload('[data-testid="project-file-input"]', download.path);
    await browser.waitForScript(
        `return document.querySelector(
            '[model-id="persistent-input"] [joint-selector="fileName"]'
        )?.textContent.includes('persistent-input.txt');`,
        [],
        10_000,
    );
    process.stdout.write('Browser Testbench input persistence verification passed.\n');
} finally {
    await browser.close();
}

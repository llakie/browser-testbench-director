import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RemoteTestbench } from 'browser-testbench/client';

export const applicationUrl = process.env['DIRECTOR_UI_URL'] ?? 'http://127.0.0.1:5173/';
export const exampleSiteUrl = new URL('/example-site.html', applicationUrl).toString();
export const server = process.env['BROWSER_TESTBENCH_URL'] ?? 'http://127.0.0.1:55808';
export const target = process.env['BROWSER_TESTBENCH_TARGET'] ?? 'chrome';
export const testbench = new RemoteTestbench({ server, requestTimeoutMs: 30_000 });
export const outputDirectory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-ui-'));

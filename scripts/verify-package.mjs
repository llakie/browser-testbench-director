import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'browser-testbench-director-package-'));
let archive;

try {
    await execute(npm, ['run', 'build'], { cwd: packageRoot });
    const packed = await execute(npm, ['pack', '--ignore-scripts', '--json', '--silent'], {
        cwd: packageRoot,
    });
    const normalizedOutput = packed.stdout.replaceAll('\r\n', '\n').trim();
    const jsonStart = normalizedOutput.lastIndexOf('\n[');
    const [{ filename }] = JSON.parse(normalizedOutput.slice(jsonStart < 0 ? 0 : jsonStart + 1));
    archive = resolve(packageRoot, filename);
    await writeFile(join(temporaryDirectory, 'package.json'), '{"private":true}', 'utf8');
    await execute(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], {
        cwd: temporaryDirectory,
    });

    const executable = join(
        temporaryDirectory,
        'node_modules',
        '.bin',
        process.platform === 'win32'
            ? 'browser-testbench-director.cmd'
            : 'browser-testbench-director',
    );
    const configuration = await execute(
        executable,
        ['mcp-config', '--client', 'other', '--workspace', temporaryDirectory],
        { cwd: temporaryDirectory },
    );
    const parsed = JSON.parse(configuration.stdout);
    if (!parsed.mcpServers?.['browser-testbench-director']) {
        throw new Error('The installed CLI did not produce a Director MCP configuration.');
    }

    const port = await availablePort();
    const server = spawn(executable, ['start', '--host', '127.0.0.1', '--port', String(port)], {
        cwd: temporaryDirectory,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
        await waitForServer(server, `http://127.0.0.1:${port}`);
    } finally {
        if (server.exitCode === null) {
            server.kill('SIGTERM');
            await new Promise((resolveExit) => server.once('exit', resolveExit));
        }
    }
    process.stdout.write('Packed Director CLI, MCP configuration, and production UI passed.\n');
} finally {
    if (archive) await unlink(archive).catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true });
}

async function availablePort() {
    const server = createServer();
    await new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not reserve a port.');
    await new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
    );
    return address.port;
}

async function waitForServer(server, origin) {
    const deadline = Date.now() + 20_000;
    let stderr = '';
    server.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
    });
    while (Date.now() < deadline) {
        if (server.exitCode !== null) {
            throw new Error(`The installed Director exited during startup.\n${stderr}`);
        }
        try {
            const response = await fetch(origin);
            const html = await response.text();
            if (response.ok && html.includes('Browser Testbench Director')) return;
        } catch {
            // The server is still starting.
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new Error(`The installed Director did not become ready.\n${stderr}`);
}

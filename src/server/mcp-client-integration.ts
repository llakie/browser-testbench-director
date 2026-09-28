import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const serverName = 'browser-testbench-director';

type ClientId = 'codex' | 'claude-code' | 'gemini-cli' | 'copilot-vscode' | 'other';

interface ClientDefinition {
    readonly id: ClientId;
    readonly label: string;
    readonly binary?: string;
    readonly statusArgs?: readonly string[];
    readonly addArgs?: readonly string[];
    readonly removeArgs?: readonly string[];
    readonly command: string;
    readonly automatic: boolean;
}

export interface McpClientStatus {
    readonly id: ClientId;
    readonly label: string;
    readonly installed: boolean;
    readonly registered: boolean;
    readonly command: string;
    readonly automatic: boolean;
}

export class McpClientIntegration {
    readonly #definitions: readonly ClientDefinition[];

    constructor(command: string, args: readonly string[]) {
        const stdio = [command, ...args];
        const quoted = shellCommand(stdio);
        const vscode = JSON.stringify({ name: serverName, command, args });
        const other = JSON.stringify({ mcpServers: { [serverName]: { command, args } } }, null, 2);
        this.#definitions = [
            {
                id: 'codex',
                label: 'Codex',
                binary: 'codex',
                statusArgs: ['mcp', 'get', serverName, '--json'],
                addArgs: ['mcp', 'add', serverName, '--', ...stdio],
                removeArgs: ['mcp', 'remove', serverName],
                command: `codex mcp add ${serverName} -- ${quoted}`,
                automatic: true,
            },
            {
                id: 'claude-code',
                label: 'Claude Code',
                binary: 'claude',
                statusArgs: ['mcp', 'get', serverName],
                addArgs: [
                    'mcp',
                    'add',
                    '--transport',
                    'stdio',
                    '--scope',
                    'user',
                    serverName,
                    '--',
                    ...stdio,
                ],
                removeArgs: ['mcp', 'remove', serverName, '--scope', 'user'],
                command: `claude mcp add --transport stdio --scope user ${serverName} -- ${quoted}`,
                automatic: true,
            },
            {
                id: 'gemini-cli',
                label: 'Gemini CLI',
                binary: 'gemini',
                statusArgs: ['mcp', 'list'],
                addArgs: ['mcp', 'add', '--scope', 'user', serverName, ...stdio],
                removeArgs: ['mcp', 'remove', '--scope', 'user', serverName],
                command: `gemini mcp add --scope user ${serverName} ${quoted}`,
                automatic: true,
            },
            {
                id: 'copilot-vscode',
                label: 'GitHub Copilot in VS Code',
                binary: 'code',
                statusArgs: ['--version'],
                command: `code --add-mcp ${shellQuote(vscode)}`,
                automatic: false,
            },
            {
                id: 'other',
                label: 'Other MCP client',
                command: other,
                automatic: false,
            },
        ];
    }

    async statuses(): Promise<McpClientStatus[]> {
        return Promise.all(this.#definitions.map((definition) => this.#status(definition)));
    }

    configuration(id: string): string {
        return this.#definition(id).command;
    }

    async connect(id: string): Promise<McpClientStatus> {
        const definition = this.#definition(id);
        if (!definition.automatic || !definition.binary || !definition.addArgs) {
            throw new Error(`${definition.label} requires manual setup.`);
        }
        const current = await this.#status(definition);
        if (!current.installed) throw new Error(`${definition.label} is not installed.`);
        if (current.registered && definition.removeArgs) {
            await execute(definition.binary, [...definition.removeArgs], { timeout: 15_000 });
        }
        await execute(definition.binary, [...definition.addArgs], { timeout: 15_000 });
        return this.#status(definition);
    }

    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method === 'GET') {
            this.#json(response, 200, await this.statuses());
            return;
        }
        if (request.method === 'POST') {
            const body = JSON.parse(await readBody(request)) as { client?: string };
            this.#json(response, 200, await this.connect(body.client ?? ''));
            return;
        }
        this.#json(response, 405, { error: 'Method not allowed.' });
    }

    async #status(definition: ClientDefinition): Promise<McpClientStatus> {
        if (!definition.binary || !definition.statusArgs) {
            return publicStatus(definition, true, false);
        }
        try {
            const output = await execute(definition.binary, [...definition.statusArgs], {
                timeout: 8_000,
            });
            return publicStatus(
                definition,
                true,
                `${output.stdout}\n${output.stderr}`.includes(serverName),
            );
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            return publicStatus(definition, code !== 'ENOENT', false);
        }
    }

    #definition(id: string): ClientDefinition {
        const definition = this.#definitions.find((candidate) => candidate.id === id);
        if (!definition) throw new Error(`Unknown MCP client: ${id}`);
        return definition;
    }

    #json(response: ServerResponse, status: number, value: unknown): void {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(value));
    }
}

async function readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks).toString('utf8');
}

function shellCommand(values: readonly string[]): string {
    return values.map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
    if (/^[A-Za-z0-9_./:@=-]+$/u.test(value)) return value;
    return `'${value.replaceAll("'", `'\\''`)}'`;
}

function publicStatus(
    definition: ClientDefinition,
    installed: boolean,
    registered: boolean,
): McpClientStatus {
    return {
        id: definition.id,
        label: definition.label,
        installed,
        registered,
        command: definition.command,
        automatic: definition.automatic,
    };
}

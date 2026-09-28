import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { DirectorProjectService } from './director-project-service.js';

export class DirectorMcpServer {
    static async start(workspace: string): Promise<void> {
        const projects = new DirectorProjectService(workspace);
        const server = new McpServer(
            { name: 'browser-testbench-director', version: '0.1.0' },
            {
                instructions:
                    'Create and edit Browser Testbench Director .btd.json projects. Read a project before changing it. Preserve unrelated nodes and validate the complete project before writing. Project paths are relative to the configured workspace.',
            },
        );

        server.registerTool(
            'list_projects',
            {
                description: 'List Director project files below the workspace projects directory.',
                annotations: { readOnlyHint: true },
            },
            async () => result(await projects.list()),
        );
        server.registerTool(
            'read_project',
            {
                description: 'Read and validate one Director project.',
                inputSchema: { path: z.string().min(1) },
                annotations: { readOnlyHint: true },
            },
            async ({ path }) => result(await projects.read(path)),
        );
        server.registerTool(
            'validate_project',
            {
                description:
                    'Validate a complete Director project JSON document without saving it.',
                inputSchema: { project: z.string().min(1) },
                annotations: { readOnlyHint: true },
            },
            async ({ project }) => result(projects.validate(project)),
        );
        server.registerTool(
            'create_project',
            {
                description: 'Create a new valid Director project in the workspace.',
                inputSchema: {
                    path: z.string().min(1),
                    name: z.string().min(1),
                    websiteUrl: z.string().optional(),
                },
            },
            async (input) => result(await projects.create(input.path, input)),
        );
        server.registerTool(
            'write_project',
            {
                description:
                    'Validate and atomically replace a Director project with a complete JSON document.',
                inputSchema: { path: z.string().min(1), project: z.string().min(1) },
                annotations: { destructiveHint: true },
            },
            async ({ path, project }) => result(await projects.write(path, project)),
        );
        server.registerTool(
            'upsert_node',
            {
                description: 'Add or replace one node and validate the complete project.',
                inputSchema: { path: z.string().min(1), node: z.record(z.string(), z.unknown()) },
            },
            async ({ path, node }) => result(await projects.upsertNode(path, node)),
        );
        server.registerTool(
            'remove_node',
            {
                description: 'Remove a non-root node and all of its connections.',
                inputSchema: { path: z.string().min(1), nodeId: z.string().min(1) },
                annotations: { destructiveHint: true },
            },
            async ({ path, nodeId }) => result(await projects.removeNode(path, nodeId)),
        );
        server.registerTool(
            'connect_nodes',
            {
                description: 'Connect two nodes and validate the resulting executable workflow.',
                inputSchema: {
                    path: z.string().min(1),
                    source: z.string().min(1),
                    target: z.string().min(1),
                },
            },
            async ({ path, source, target }) =>
                result(await projects.connect(path, source, target)),
        );

        await server.connect(new StdioServerTransport());
    }
}

function result(value: unknown) {
    return {
        content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
        structuredContent: { result: value },
    };
}

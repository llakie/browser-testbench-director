import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
    ProjectFormat,
    type DirectorNode,
    type DirectorProject,
} from '../ui/client/core/project-format.js';

export class DirectorProjectService {
    readonly #workspace: string;

    constructor(workspace: string) {
        this.#workspace = resolve(workspace);
    }

    async list(): Promise<string[]> {
        const projects = resolve(this.#workspace, 'projects');
        const files: string[] = [];
        await this.#collectProjects(projects, files).catch(() => undefined);
        return files.sort();
    }

    async read(path: string): Promise<DirectorProject> {
        return ProjectFormat.parse(await readFile(this.#resolve(path), 'utf8'));
    }

    async create(
        path: string,
        options: { readonly name: string; readonly websiteUrl?: string },
    ): Promise<DirectorProject> {
        const target = this.#resolve(path);
        if (await stat(target).catch(() => undefined)) {
            throw new Error(`Project already exists: ${path}`);
        }
        const project = ProjectFormat.create(options.name);
        const website = project.nodes.find((node) => node.type === 'website');
        if (website) website.url = options.websiteUrl ?? '';
        await this.write(path, project);
        return project;
    }

    async write(path: string, value: unknown): Promise<DirectorProject> {
        const project = ProjectFormat.parse(
            typeof value === 'string' ? value : JSON.stringify(value),
        );
        const target = this.#resolve(path);
        const temporary = `${target}.${process.pid}.tmp`;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(temporary, ProjectFormat.stringify(project), {
            encoding: 'utf8',
            flag: 'wx',
        });
        await rename(temporary, target);
        return project;
    }

    async upsertNode(path: string, value: unknown): Promise<DirectorProject> {
        const project = await this.read(path);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError('Node must be an object.');
        }
        const node = value as DirectorNode;
        const index = project.nodes.findIndex((candidate) => candidate.id === node.id);
        if (index >= 0) project.nodes.splice(index, 1, node);
        else project.nodes.push(node);
        return this.write(path, project);
    }

    async removeNode(path: string, nodeId: string): Promise<DirectorProject> {
        const project = await this.read(path);
        const node = project.nodes.find((candidate) => candidate.id === nodeId);
        if (!node) throw new Error(`Unknown node: ${nodeId}`);
        if (node.type === 'website') throw new Error('The website root cannot be removed.');
        project.nodes = project.nodes.filter((candidate) => candidate.id !== nodeId);
        project.connections = project.connections.filter(
            (connection) => connection.source !== nodeId && connection.target !== nodeId,
        );
        return this.write(path, project);
    }

    async connect(path: string, source: string, target: string): Promise<DirectorProject> {
        const project = await this.read(path);
        let id = `${source}--${target}`;
        let suffix = 2;
        while (project.connections.some((connection) => connection.id === id)) {
            id = `${source}--${target}-${suffix}`;
            suffix += 1;
        }
        project.connections.push({ id, source, target });
        return this.write(path, project);
    }

    validate(value: unknown): DirectorProject {
        return ProjectFormat.parse(typeof value === 'string' ? value : JSON.stringify(value));
    }

    #resolve(path: string): string {
        if (!path.trim() || isAbsolute(path) || !path.endsWith('.btd.json')) {
            throw new Error('Project paths must be relative .btd.json files.');
        }
        const target = resolve(this.#workspace, path);
        const workspaceRelative = relative(this.#workspace, target);
        if (workspaceRelative.startsWith('..') || isAbsolute(workspaceRelative)) {
            throw new Error('Project path is outside the Director workspace.');
        }
        return target;
    }

    async #collectProjects(directory: string, output: string[]): Promise<void> {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) await this.#collectProjects(path, output);
            else if (entry.isFile() && entry.name.endsWith('.btd.json')) {
                output.push(relative(this.#workspace, path).split(sep).join('/'));
            }
        }
    }
}

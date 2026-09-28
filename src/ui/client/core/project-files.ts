import { ProjectFormat, type DirectorProject } from './project-format.js';

interface SaveFilePickerOptions {
    readonly suggestedName?: string;
    readonly types?: readonly {
        readonly description: string;
        readonly accept: Readonly<Record<string, readonly string[]>>;
    }[];
}

interface WritableFile {
    write(data: string): Promise<void>;
    close(): Promise<void>;
}

export interface ProjectFileHandle {
    getFile(): Promise<File>;
    createWritable(): Promise<WritableFile>;
}

type OpenFilePicker = (options?: SaveFilePickerOptions) => Promise<ProjectFileHandle[]>;
type SaveFilePicker = (options?: SaveFilePickerOptions) => Promise<ProjectFileHandle>;

export interface OpenedProjectFile {
    readonly file: File;
    readonly handle: ProjectFileHandle;
}

export interface SavedProjectFile {
    readonly filename: string;
    readonly handle: ProjectFileHandle | null;
}

export class ProjectFiles {
    static async read(file: File): Promise<DirectorProject> {
        return ProjectFormat.parse(await file.text());
    }

    static async open(): Promise<OpenedProjectFile | null> {
        const openFilePicker = (window as Window & { showOpenFilePicker?: OpenFilePicker })
            .showOpenFilePicker;
        if (!openFilePicker) return null;
        const [handle] = await openFilePicker({
            types: [this.fileType()],
        });
        if (!handle) throw new DOMException('No project selected.', 'AbortError');
        return { file: await handle.getFile(), handle };
    }

    static async save(
        project: DirectorProject,
        preferredName?: string,
        existingHandle?: ProjectFileHandle | null,
    ): Promise<SavedProjectFile> {
        const filename = ProjectFiles.filename(preferredName ?? project.name);
        const content = ProjectFormat.stringify(project);
        if (existingHandle) {
            await this.write(existingHandle, content);
            return { filename, handle: existingHandle };
        }
        const saveFilePicker = (window as Window & { showSaveFilePicker?: SaveFilePicker })
            .showSaveFilePicker;
        if (saveFilePicker) {
            const handle = await saveFilePicker({
                suggestedName: filename,
                types: [this.fileType()],
            });
            await this.write(handle, content);
            return { filename, handle };
        }

        const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
        return { filename, handle: null };
    }

    static filename(value: string): string {
        const stem = value
            .replace(/\.btd\.json$/iu, '')
            .normalize('NFKD')
            .replace(/[^a-zA-Z0-9]+/gu, '-')
            .replace(/^-|-$/gu, '')
            .toLowerCase();
        return `${stem || 'untitled-project'}.btd.json`;
    }

    private static fileType(): NonNullable<SaveFilePickerOptions['types']>[number] {
        return {
            description: 'Browser Testbench Director project',
            accept: { 'application/json': ['.btd.json'] },
        };
    }

    private static async write(handle: ProjectFileHandle, content: string): Promise<void> {
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
    }
}

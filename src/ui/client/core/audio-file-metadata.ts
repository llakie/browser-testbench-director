export class AudioFileMetadata {
    static durationMs(file: File): Promise<number> {
        return new Promise((resolve, reject) => {
            const source = URL.createObjectURL(file);
            const audio = document.createElement('audio');
            const cleanup = (): void => {
                audio.removeEventListener('loadedmetadata', loaded);
                audio.removeEventListener('error', failed);
                audio.removeAttribute('src');
                audio.load();
                URL.revokeObjectURL(source);
            };
            const loaded = (): void => {
                const durationMs = audio.duration * 1_000;
                cleanup();

                if (!Number.isFinite(durationMs) || durationMs <= 0) {
                    reject(new Error(`Audio duration could not be read: ${file.name}`));
                    return;
                }

                resolve(durationMs);
            };
            const failed = (): void => {
                cleanup();
                reject(new Error(`Audio metadata could not be read: ${file.name}`));
            };
            audio.preload = 'metadata';
            audio.addEventListener('loadedmetadata', loaded, { once: true });
            audio.addEventListener('error', failed, { once: true });
            audio.src = source;
        });
    }
}

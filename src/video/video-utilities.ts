import { spawn } from 'node:child_process';

export class VideoUtilities {
    static runFfmpeg(arguments_: readonly string[], ffmpegPath = 'ffmpeg'): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(ffmpegPath, arguments_, { stdio: 'inherit' });
            child.once('error', reject);
            child.once('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(VideoUtilities.#processError(ffmpegPath, code));
                }
            });
        });
    }

    static #processError(command: string, code: number | null, stderr = ''): Error {
        return new Error(
            `${command} wurde mit Status ${code ?? 'unbekannt'} beendet.${stderr ? `\n${stderr}` : ''}`,
        );
    }
}

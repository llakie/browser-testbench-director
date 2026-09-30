import { spawn } from 'node:child_process';

export class VideoUtilities {
    static runFfmpeg(arguments_: readonly string[], ffmpegPath = 'ffmpeg'): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn(ffmpegPath, arguments_, {
                stdio: ['inherit', 'inherit', 'pipe'],
            });
            const stderr: Buffer[] = [];
            let stderrSize = 0;

            child.stderr.on('data', (chunk: Buffer) => {
                process.stderr.write(chunk);

                if (stderrSize >= 64 * 1_024) {
                    return;
                }

                const remaining = 64 * 1_024 - stderrSize;
                const captured = chunk.subarray(0, remaining);
                stderr.push(captured);
                stderrSize += captured.byteLength;
            });
            child.once('error', reject);
            child.once('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(
                        VideoUtilities.#processError(
                            ffmpegPath,
                            code,
                            Buffer.concat(stderr).toString('utf8').trim(),
                        ),
                    );
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

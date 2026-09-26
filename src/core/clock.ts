import type { Clock } from './types.js';

export class RealClock implements Clock {
    #origin = performance.now();

    now(): number {
        return performance.now() - this.#origin;
    }

    sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
        if (milliseconds <= 0) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(finish, milliseconds);
            const abort = () => {
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                reject(signal?.reason ?? new Error('Operation abgebrochen.'));
            };
            function finish() {
                signal?.removeEventListener('abort', abort);
                resolve();
            }
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, { once: true });
        });
    }
}

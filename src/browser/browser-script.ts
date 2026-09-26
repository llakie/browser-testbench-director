import type { BrowserSession, MaybePromise } from '../core/types.js';

export type BrowserScriptFunction<Input, Result> = (input: Input) => MaybePromise<Result>;

export class BrowserScript<Input = void, Result = void> {
    readonly name: string;
    readonly source: string;

    private constructor(name: string, execute: BrowserScriptFunction<Input, Result>) {
        if (!name.trim()) throw new TypeError('BrowserScript benötigt einen Namen.');
        if (typeof execute !== 'function') {
            throw new TypeError('BrowserScript benötigt eine ausführbare Funktion.');
        }
        this.name = name;
        this.source = `return (${execute.toString()})(arguments[0]);\n//# sourceURL=browser-script:${encodeURIComponent(name)}`;
    }

    static define<Input = void, Result = void>(
        name: string,
        execute: BrowserScriptFunction<Input, Result>,
    ): BrowserScript<Input, Result> {
        return new BrowserScript(name, execute);
    }
}

export class BrowserScriptRunner {
    readonly #session: BrowserSession;

    constructor(session: BrowserSession) {
        if (!session?.evaluate) {
            throw new TypeError('BrowserScriptRunner benötigt eine Browser-Session.');
        }
        this.#session = session;
    }

    async run<Result>(script: BrowserScript<void, Result>): Promise<Awaited<Result>>;
    async run<Input, Result>(
        script: BrowserScript<Input, Result>,
        input: Input,
    ): Promise<Awaited<Result>>;
    async run<Input, Result>(
        script: BrowserScript<Input, Result>,
        input?: Input,
    ): Promise<Awaited<Result>> {
        return (await this.#session.evaluate(script.source, [input])) as Awaited<Result>;
    }
}

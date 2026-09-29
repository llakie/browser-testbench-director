import { X509Certificate } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { generate } from 'selfsigned';

export interface HttpsCertificate {
    readonly cert: Buffer;
    readonly key: Buffer;
}

export class LocalHttpsCertificate {
    static async resolve(
        packageRoot: string,
        certificatePath?: string,
        keyPath?: string,
    ): Promise<HttpsCertificate> {
        if (Boolean(certificatePath) !== Boolean(keyPath)) {
            throw new Error('--https-cert and --https-key must be provided together.');
        }

        if (certificatePath && keyPath) {
            return {
                cert: await readFile(resolve(certificatePath)),
                key: await readFile(resolve(keyPath)),
            };
        }

        const directory = resolve(packageRoot, '.certs');
        const certificateFile = resolve(directory, 'director-local.crt');
        const keyFile = resolve(directory, 'director-local.key');
        const existing = await this.readValid(certificateFile, keyFile);

        if (existing) {
            return existing;
        }

        const generated = await generate([{ name: 'commonName', value: 'localhost' }], {
            algorithm: 'sha256',
            keySize: 2048,
            notAfterDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1_000),
            extensions: [
                { name: 'basicConstraints', cA: false },
                { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
                { name: 'extKeyUsage', serverAuth: true },
                {
                    name: 'subjectAltName',
                    altNames: [
                        { type: 2, value: 'localhost' },
                        { type: 7, ip: '127.0.0.1' },
                        { type: 7, ip: '::1' },
                    ],
                },
            ],
        });
        await mkdir(directory, { recursive: true });
        await Promise.all([
            writeFile(certificateFile, generated.cert, { encoding: 'utf8', mode: 0o644 }),
            writeFile(keyFile, generated.private, { encoding: 'utf8', mode: 0o600 }),
        ]);
        return { cert: Buffer.from(generated.cert), key: Buffer.from(generated.private) };
    }

    private static async readValid(
        certificateFile: string,
        keyFile: string,
    ): Promise<HttpsCertificate | null> {
        try {
            const [cert, key] = await Promise.all([readFile(certificateFile), readFile(keyFile)]);
            const certificate = new X509Certificate(cert);
            const minimumValidity = Date.now() + 7 * 24 * 60 * 60 * 1_000;
            return Date.parse(certificate.validTo) > minimumValidity ? { cert, key } : null;
        } catch {
            return null;
        }
    }
}

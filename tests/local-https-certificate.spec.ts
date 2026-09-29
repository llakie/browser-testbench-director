import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { LocalHttpsCertificate } from '../src/server/local-https-certificate.js';

test('Lokales HTTPS-Zertifikat wird erzeugt und wiederverwendet', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'director-certificate-'));
    try {
        const first = await LocalHttpsCertificate.resolve(directory);
        const second = await LocalHttpsCertificate.resolve(directory);
        const certificate = new X509Certificate(first.cert);

        assert.equal(second.cert.toString(), first.cert.toString());
        assert.match(certificate.subjectAltName ?? '', /DNS:localhost/u);
        assert.match(certificate.subjectAltName ?? '', /IP Address:127\.0\.0\.1/u);
        if (process.platform !== 'win32') {
            assert.equal(
                (await stat(join(directory, '.certs/director-local.key'))).mode & 0o777,
                0o600,
            );
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

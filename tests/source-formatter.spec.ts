import assert from 'node:assert/strict';
import test from 'node:test';

import { SourceFormatter } from '../src/ui/client/core/source-formatter.js';

test('Quelltext-Formatter formatiert HTML, CSS und JavaScript mit gemeinsamen Regeln', async () => {
    assert.equal(
        await SourceFormatter.format('<section><strong>Preis</strong></section>', 'html'),
        '<section><strong>Preis</strong></section>\n',
    );
    assert.equal(
        await SourceFormatter.format('.price{color:red;margin:0  1rem}', 'css'),
        '.price {\n    color: red;\n    margin: 0 1rem;\n}\n',
    );
    assert.equal(
        await SourceFormatter.format('const price={value:1};console.log(price)', 'javascript'),
        'const price = { value: 1 };\nconsole.log(price);\n',
    );
});

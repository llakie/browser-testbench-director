import assert from 'node:assert/strict';

import {
    applicationUrl,
    outputDirectory,
    target,
    testbench,
} from './support/ui-verification-context.js';
import { verifyEditableConnections, verifyJavaScriptNode } from './ui/graph-editing.js';
import { verifyGraphAutoLayout } from './ui/graph-layout.js';
import { verifyPlacement } from './ui/layer-placement.js';
import { verifyNodeEditing } from './ui/node-editing.js';
import { verifyExecutionControls, verifyPlayback } from './ui/playback.js';
import { verifyPreviewDevices } from './ui/preview-devices.js';
import {
    verifyLandscapeDock,
    verifyProjectRoundtrip,
    verifyRecordingExport,
} from './ui/project-and-recording.js';
import { verifyLayout, verifyResizableWorkspace } from './ui/responsive-layout.js';
import {
    verifyCameraSessionConfiguration,
    verifyRuntimeDataFlow,
} from './ui/runtime-and-camera.js';
import {
    verifyEmptyProjectPlayback,
    verifyFlyoutCollision,
    verifyMcpSetup,
    verifyMobileMenu,
    verifySelectorPicker,
} from './ui/shell-and-overlays.js';
import { verifyLayerSelectionAndZoom } from './ui/stage-interactions.js';

const browser = await testbench.open({
    target,
    url: applicationUrl,
    headless: true,
    downloadDir: outputDirectory,
    lockTimeoutMs: 15_000,
    ...(applicationUrl.startsWith('https://')
        ? { capabilities: { acceptInsecureCerts: true } }
        : {}),
});

try {
    await browser.waitForElement('.workspace', 10_000);
    await verifyEmptyProjectPlayback(browser);
    await verifyLayout(browser, 'desktop', 1440, 1000, 'portrait-dock');
    await verifyLayout(browser, 'tablet', 1024, 900, 'portrait-dock');
    await verifyLayout(browser, 'mobile', 390, 844, 'mobile-tabs');
    await verifyMobileMenu(browser);
    await verifyFlyoutCollision(browser);
    await verifyPreviewDevices(browser);
    await verifyMcpSetup(browser);
    await verifySelectorPicker(browser);
    await verifyRecordingExport(browser);
    await verifyLayerSelectionAndZoom(browser);
    await verifyGraphAutoLayout(browser);
    await verifyJavaScriptNode(browser);
    await verifyResizableWorkspace(browser);
    await verifyEditableConnections(browser);
    await verifyNodeEditing(browser);
    await verifyRuntimeDataFlow(browser);
    await verifyCameraSessionConfiguration(browser);
    await verifyExecutionControls(browser);
    await verifyPlayback(browser);
    await verifyPlacement(browser);
    await verifyProjectRoundtrip(browser);
    await verifyLandscapeDock(browser);
    const diagnostics = await browser.diagnostics();
    const severeDiagnostics = diagnostics.filter(
        (entry) =>
            entry.type === 'console' &&
            ['error', 'assert', 'severe'].includes(entry.level?.toLowerCase() ?? ''),
    );
    assert.deepEqual(severeDiagnostics, [], 'The UI emitted browser console errors.');
    process.stdout.write(
        `Browser Testbench UI verification passed.\nScreenshots: ${outputDirectory}\n`,
    );
} finally {
    await browser.close().catch(() => undefined);
}

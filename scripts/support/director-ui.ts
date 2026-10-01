import type { RemoteSession } from 'browser-testbench/client';

export async function selectGraphNode(session: RemoteSession, nodeId: string): Promise<void> {
    await dispatchGraphControl(session, nodeId, 'bodyText');
}

export async function playGraphNode(session: RemoteSession, nodeId: string): Promise<void> {
    await dispatchGraphControl(session, nodeId, 'playButton');
}

export async function clickPreviewWebsiteElement(
    session: RemoteSession,
    selector: string,
): Promise<void> {
    await session.waitForScript(
        `const frame = document.querySelector('.director-website');
        const element = frame?.contentDocument?.querySelector(arguments[0]);
        if (!element) return false;
        element.click();
        return true;`,
        [selector],
        10_000,
    );
}

async function dispatchGraphControl(
    session: RemoteSession,
    nodeId: string,
    jointSelector: string,
): Promise<void> {
    await session.waitForScript(
        `const [nodeId, jointSelector] = arguments;
        const node = [...document.querySelectorAll(
            '[data-testid="graph-canvas"] .joint-element'
        )].find(candidate => candidate.getAttribute('model-id') === nodeId);
        const control = node?.querySelector('[joint-selector="' + jointSelector + '"]');
        if (!(control instanceof Element)) return false;
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            const EventType = type.startsWith('pointer') ? PointerEvent : MouseEvent;
            control.dispatchEvent(new EventType(type, {
                bubbles: true,
                button: 0,
                buttons: type.endsWith('down') ? 1 : 0,
                ...(type.startsWith('pointer') ? { pointerType: 'mouse' } : {}),
            }));
        }
        return true;`,
        [nodeId, jointSelector],
        10_000,
    );
}

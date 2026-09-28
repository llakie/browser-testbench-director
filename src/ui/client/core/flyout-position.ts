export interface ViewportSize {
    readonly width: number;
    readonly height: number;
}

export interface FlyoutBounds {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
}

export interface FlyoutShift {
    readonly x: number;
    readonly y: number;
}

const viewportMargin = 8;

export function flyoutShift(
    bounds: FlyoutBounds,
    viewport: ViewportSize,
    margin = viewportMargin,
): FlyoutShift {
    return {
        x: axisShift(bounds.left, bounds.right, viewport.width, margin),
        y: axisShift(bounds.top, bounds.bottom, viewport.height, margin),
    };
}

export function positionFlyout(element: HTMLElement): void {
    element.style.removeProperty('--flyout-shift-x');
    element.style.removeProperty('--flyout-shift-y');
    const shift = flyoutShift(element.getBoundingClientRect(), {
        width: window.innerWidth,
        height: window.innerHeight,
    });
    element.style.setProperty('--flyout-shift-x', `${shift.x}px`);
    element.style.setProperty('--flyout-shift-y', `${shift.y}px`);
}

function axisShift(start: number, end: number, viewportSize: number, margin: number): number {
    const availableSize = Math.max(0, viewportSize - margin * 2);
    if (end - start >= availableSize) return margin - start;
    if (start < margin) return margin - start;
    if (end > viewportSize - margin) return viewportSize - margin - end;
    return 0;
}

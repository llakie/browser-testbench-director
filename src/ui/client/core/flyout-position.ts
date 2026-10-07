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

export type FlyoutPlacement = 'above' | 'below';
export type FlyoutAlignment = 'left' | 'right';

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
    const trigger = element.dataset.flyoutAnchorSelector
        ? document.querySelector<HTMLElement>(element.dataset.flyoutAnchorSelector)
        : element.dataset.flyoutAnchorId
        ? document.querySelector<HTMLElement>(
              `[data-testid="project-input-${CSS.escape(element.dataset.flyoutAnchorId)}-accept"]`,
          )
        : element.parentElement?.querySelector<HTMLElement>('[data-flyout-trigger]');
    const host = element.parentElement;
    const anchor = trigger?.getBoundingClientRect() ?? host?.getBoundingClientRect();
    const viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
    };

    if (anchor) {
        if (element.dataset.flyoutGlobal !== undefined) {
            positionGlobalFlyout(element, anchor, viewport);
            return;
        }

        const preferredPlacement = element.dataset.flyoutPreferredPlacement === 'above' ? 'above' : 'below';
        element.dataset.flyoutPlacement =
            element.dataset.flyoutCanFlip === 'false'
                ? preferredPlacement
                : flyoutPlacement(
                      element.getBoundingClientRect(),
                      anchor,
                      viewport,
                      preferredPlacement,
                  );

        if (element.dataset.flyoutCanAlign === 'true') {
            const preferredAlignment =
                element.dataset.flyoutPreferredAlignment === 'right' ? 'right' : 'left';
            element.dataset.flyoutAlignment = flyoutAlignment(
                element.getBoundingClientRect(),
                viewport,
                preferredAlignment,
            );
        }

        if (host) {
            const hostBounds = host.getBoundingClientRect();
            host.dataset.flyoutPlacement = element.dataset.flyoutPlacement;
            host.style.setProperty(
                '--flyout-arrow-x',
                `${anchor.left + (anchor.right - anchor.left) / 2 - hostBounds.left}px`,
            );
            host.style.setProperty(
                '--flyout-gap',
                getComputedStyle(element).getPropertyValue('--flyout-gap'),
            );
        }
    }

    const bounds = element.getBoundingClientRect();
    const shift = flyoutShift(bounds, viewport);

    element.style.setProperty('--flyout-shift-x', `${shift.x}px`);
    element.style.setProperty('--flyout-shift-y', `${shift.y}px`);

    if (anchor) {
        element.style.setProperty('--flyout-arrow-x', `${flyoutArrowX(bounds, anchor, shift)}px`);
    }
}

function positionGlobalFlyout(
    element: HTMLElement,
    anchor: FlyoutBounds,
    viewport: ViewportSize,
): void {
    element.style.left = '0px';
    element.style.top = '0px';
    element.style.maxHeight = '';
    const bounds = element.getBoundingClientRect();
    const gap = Number.parseFloat(getComputedStyle(element).getPropertyValue('--flyout-gap')) || 4;
    const belowTop = anchor.bottom + gap;
    const aboveTop = anchor.top - gap - bounds.height;
    const placeAbove = belowTop + bounds.height > viewport.height - viewportMargin && aboveTop >= viewportMargin;
    const top = placeAbove ? aboveTop : belowTop;
    const left = Math.max(viewportMargin, Math.min(anchor.left, viewport.width - bounds.width - viewportMargin));
    const availableHeight = placeAbove ? anchor.top - gap - viewportMargin : viewport.height - belowTop - viewportMargin;

    element.dataset.flyoutPlacement = placeAbove ? 'above' : 'below';
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(viewportMargin, top)}px`;
    element.style.maxHeight = `${Math.max(80, availableHeight)}px`;
    element.style.setProperty('--flyout-arrow-x', `${anchor.left + (anchor.right - anchor.left) / 2 - left}px`);
}

export function flyoutPlacement(
    flyout: FlyoutBounds,
    anchor: FlyoutBounds,
    viewport: ViewportSize,
    preferred: FlyoutPlacement,
    margin = viewportMargin,
): FlyoutPlacement {
    const belowFits = flyout.bottom <= viewport.height - margin;
    const aboveFits = flyout.top >= margin;

    if (preferred === 'below') {
        return !belowFits && aboveFits ? 'above' : 'below';
    }

    return !aboveFits && belowFits ? 'below' : 'above';
}

export function flyoutAlignment(
    flyout: FlyoutBounds,
    viewport: ViewportSize,
    preferred: FlyoutAlignment,
    margin = viewportMargin,
): FlyoutAlignment {
    const leftFits = flyout.left >= margin;
    const rightFits = flyout.right <= viewport.width - margin;

    if (preferred === 'left') {
        return !rightFits && leftFits ? 'right' : 'left';
    }

    return !leftFits && rightFits ? 'left' : 'right';
}

export function flyoutArrowX(
    flyout: FlyoutBounds,
    anchor: FlyoutBounds,
    shift: FlyoutShift,
): number {
    const width = flyout.right - flyout.left;
    const center = anchor.left + (anchor.right - anchor.left) / 2;
    const relativeCenter = center - (flyout.left + shift.x);

    return Math.max(12, Math.min(width - 12, relativeCenter));
}

function axisShift(start: number, end: number, viewportSize: number, margin: number): number {
    const availableSize = Math.max(0, viewportSize - margin * 2);

    if (end - start >= availableSize) {
        return margin - start;
    }

    if (start < margin) {
        return margin - start;
    }

    if (end > viewportSize - margin) {
        return viewportSize - margin - end;
    }

    return 0;
}

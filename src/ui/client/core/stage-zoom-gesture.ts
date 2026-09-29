interface GesturePoint {
    x: number;
    y: number;
}

export interface PanDelta {
    x: number;
    y: number;
}

export interface ZoomGestureUpdate {
    readonly zoom: number;
    readonly previousCenter: GesturePoint;
    readonly center: GesturePoint;
}

export class StagePanGesture {
    #pointerId: number | null = null;
    #point: GesturePoint = { x: 0, y: 0 };

    begin(pointerId: number, x: number, y: number): void {
        if (this.#pointerId !== null) return;
        this.#pointerId = pointerId;
        this.#point = { x, y };
    }

    move(pointerId: number, x: number, y: number, enabled: boolean): PanDelta | null {
        if (pointerId !== this.#pointerId) return null;
        const delta = { x: x - this.#point.x, y: y - this.#point.y };
        this.#point = { x, y };
        return enabled ? delta : null;
    }

    end(pointerId: number): void {
        if (pointerId === this.#pointerId) this.#pointerId = null;
    }
}

export class StageZoomGesture {
    readonly #pointers = new Map<number, GesturePoint>();
    #startDistance = 0;
    #startZoom = 1;
    #lastCenter: GesturePoint = { x: 0, y: 0 };

    constructor(private readonly sensitivity = 1.35) {}

    begin(pointerId: number, x: number, y: number, currentZoom: number): void {
        this.#pointers.set(pointerId, { x, y });
        if (this.#pointers.size !== 2) return;
        this.#startDistance = this.distance();
        this.#startZoom = currentZoom;
        this.#lastCenter = this.center();
    }

    move(pointerId: number, x: number, y: number): ZoomGestureUpdate | null {
        if (!this.#pointers.has(pointerId)) return null;
        this.#pointers.set(pointerId, { x, y });
        if (this.#pointers.size !== 2 || this.#startDistance === 0) return null;
        const center = this.center();
        const update = {
            zoom:
                this.#startZoom * Math.pow(this.distance() / this.#startDistance, this.sensitivity),
            previousCenter: this.#lastCenter,
            center,
        };
        this.#lastCenter = center;
        return update;
    }

    end(pointerId: number): void {
        this.#pointers.delete(pointerId);
        if (this.#pointers.size < 2) this.#startDistance = 0;
    }

    reset(): void {
        this.#pointers.clear();
        this.#startDistance = 0;
    }

    private distance(): number {
        const [first, second] = [...this.#pointers.values()];
        if (!first || !second) return 0;
        return Math.hypot(second.x - first.x, second.y - first.y);
    }

    private center(): GesturePoint {
        const [first, second] = [...this.#pointers.values()];
        if (!first || !second) return { x: 0, y: 0 };
        return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    }
}

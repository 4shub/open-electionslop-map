export function attachMapGestures(svg, { getViewBox, setViewBox, toMapPoint, clampWidth, getAspectRatio = () => 0.62, onInteractionStart = () => {} }) {
    const pointers = new Map();
    let gesture = null;
    let safariGesture = null;
    let blockedUntil = 0;

    const center = points => ({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + p.y, 0) / points.length });
    const distance = points => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
    const capture = id => { if (!svg.hasPointerCapture(id)) svg.setPointerCapture(id); };
    function coordinateFrame(client) {
        const anchor = toMapPoint(client.x, client.y);
        const horizontal = toMapPoint(client.x + 1, client.y);
        const vertical = toMapPoint(client.x, client.y + 1);
        return { client, anchor, view: { ...getViewBox() },
            horizontal: { x: horizontal.x - anchor.x, y: horizontal.y - anchor.y },
            vertical: { x: vertical.x - anchor.x, y: vertical.y - anchor.y } };
    }
    function apply(frame, client, width) {
        // Keep the screen-to-map transform from gesture start. Reading the SVG's
        // CTM after every viewBox write forces layout on the drag's hot path.
        const { anchor, view, horizontal, vertical } = frame;
        const dx = client.x - frame.client.x, dy = client.y - frame.client.y;
        const local = { x: anchor.x + dx * horizontal.x + dy * vertical.x,
            y: anchor.y + dx * horizontal.y + dy * vertical.y };
        width = clampWidth(width);
        setViewBox({ x: anchor.x - (local.x - view.x) / view.width * width,
            y: anchor.y - (local.y - view.y) / view.height * width * getAspectRatio(), width });
    }
    function rebase() {
        const points = [...pointers.values()].slice(0, 2);
        if (!points.length) { gesture = null; svg.classList.remove('is-dragging'); return; }
        const client = center(points);
        gesture = { ...coordinateFrame(client), width: getViewBox().width,
            distance: points.length === 2 ? distance(points) : null, moved: points.length === 2 };
        if (gesture.moved) {
            for (const id of pointers.keys()) capture(id);
            svg.classList.add('is-dragging');
        }
    }
    svg.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        onInteractionStart();
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        rebase();
    });
    svg.addEventListener('pointermove', event => {
        if (!pointers.has(event.pointerId) || !gesture) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const points = [...pointers.values()].slice(0, 2);
        const client = center(points);
        if (!gesture.moved && Math.hypot(client.x - gesture.client.x, client.y - gesture.client.y) <= 4) return;
        event.preventDefault();
        blockedUntil = Infinity;
        if (!gesture.moved) {
            gesture.moved = true;
            for (const id of pointers.keys()) capture(id);
            svg.classList.add('is-dragging');
        }
        const span = points.length === 2 ? distance(points) : null;
        apply(gesture, client, gesture.width * (span && gesture.distance ? gesture.distance / span : 1));
    });
    function endPointer(event) {
        if (!pointers.has(event.pointerId)) return;
        const moved = gesture?.moved || blockedUntil === Infinity;
        pointers.delete(event.pointerId);
        if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
        if (moved) blockedUntil = pointers.size ? Infinity : performance.now() + 250;
        rebase();
    }
    svg.addEventListener('pointerup', endPointer);
    svg.addEventListener('pointercancel', endPointer);
    // Touch starts with implicit capture on the precinct path. Transferring it
    // to the SVG bubbles a lost-capture event from that child, not a finished pan.
    svg.addEventListener('lostpointercapture', event => {
        if (event.target === svg) endPointer(event);
    });
    svg.addEventListener('wheel', event => {
        event.preventDefault();
        if (safariGesture) return;
        onInteractionStart();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? svg.clientHeight : 1;
        const factor = Math.exp(Math.max(-1, Math.min(1, event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.002))));
        const client = { x: event.clientX, y: event.clientY };
        apply(coordinateFrame(client), client, getViewBox().width * factor);
    }, { passive: false });

    // Safari trackpad pinch uses GestureEvents rather than Ctrl+wheel.
    function safariCenter(event) {
        const rect = svg.getBoundingClientRect();
        return { x: Number.isFinite(event.clientX) ? event.clientX : rect.left + rect.width / 2,
            y: Number.isFinite(event.clientY) ? event.clientY : rect.top + rect.height / 2 };
    }
    svg.addEventListener('gesturestart', event => {
        event.preventDefault();
        if (pointers.size >= 2) return;
        onInteractionStart();
        const client = safariCenter(event);
        safariGesture = { ...coordinateFrame(client), width: getViewBox().width };
    }, { passive: false });
    svg.addEventListener('gesturechange', event => {
        event.preventDefault();
        if (!safariGesture || pointers.size >= 2 || !(event.scale > 0)) return;
        apply(safariGesture, safariCenter(event), safariGesture.width / event.scale);
    }, { passive: false });
    svg.addEventListener('gestureend', () => { safariGesture = null; });
    return { isClickSuppressed: () => Boolean(gesture?.moved) || performance.now() < blockedUntil };
}

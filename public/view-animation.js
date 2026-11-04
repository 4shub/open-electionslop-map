export function createViewAnimator({ getView, render, reducedMotion = () => false, onStateChange = () => {},
    requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, now = () => performance.now() }) {
    let frame = null;
    let destination = null;
    function cancel() {
        if (frame !== null) cancelFrame(frame);
        frame = null;
        destination = null;
        onStateChange(false);
    }
    function move(target, { duration = 450 } = {}) {
        cancel();
        const from = { ...getView() };
        if (!duration || reducedMotion() || ['x', 'y', 'width', 'height'].every(key => Math.abs(from[key] - target[key]) < 0.001)) {
            render(target);
            return;
        }
        const start = now();
        destination = { ...target };
        const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
        const toCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
        const distance = Math.hypot(toCenter.x - fromCenter.x, toCenter.y - fromCenter.y);
        // Briefly widen the view when moving between distant, small districts.
        const overview = Math.max(from.width, target.width, distance * 1.3);
        const excursion = Math.log(overview / Math.max(from.width, target.width));
        onStateChange(true);
        function tick(timestamp) {
            const progress = Math.min(1, Math.max(0, (timestamp - start) / duration));
            if (progress === 1) { frame = null; destination = null; render(target); onStateChange(false); return; }
            const t = progress * progress * (3 - 2 * progress);
            const width = Math.exp(Math.log(from.width) * (1 - t) + Math.log(target.width) * t + Math.sin(Math.PI * t) * excursion);
            const height = width * target.height / target.width;
            render({ x: fromCenter.x * (1 - t) + toCenter.x * t - width / 2,
                y: fromCenter.y * (1 - t) + toCenter.y * t - height / 2, width, height });
            frame = requestFrame(tick);
        }
        frame = requestFrame(tick);
    }
    return { move, cancel, getDestination: () => destination ? { ...destination } : null };
}

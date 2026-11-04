// Fit geographic bounds into the map's 1000 × 620 coordinate system.
export function defaultViewBox(override, project) {
    if (!override) return { x: 0, y: 0, width: 1000, height: 620 };
    const [west, south, east, north] = override.bounds;
    const [left, top] = project([west, north]);
    const [right, bottom] = project([east, south]);
    const width = Math.min(1300, Math.max(90, Math.max(right - left, (bottom - top) / 0.62) * 1.06));
    const height = width * 0.62;
    return { x: (left + right - width) / 2, y: (top + bottom - height) / 2, width, height };
}

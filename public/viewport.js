function fitBounds(left, top, right, bottom, padding, minWidth) {
    const width = Math.min(1300, Math.max(minWidth, Math.max(right - left, (bottom - top) / 0.62) * padding));
    const height = width * 0.62;
    return { x: (left + right - width) / 2, y: (top + bottom - height) / 2, width, height };
}

// Fit geographic bounds into the map's 1000 × 620 coordinate system.
export function defaultViewBox(override, project) {
    if (!override) return { x: 0, y: 0, width: 1000, height: 620 };
    const [west, south, east, north] = override.bounds;
    const [left, top] = project([west, north]);
    const [right, bottom] = project([east, south]);
    return fitBounds(left, top, right, bottom, 1.06, 90);
}

export function votingAreaViewBox(features, project) {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const feature of features) {
        const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
        for (const polygon of polygons) {
            for (const ring of polygon) {
                for (const coordinate of ring) {
                    const [x, y] = project(coordinate);
                    left = Math.min(left, x); right = Math.max(right, x);
                    top = Math.min(top, y); bottom = Math.max(bottom, y);
                }
            }
        }
    }
    if (!(right > left && bottom > top)) return null;
    // Reporting bounds fill at least 83% of one view dimension, with every part visible.
    return fitBounds(left, top, right, bottom, 1.2, 1);
}

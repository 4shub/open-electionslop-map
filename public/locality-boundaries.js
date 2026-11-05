export function validateLocalityBoundaries(data) {
    const requireValue = (condition, message) => { if (!condition) throw new Error(`Locality boundaries: ${message}`); };
    requireValue(data?.type === 'FeatureCollection' && Array.isArray(data.features), 'expected a GeoJSON FeatureCollection.');
    for (const feature of data.features) {
        const geometry = feature.geometry;
        requireValue(geometry && ['Polygon', 'MultiPolygon'].includes(geometry.type), 'expected Polygon or MultiPolygon geometry.');
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        requireValue(Array.isArray(polygons) && polygons.length, 'empty geometry.');
        for (const polygon of polygons) {
            requireValue(Array.isArray(polygon) && polygon.length, 'empty polygon.');
            for (const ring of polygon) {
                requireValue(Array.isArray(ring) && ring.length >= 4, 'invalid ring.');
                requireValue(ring.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90), 'expected WGS84 coordinates.');
                requireValue(ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1], 'unclosed ring.');
            }
        }
    }
    return data;
}

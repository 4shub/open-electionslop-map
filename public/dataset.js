// The county-independent data interface. Also used by the command-line validator.
function requireValue(condition, message) {
    if (!condition) throw new Error(message);
}

export function precinctId(value, padding = 0) {
    requireValue(value !== null && value !== undefined && String(value).trim() !== '', 'A precinct ID is missing.');
    const id = String(value).trim();
    return /^\d+$/.test(id) ? id.padStart(padding, '0') : id;
}

export function boundaryId(feature, config) {
    return precinctId(config.precinctIdProperty === null
        ? feature.id : feature.properties?.[config.precinctIdProperty], config.precinctIdPadding);
}

export function visibleBoundaries(geojson, config, contest = {}) {
    if (!config.geography) return geojson.features;
    const { typeProperty, parentProperty, baseType } = config.geography;
    const type = contest.geographyType || baseType;
    return geojson.features.filter(feature => {
        const properties = feature.properties || {};
        if (type === baseType) return properties[typeProperty] === baseType;
        return (properties[typeProperty] === baseType && properties[parentProperty] !== contest.geographyParent)
            || (properties[typeProperty] === type && properties[parentProperty] === contest.geographyParent);
    });
}

export function boundaryLabel(feature, config) {
    return (config.geography && feature.properties?.[config.geography.nameProperty])
        || `Precinct ${boundaryId(feature, config)}`;
}

export function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false, endedQuote = false;
    text = text.replace(/^\uFEFF/, '');
    function finishRow() {
        row.push(cell);
        if (row.some(value => value.trim())) rows.push(row);
        row = []; cell = ''; endedQuote = false;
    }
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') { quoted = false; endedQuote = true; }
            else cell += ch;
        } else if (ch === ',') {
            row.push(cell); cell = ''; endedQuote = false;
        } else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            finishRow();
        } else if (ch === '"') {
            requireValue(!cell && !endedQuote, 'Unexpected quote in results CSV.');
            quoted = true;
        } else {
            requireValue(!endedQuote || /\s/.test(ch), 'Unexpected text after a quoted CSV field.');
            if (!endedQuote) cell += ch;
        }
    }
    requireValue(!quoted, 'Unclosed quote in results CSV.');
    finishRow();
    requireValue(rows.length > 1, 'Results CSV needs a header and at least one data row.');
    const headers = rows.shift().map(value => value.trim());
    requireValue(new Set(headers).size === headers.length, 'Duplicate results CSV headers.');
    for (const key of ['precinct', 'contest', 'candidate', 'votes']) {
        requireValue(headers.includes(key), `Results CSV is missing the "${key}" column.`);
    }
    return rows.map((values, index) => {
        requireValue(values.length === headers.length, `Results CSV row ${index + 2} has the wrong number of columns.`);
        return Object.fromEntries(headers.map((key, i) => [key, values[i].trim()]));
    });
}

export function resultsFromCsv(text, config = {}) {
    const contests = new Map();
    const precincts = new Set();
    for (const [index, row] of parseCsv(text).entries()) {
        const line = `Results CSV row ${index + 2}`;
        const id = precinctId(row.precinct, config.precinctIdPadding);
        requireValue(row.contest && row.candidate, `${line} needs a contest and candidate.`);
        const withheld = ['', 'null', 'withheld'].includes(row.votes.toLowerCase());
        requireValue(withheld || /^\d+$/.test(row.votes), `${line} votes must be a nonnegative integer, blank, or null.`);
        const votes = withheld ? null : Number(row.votes);
        requireValue(votes === null || Number.isSafeInteger(votes), `${line} has an invalid vote count.`);
        const type = row.type || 'Candidate';
        let contest = contests.get(row.contest);
        if (!contest) {
            contest = { id: row.contest, name: row.contest, shortName: row.contest, type, choices: new Map(), precincts: new Map() };
            contests.set(row.contest, contest);
        }
        requireValue(contest.type === type, `${line} has an inconsistent contest type.`);
        let choice = contest.choices.get(row.candidate);
        if (!choice) {
            choice = { id: row.candidate, name: row.candidate, party: row.party || '', color: row.color || null, votes: null };
            contest.choices.set(row.candidate, choice);
        }
        requireValue(choice.party === (row.party || '') && choice.color === (row.color || null), `${line} has inconsistent candidate metadata.`);
        if (!contest.precincts.has(id)) contest.precincts.set(id, new Map());
        const counts = contest.precincts.get(id);
        requireValue(!counts.has(row.candidate), `${line} repeats a precinct/contest/candidate. Aggregate voting methods before importing.`);
        counts.set(row.candidate, votes);
        if (votes !== null) choice.votes = (choice.votes ?? 0) + votes;
        precincts.add(id);
    }
    return {
        election: config.election || {},
        sources: config.sources || {},
        precincts: [...precincts],
        contests: [...contests.values()].map(contest => ({
            ...contest,
            choices: [...contest.choices.values()],
            precincts: Object.fromEntries([...contest.precincts].map(([id, counts]) => [id,
                [...contest.choices.keys()].map(candidate => counts.get(candidate) ?? null)])),
        })),
    };
}

export function parseResults(text, config) {
    return (config.resultsFormat || (String(config.results).split('?')[0].endsWith('.csv') ? 'csv' : 'json')) === 'csv'
        ? resultsFromCsv(text, config) : JSON.parse(text);
}

export function prepareDataset(rawConfig, rawResults, geojson) {
    const config = { precinctIdProperty: 'precinct', precinctIdPadding: 0, ...rawConfig };
    requireValue(typeof config.title === 'string' && config.title.trim(), 'Map config needs a title.');
    if (config.siteLink !== undefined) {
        requireValue(typeof config.siteLink?.label === 'string' && config.siteLink.label.trim() && typeof config.siteLink.href === 'string' && config.siteLink.href.trim(), 'siteLink needs a label and href.');
        let url;
        try { url = new URL(config.siteLink.href, 'https://map.example/'); } catch { /* Validated below. */ }
        requireValue(url && ['http:', 'https:'].includes(url.protocol), 'siteLink href must be an HTTP(S) or relative URL.');
    }
    requireValue(config.precinctIdProperty === null || typeof config.precinctIdProperty === 'string', 'precinctIdProperty must be a property name or null for feature.id.');
    requireValue(Number.isInteger(config.precinctIdPadding) && config.precinctIdPadding >= 0 && config.precinctIdPadding <= 32, 'precinctIdPadding must be between 0 and 32.');
    if (config.geography) {
        requireValue(['typeProperty', 'parentProperty', 'nameProperty', 'baseType'].every(key =>
            typeof config.geography[key] === 'string' && config.geography[key]), 'geography needs typeProperty, parentProperty, nameProperty, and baseType.');
    }
    requireValue(geojson.type === 'FeatureCollection' && Array.isArray(geojson.features) && geojson.features.length, 'Boundaries must be a nonempty GeoJSON FeatureCollection.');
    const boundaryIds = new Set();
    const extent = [Infinity, Infinity, -Infinity, -Infinity];
    for (const feature of geojson.features) {
        const id = boundaryId(feature, config);
        requireValue(!boundaryIds.has(id), `Duplicate boundary precinct ID "${id}".`);
        boundaryIds.add(id);
        const geometry = feature.geometry;
        requireValue(geometry && ['Polygon', 'MultiPolygon'].includes(geometry.type), `Precinct ${id} needs Polygon or MultiPolygon geometry.`);
        const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
        requireValue(Array.isArray(polygons) && polygons.length, `Precinct ${id} has empty geometry.`);
        for (const polygon of polygons) {
            requireValue(Array.isArray(polygon) && polygon.length, `Precinct ${id} has an empty polygon.`);
            for (const ring of polygon) {
                requireValue(Array.isArray(ring) && ring.length >= 4, `Precinct ${id} has an invalid polygon ring.`);
                for (const point of ring) {
                    requireValue(Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90, `Precinct ${id} needs WGS84 longitude/latitude coordinates.`);
                    extent[0] = Math.min(extent[0], point[0]); extent[1] = Math.min(extent[1], point[1]);
                    extent[2] = Math.max(extent[2], point[0]); extent[3] = Math.max(extent[3], point[1]);
                }
                requireValue(ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1], `Precinct ${id} has an unclosed polygon ring.`);
            }
        }
    }
    requireValue(extent[2] > extent[0] && extent[3] > extent[1], 'Boundary geometry has no geographic extent.');
    requireValue(Array.isArray(rawResults.contests) && rawResults.contests.length, 'Results need at least one contest.');
    const contestIds = new Set();
    const resultIds = new Set();
    const validVotes = value => value === null || (Number.isSafeInteger(value) && value >= 0);
    const contests = rawResults.contests.map(contest => {
        requireValue(contest.id && !contestIds.has(String(contest.id)), 'Contest IDs must be nonempty and unique.');
        contestIds.add(String(contest.id));
        requireValue(typeof contest.name === 'string' && contest.name && Array.isArray(contest.choices) && contest.choices.length, `Contest ${contest.id} needs a name and choices.`);
        const choices = contest.choices.map(choice => {
            requireValue(typeof choice.name === 'string' && choice.name && validVotes(choice.votes), `Contest ${contest.id} has an invalid choice name or vote count.`);
            requireValue(!choice.color || /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(choice.color), `Choice ${choice.name} color must be a hex color.`);
            return { ...choice, party: choice.party || '' };
        });
        requireValue(new Set(choices.map(choice => choice.id || choice.name)).size === choices.length, `Contest ${contest.id} has duplicate choices.`);
        requireValue(contest.precincts && typeof contest.precincts === 'object' && !Array.isArray(contest.precincts), `Contest ${contest.id} needs a precinct vote object.`);
        const seen = new Set();
        const precincts = Object.fromEntries(Object.entries(contest.precincts).map(([rawId, votes]) => {
            const id = precinctId(rawId, config.precinctIdPadding);
            requireValue(boundaryIds.has(id), `Result precinct "${id}" has no boundary. Check precinctIdProperty and precinctIdPadding.`);
            requireValue(!seen.has(id), `Duplicate result precinct "${id}" after ID normalization.`);
            requireValue(Array.isArray(votes) && votes.length === choices.length && votes.every(validVotes), `Contest ${contest.id}, precinct ${id}: votes must align with choices and contain nonnegative integers or null.`);
            seen.add(id); resultIds.add(id);
            return [id, votes];
        }));
        return { ...contest, id: String(contest.id), shortName: contest.shortName || contest.name, type: contest.type || 'Candidate', choices, precincts };
    });
    if (rawResults.precincts !== undefined) {
        requireValue(Array.isArray(rawResults.precincts), 'Results precincts must be an array of IDs.');
        const declared = new Set(rawResults.precincts.map(id => precinctId(id, config.precinctIdPadding)));
        requireValue(declared.size === rawResults.precincts.length, 'Results contain duplicate declared precinct IDs.');
        requireValue([...declared].every(id => boundaryIds.has(id)), 'A declared result precinct has no boundary.');
        requireValue([...resultIds].every(id => declared.has(id)), 'A contest precinct is missing from the declared precinct IDs.');
    }
    if (config.geography) {
        for (const contest of contests) {
            const visible = new Set(visibleBoundaries(geojson, config, contest).map(feature => boundaryId(feature, config)));
            requireValue(visible.size && Object.keys(contest.precincts).every(id => visible.has(id)), `Contest ${contest.id} results do not match its geography layer.`);
        }
    }
    const election = { ...rawResults.election, ...config.election };
    requireValue(!election.lastUpdated || Number.isFinite(Date.parse(election.lastUpdated)), 'election.lastUpdated must be a valid date.');
    const sources = { ...rawResults.sources, ...config.sources };
    for (const source of Object.values(sources)) {
        requireValue(typeof source === 'string' && /^https?:\/\//i.test(source), 'Source links must be HTTP or HTTPS URLs.');
    }
    return { config, results: { ...rawResults, election, sources, contests }, geojson };
}

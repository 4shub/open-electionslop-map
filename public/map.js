const RESULTS_DATA_URL = './data/sacramento-2026-results.json';
const PRECINCTS_URL = './data/sacramento-2026-precincts.geojson';
const FALLBACK_COLORS = [
    'var(--alt-background-color)',
    'var(--font-muted-color)',
    'var(--added-text-color)',
    'var(--removed-text-color)',
];

const app = document.querySelector('[data-election-map]');
const contestSelect = app.querySelector('[data-contest]');
const contestDetails = app.querySelector('[data-contest-details]');
const contestTitle = app.querySelector('[data-contest-title]');
const contestSummary = app.querySelector('[data-contest-summary]');
const electionStatus = app.querySelector('[data-election-status]');
const resultList = app.querySelector('[data-results]');
const svg = app.querySelector('[data-map]');
const layer = app.querySelector('[data-precinct-layer]');
const mapStatus = app.querySelector('[data-map-status]');
const loading = app.querySelector('[data-loading]');
const number = new Intl.NumberFormat('en-US');
const percent = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pathByPrecinct = new Map();

let contestSummaries = [];
let currentContest = null;
let currentPrecinctResults = new Map();
let selectedPrecinct = null;
let hoveredPrecinct = null;
let selectedPath = null;
let requestNumber = 0;
let viewBox = { x: 0, y: 0, width: 1000, height: 620 };
let drag = null;
let ignoreClick = false;

function cookieTheme() {
    const value = document.cookie.split(';').find(cookie => cookie.trim().startsWith('theme='));
    return value ? value.split('=')[1] : 'system';
}

function syncTheme() {
    let theme = cookieTheme();
    try {
        if (window.parent !== window && window.parent.document.body.dataset.theme) {
            theme = window.parent.document.body.dataset.theme;
        }
    } catch (error) {
        // The standalone map still follows the shared theme cookie.
    }
    document.body.dataset.theme = theme;
}

syncTheme();
try {
    if (window.parent !== window) {
        new MutationObserver(syncTheme).observe(window.parent.document.body, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });
    }
} catch (error) {
    // Cross-origin embeds cannot observe their parent document.
}

function textOf(value) {
    if (!Array.isArray(value)) return '';
    return value.find(item => item.languageId === 'en')?.text || value[0]?.text || '';
}

function precinctName(value) {
    return String(value).padStart(7, '0');
}

function candidateColor(choice, index, contestType, choices) {
    if (contestType === 'BallotMeasure') {
        return index === 0 ? '#2e8b57' : '#7e57c2';
    }
    if (choices.length > 1 && choices.every(candidate => candidate.party === 'DEM')) {
        return index === 0 ? '#e3b505' : '#e76f00';
    }
    if (choices.length > 1 && choices.every(candidate => !candidate.party)) {
        return ['#e3b505', '#e76f00', '#2e8b57'][index % 3];
    }
    if (choice.color) return choice.color;
    return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function setViewBox(next) {
    const minWidth = 90;
    const maxWidth = 1300;
    const width = Math.min(maxWidth, Math.max(minWidth, next.width));
    const height = width * 0.62;
    viewBox = { x: next.x, y: next.y, width, height };
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
}

function zoom(factor, centerX = viewBox.x + viewBox.width / 2, centerY = viewBox.y + viewBox.height / 2) {
    const width = viewBox.width * factor;
    const height = viewBox.height * factor;
    const ratioX = (centerX - viewBox.x) / viewBox.width;
    const ratioY = (centerY - viewBox.y) / viewBox.height;
    setViewBox({
        x: centerX - width * ratioX,
        y: centerY - height * ratioY,
        width,
    });
}

function resetMap() {
    setViewBox({ x: 0, y: 0, width: 1000, height: 620 });
}

function mercatorY(latitude) {
    const radians = latitude * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function mercatorX(longitude) {
    return longitude * Math.PI / 180;
}

function eachCoordinate(coordinates, callback) {
    if (typeof coordinates[0] === 'number') {
        callback(coordinates);
        return;
    }
    coordinates.forEach(value => eachCoordinate(value, callback));
}

function makeProjection(features) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    features.forEach(feature => eachCoordinate(feature.geometry.coordinates, ([longitude, latitude]) => {
        const x = mercatorX(longitude);
        const y = mercatorY(latitude);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    }));

    const padding = 18;
    const width = 1000 - padding * 2;
    const height = 620 - padding * 2;
    const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
    const drawnWidth = (maxX - minX) * scale;
    const drawnHeight = (maxY - minY) * scale;
    const offsetX = padding + (width - drawnWidth) / 2;
    const offsetY = padding + (height - drawnHeight) / 2;

    return ([longitude, latitude]) => [
        offsetX + (mercatorX(longitude) - minX) * scale,
        offsetY + (maxY - mercatorY(latitude)) * scale,
    ];
}

function ringPath(ring, project) {
    return ring.map((coordinate, index) => {
        const [x, y] = project(coordinate);
        return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join('') + 'Z';
}

function geometryPath(geometry, project) {
    if (geometry.type === 'Polygon') {
        return geometry.coordinates.map(ring => ringPath(ring, project)).join('');
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.flatMap(polygon => polygon.map(ring => ringPath(ring, project))).join('');
    }
    return '';
}

function totalVotes(choices) {
    return choices.reduce((sum, choice) => sum + (choice.votes || 0), 0);
}

function winnerIndex(choices) {
    return choices.reduce((best, choice, index) => {
        if (choice.votes === null) return best;
        return best === -1 || choice.votes > choices[best].votes ? index : best;
    }, -1);
}

function createResultRow(choice, total) {
    const item = document.createElement('li');
    const label = document.createElement('div');
    const name = document.createElement('span');
    const count = document.createElement('span');
    const track = document.createElement('div');
    const bar = document.createElement('div');
    const share = total > 0 && choice.votes !== null ? choice.votes / total * 100 : 0;

    item.className = 'result-row';
    label.className = 'result-label';
    name.className = 'result-name';
    count.className = 'result-count';
    track.className = 'result-track';
    bar.className = 'result-bar';
    name.textContent = choice.party ? `${choice.name} · ${choice.party}` : choice.name;
    count.textContent = choice.votes === null ? 'Withheld' : `${percent.format(share)}% · ${number.format(choice.votes)}`;
    bar.style.setProperty('--result-percent', `${share}%`);
    bar.style.setProperty('--result-color', choice.color);
    label.append(name, count);
    track.append(bar);
    item.append(label, track);
    return item;
}

function renderCountywideResults(contest) {
    const choices = contest.choices.map((choice, index, choices) => ({
        ...choice,
        color: candidateColor(choice, index, contest.type, choices),
    }));
    const total = totalVotes(choices);
    const winner = winnerIndex(choices);
    const sorted = choices.filter(choice => choice.votes !== null).toSorted((a, b) => b.votes - a.votes);
    const margin = sorted.length > 1 && total > 0 ? (sorted[0].votes - sorted[1].votes) / total * 100 : null;

    contestTitle.textContent = contest.name;
    contestSummary.textContent = winner >= 0
        ? `${choices[winner].name} leads countywide${margin === null ? '' : ` by ${percent.format(margin)} points`} · ${number.format(total)} votes reported`
        : 'No countywide result has been reported.';
    resultList.replaceChildren(...choices.map(choice => createResultRow(choice, total)));
}

function clearMapClasses(path) {
    path.classList.remove('is-withheld', 'is-zero');
    path.style.removeProperty('--precinct-color');
    path.style.removeProperty('--precinct-strength');
}

function renderMapColors() {
    pathByPrecinct.forEach((path, id) => {
        clearMapClasses(path);
        const result = currentPrecinctResults.get(id);
        if (!result) {
            path.classList.add('is-zero');
            return;
        }

        const choices = result.choices;
        if (choices.length === 0 || choices.some(choice => choice.votes === null)) {
            path.classList.add('is-withheld');
            return;
        }

        const total = totalVotes(choices);
        if (total === 0) {
            path.classList.add('is-zero');
            return;
        }

        const winner = winnerIndex(choices);
        const sortedVotes = choices.map(choice => choice.votes).toSorted((a, b) => b - a);
        const margin = sortedVotes.length > 1 ? (sortedVotes[0] - sortedVotes[1]) / total * 100 : 100;
        const strength = Math.min(92, Math.max(34, 34 + margin * 0.75));
        path.style.setProperty('--precinct-color', choices[winner].color);
        path.style.setProperty('--precinct-strength', `${strength}%`);
    });
}

function defaultMapStatus() {
    mapStatus.replaceChildren();
    const title = document.createElement('strong');
    const help = document.createElement('p');
    title.className = 'map-status-title';
    help.className = 'map-help';
    title.textContent = `${number.format(pathByPrecinct.size)} official precinct boundaries`;
    help.textContent = currentContest ? 'Hover over a precinct or select it for detailed results.' : 'Loading contest results…';
    mapStatus.append(title, help);
}

function renderPrecinctStatus(id) {
    const result = currentPrecinctResults.get(id);
    mapStatus.replaceChildren();
    const title = document.createElement('strong');
    title.className = 'map-status-title';
    title.textContent = `Precinct ${id}`;
    mapStatus.append(title);

    if (!result) {
        mapStatus.append('This contest was not on the precinct ballot.');
        return;
    }
    if (result.choices.some(choice => choice.votes === null)) {
        mapStatus.append('Vote totals were withheld by Sacramento County.');
        return;
    }

    const total = totalVotes(result.choices);
    if (total === 0) {
        mapStatus.append('No votes have been reported for this contest.');
        return;
    }

    result.choices.forEach(choice => {
        const row = document.createElement('div');
        const name = document.createElement('span');
        const count = document.createElement('span');
        row.className = 'precinct-result';
        name.textContent = choice.name;
        count.textContent = `${number.format(choice.votes)} · ${percent.format(choice.votes / total * 100)}%`;
        row.append(name, count);
        mapStatus.append(row);
    });
}

function updateMapStatus() {
    const id = hoveredPrecinct || selectedPrecinct;
    if (id) renderPrecinctStatus(id);
    else defaultMapStatus();
}

async function selectContest(contest) {
    const thisRequest = ++requestNumber;
    contestDetails.setAttribute('aria-busy', 'true');
    contestTitle.textContent = contest.shortName;
    contestSummary.textContent = 'Loading precinct results…';
    resultList.replaceChildren();

    try {
        const detail = contest;
        if (thisRequest !== requestNumber) return;
        currentContest = detail;
        currentPrecinctResults = new Map(Object.entries(detail.precincts).map(([id, votes]) => [id, {
            choices: detail.choices.map((choice, index) => ({
                ...choice,
                votes: votes[index],
                color: candidateColor(choice, index, detail.type, detail.choices),
            })),
        }]));
        renderCountywideResults(detail);
        renderMapColors();
        updateMapStatus();
    } catch (error) {
        if (thisRequest !== requestNumber) return;
        contestTitle.textContent = 'Results unavailable';
        contestSummary.textContent = 'Sacramento County’s contest service could not be loaded.';
        console.error(error);
    } finally {
        if (thisRequest === requestNumber) contestDetails.setAttribute('aria-busy', 'false');
    }
}

function populateContestSelect(items) {
    contestSummaries = items;
    const offices = document.createElement('optgroup');
    const propositions = document.createElement('optgroup');
    offices.label = 'Statewide offices';
    propositions.label = 'Statewide propositions';

    contestSummaries.forEach(contest => {
        const option = document.createElement('option');
        option.value = contest.id;
        option.textContent = contest.shortName;
        (contest.name.startsWith('Proposition ') ? propositions : offices).append(option);
    });

    contestSelect.replaceChildren(offices, propositions);
    contestSelect.disabled = false;
}

function drawMap(geojson) {
    const features = geojson.features.filter(feature => feature.geometry);
    const project = makeProjection(features);
    const fragment = document.createDocumentFragment();

    features.forEach(feature => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const id = precinctName(feature.properties.VPrecinct);
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        path.classList.add('precinct');
        path.dataset.precinct = id;
        path.setAttribute('d', geometryPath(feature.geometry, project));
        path.setAttribute('fill-rule', 'evenodd');
        title.textContent = `Precinct ${id}`;
        path.append(title);
        path.addEventListener('pointerenter', () => {
            hoveredPrecinct = id;
            updateMapStatus();
        });
        path.addEventListener('pointerleave', () => {
            hoveredPrecinct = null;
            updateMapStatus();
        });
        path.addEventListener('click', event => {
            event.stopPropagation();
            if (ignoreClick) return;
            selectedPath?.classList.remove('is-selected');
            if (selectedPrecinct === id) {
                selectedPrecinct = null;
                selectedPath = null;
            } else {
                selectedPrecinct = id;
                selectedPath = path;
                path.classList.add('is-selected');
            }
            updateMapStatus();
        });
        pathByPrecinct.set(id, path);
        fragment.append(path);
    });

    layer.append(fragment);
}

async function initialize() {
    try {
        const [resultResponse, boundaryResponse] = await Promise.all([
            fetch(RESULTS_DATA_URL),
            fetch(PRECINCTS_URL),
        ]);
        if (!resultResponse.ok) throw new Error(`Results service returned ${resultResponse.status}`);
        if (!boundaryResponse.ok) throw new Error(`Boundary service returned ${boundaryResponse.status}`);

        const [resultData, geojson] = await Promise.all([
            resultResponse.json(),
            boundaryResponse.json(),
        ]);
        const resultIds = new Set(resultData.precincts);
        const geometryIds = new Set(geojson.features.map(feature => precinctName(feature.properties.VPrecinct)));
        if (resultIds.size !== geometryIds.size || [...resultIds].some(id => !geometryIds.has(id))) {
            throw new Error('Official result precincts do not match the official boundary layer.');
        }

        drawMap(geojson);
        populateContestSelect(resultData.contests);
        const updated = new Date(resultData.election.lastUpdated);
        electionStatus.dateTime = resultData.election.lastUpdated;
        electionStatus.textContent = `Updated at ${updated.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
        loading.hidden = true;
        defaultMapStatus();
        await selectContest(contestSummaries[0]);
    } catch (error) {
        loading.textContent = 'The official Sacramento County election data could not be loaded.';
        contestTitle.textContent = 'Data unavailable';
        contestSummary.textContent = 'Try the official results link or reload this map.';
        electionStatus.textContent = 'Official data unavailable';
        console.error(error);
    }
}

contestSelect.addEventListener('change', () => {
    const contest = contestSummaries.find(item => item.id === contestSelect.value);
    if (contest) selectContest(contest);
});

app.querySelector('[data-zoom-in]').addEventListener('click', () => zoom(0.72));
app.querySelector('[data-zoom-out]').addEventListener('click', () => zoom(1.38));
app.querySelector('[data-reset]').addEventListener('click', resetMap);

svg.addEventListener('wheel', event => {
    event.preventDefault();
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    zoom(event.deltaY > 0 ? 1.18 : 0.84, local.x, local.y);
}, { passive: false });

svg.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = {
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        moved: false,
        viewBox: { ...viewBox },
    };
});

svg.addEventListener('pointermove', event => {
    if (!drag) return;
    const rect = svg.getBoundingClientRect();
    const deltaX = (event.clientX - drag.x) / rect.width * drag.viewBox.width;
    const deltaY = (event.clientY - drag.y) / rect.height * drag.viewBox.height;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
        drag.moved = true;
        ignoreClick = true;
        svg.setPointerCapture(drag.pointerId);
        svg.classList.add('is-dragging');
    }
    if (!drag.moved) return;
    setViewBox({
        x: drag.viewBox.x - deltaX,
        y: drag.viewBox.y - deltaY,
        width: drag.viewBox.width,
    });
});

function endDrag(event) {
    if (!drag) return;
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    drag = null;
    svg.classList.remove('is-dragging');
    window.setTimeout(() => { ignoreClick = false; }, 0);
}

svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);
svg.addEventListener('click', event => {
    if (event.target !== svg || ignoreClick) return;
    selectedPath?.classList.remove('is-selected');
    selectedPath = null;
    selectedPrecinct = null;
    updateMapStatus();
});

initialize();

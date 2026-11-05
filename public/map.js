import { boundaryId, boundaryLabel, parseResults, prepareDataset, visibleBoundaries } from './dataset.js';
import { defaultViewBox, votingAreaViewBox } from './viewport.js';
import { attachMapGestures } from './gestures.js';
import { createViewAnimator } from './view-animation.js';
import { formatUpdated, contestMetadata } from './metadata.js';

let mapConfig = {};
let mapResults = {};
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
const resultsPanel = app.querySelector('.results-panel');
const resultsToggle = app.querySelector('[data-results-toggle]');
const mobileMapStatus = app.querySelector('[data-mobile-map-status]');
const number = new Intl.NumberFormat('en-US');
const percent = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pathByPrecinct = new Map();
const boundaryLabels = new Map();
let allBoundaries = null;
let mapFeatures = [];
let mapProjection = null;
let geographyKey = null;

let contestSummaries = [];
let currentContest = null;
let currentPrecinctResults = new Map();
let selectedPrecinct = null;
let hoveredPrecinct = null;
let selectedPath = null;
let requestNumber = 0;
let viewBox = { x: 0, y: 0, width: 1000, height: 620 };
let initialViewBox = { ...viewBox };
let mapAspect = 0.62;

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

function clampWidth(value) {
    const minWidth = Math.min(90, initialViewBox.width / 4);
    const maxWidth = Math.max(1300, initialViewBox.width * 1.3);
    return Math.min(maxWidth, Math.max(minWidth, value));
}

function paintViewBox(next) {
    const width = next.width;
    const height = width * mapAspect;
    viewBox = { x: next.x, y: next.y, width, height };
    svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
}

function setViewBox(next) {
    viewAnimator.cancel();
    paintViewBox({ ...next, width: clampWidth(next.width) });
}

function moveToView(next, { duration = 450 } = {}) {
    const width = clampWidth(next.width);
    viewAnimator.move({ ...next, width, height: width * mapAspect }, { duration });
}

function zoom(factor, centerX = viewBox.x + viewBox.width / 2, centerY = viewBox.y + viewBox.height / 2) {
    const width = clampWidth(viewBox.width * factor);
    const height = width * mapAspect;
    const ratioX = (centerX - viewBox.x) / viewBox.width;
    const ratioY = (centerY - viewBox.y) / viewBox.height;
    moveToView({
        x: centerX - width * ratioX,
        y: centerY - height * ratioY,
        width,
    }, { duration: 220 });
}

function resetMap() {
    moveToView(initialViewBox);
}

function updateInitialView() {
    const votingFeatures = mapConfig.autoMoveToVotingArea && currentContest
        ? mapFeatures.filter(feature => Object.hasOwn(currentContest.precincts, boundaryId(feature, mapConfig))) : [];
    initialViewBox = votingAreaViewBox(votingFeatures, mapProjection, mapAspect)
        || defaultViewBox(mapConfig.defaultZoomOverride, mapProjection, mapAspect);
}

function mercatorY(latitude) {
    const radians = Math.max(-85, Math.min(85, latitude)) * Math.PI / 180;
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
        ? `${choices[winner].name} leads ${contest.reportingAreaLabel || 'countywide'}${margin === null ? '' : ` by ${percent.format(margin)} points`} · ${number.format(total)} votes reported`
        : `No ${contest.reportingAreaLabel || 'countywide'} result has been reported.`;
    resultList.replaceChildren(...choices.map(choice => createResultRow(choice, total)));
    const scope = contest.reportingAreaLabel || 'countywide';
    app.querySelector('[data-results-heading]').textContent = `${scope.charAt(0).toUpperCase() + scope.slice(1)} results`;
    const compact = app.querySelector('[data-compact-results]');
    const topChoices = [...choices].sort((a, b) => (b.votes ?? -1) - (a.votes ?? -1)).slice(0, 2);
    compact.replaceChildren(...topChoices.map(choice => {
        const item = document.createElement('span');
        item.className = 'compact-choice';
        const swatch = document.createElement('span');
        swatch.className = 'choice-swatch';
        swatch.style.setProperty('--choice-color', choice.color);
        swatch.setAttribute('aria-hidden', 'true');
        const name = document.createElement('span');
        name.className = 'compact-choice-name';
        name.textContent = choice.name;
        const count = document.createElement('span');
        count.className = 'compact-choice-count';
        count.textContent = choice.votes === null ? 'Withheld' : total > 0 ? `${percent.format(choice.votes / total * 100)}%` : '—';
        item.append(swatch, name, count);
        return item;
    }));
    if (choices.length > 2) {
        const more = document.createElement('span');
        more.className = 'compact-more';
        more.textContent = `+${choices.length - 2} more`;
        compact.append(more);
    }
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
    title.textContent = `${number.format(pathByPrecinct.size)} ${mapConfig.boundariesLabel || 'precinct boundaries'}`;
    help.textContent = currentContest ? `Hover over ${mapConfig.geography ? 'an area' : 'a precinct'} or select it for detailed results.` : 'Loading contest results…';
    mapStatus.append(title, help);
}

function renderPrecinctStatus(id) {
    const result = currentPrecinctResults.get(id);
    mapStatus.replaceChildren();
    const title = document.createElement('strong');
    title.className = 'map-status-title';
    title.textContent = boundaryLabels.get(id) || `Precinct ${id}`;
    mapStatus.append(title);

    if (!result) {
        mapStatus.append(mapConfig.geography ? 'No results are available for this area in this snapshot.' : 'This contest was not on the precinct ballot.');
        return;
    }
    if (result.choices.some(choice => choice.votes === null)) {
        mapStatus.append(`Vote totals were withheld by ${mapConfig.countyName || 'the reporting authority'}.`);
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
    mobileMapStatus.hidden = !id;
    mobileMapStatus.replaceChildren(...[...mapStatus.childNodes].map(node => node.cloneNode(true)));
}

function expandResults(expanded) {
    resultsPanel.classList.toggle('is-expanded', expanded);
    resultsToggle.setAttribute('aria-expanded', String(expanded));
}

async function selectContest(contest) {
    const thisRequest = ++requestNumber;
    contestDetails.setAttribute('aria-busy', 'true');
    contestTitle.textContent = contest.group ? contest.name : contest.shortName;
    contestSummary.textContent = 'Loading results…';
    resultList.replaceChildren();

    try {
        const detail = contest;
        if (thisRequest !== requestNumber) return;
        currentContest = detail;
        const hadMap = geographyKey !== null;
        const type = detail.geographyType || mapConfig.geography?.baseType;
        const nextKey = !mapConfig.geography ? 'all'
            : type === mapConfig.geography.baseType ? type
            : `${type}:${detail.geographyParent ?? 'all'}`;
        const layerChanged = geographyKey !== nextKey;
        if (layerChanged) {
            selectedPrecinct = hoveredPrecinct = selectedPath = null;
            drawMap({ type: 'FeatureCollection', features: visibleBoundaries(allBoundaries, mapConfig, detail) });
            geographyKey = nextKey;
        }
        currentPrecinctResults = new Map(Object.entries(detail.precincts).map(([id, votes]) => [id, {
            choices: detail.choices.map((choice, index) => ({
                ...choice,
                votes: votes[index],
                color: candidateColor(choice, index, detail.type, detail.choices),
            })),
        }]));
        if (mapConfig.autoMoveToVotingArea) {
            selectedPath?.classList.remove('is-selected');
            selectedPrecinct = hoveredPrecinct = selectedPath = null;
            updateInitialView();
        }
        if (mapConfig.autoMoveToVotingArea || layerChanged) moveToView(initialViewBox, { duration: hadMap ? 450 : 0 });
        renderCountywideResults(detail);
        const metadata = contestMetadata(mapConfig, mapResults, detail);
        const note = app.querySelector('[data-map-note]');
        note.textContent = metadata.note;
        note.hidden = !metadata.note;
        app.querySelectorAll('[data-source]').forEach(link => {
            const url = metadata.sources[link.dataset.source];
            link.hidden = !url;
            if (url) link.href = url;
            else link.removeAttribute('href');
        });
        const mobileUpdated = app.querySelector('[data-mobile-election-status]');
        mobileUpdated.textContent = formatUpdated(metadata.lastUpdated, mapConfig.timeZone);
        if (metadata.lastUpdated) mobileUpdated.dateTime = metadata.lastUpdated;
        else mobileUpdated.removeAttribute('datetime');
        renderMapColors();
        updateMapStatus();
    } catch (error) {
        if (thisRequest !== requestNumber) return;
        contestTitle.textContent = 'Results unavailable';
        contestSummary.textContent = 'This contest could not be loaded.';
        console.error(error);
    } finally {
        if (thisRequest === requestNumber) contestDetails.setAttribute('aria-busy', 'false');
    }
}

function populateContestSelect(items) {
    contestSummaries = items;
    const offices = document.createElement('optgroup');
    const propositions = document.createElement('optgroup');
    offices.label = mapConfig.contestGroups?.offices || 'Offices';
    propositions.label = mapConfig.contestGroups?.measures || 'Ballot measures';

    const customGroups = new Map();
    contestSummaries.forEach(contest => {
        const option = document.createElement('option');
        option.value = contest.id;
        option.textContent = contest.group ? contest.name : contest.shortName;
        if (contest.group) {
            if (!customGroups.has(contest.group)) {
                const group = document.createElement('optgroup');
                group.label = contest.group;
                customGroups.set(contest.group, group);
            }
            customGroups.get(contest.group).append(option);
        } else (contest.type === 'BallotMeasure' ? propositions : offices).append(option);
    });

    const groups = [offices, propositions, ...customGroups.values()].filter(group => group.children.length);
    contestSelect.replaceChildren(...(groups.length === 1 ? [...groups[0].children] : groups));
    contestSelect.disabled = false;
    finishContestLoading();
}

function finishContestLoading(error = '') {
    const control = app.querySelector('[data-contest-control]');
    control.removeAttribute('data-contest-loading');
    control.setAttribute('aria-busy', 'false');
    app.querySelector('#contest-loading').textContent = error;
    if (!error) contestSelect.removeAttribute('aria-describedby');
    else contestSelect.options[0].textContent = error;
}

function drawMap(geojson) {
    layer.replaceChildren();
    pathByPrecinct.clear();
    boundaryLabels.clear();
    const features = geojson.features.filter(feature => feature.geometry);
    const project = mapProjection || makeProjection(allBoundaries.features);
    mapFeatures = features;
    mapProjection = project;
    const rect = svg.getBoundingClientRect();
    mapAspect = rect.width > 0 && rect.height > 0 ? rect.height / rect.width : 0.62;
    initialViewBox = defaultViewBox(mapConfig.defaultZoomOverride, project, mapAspect);
    const fragment = document.createDocumentFragment();

    features.forEach(feature => {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const id = boundaryId(feature, mapConfig);
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        path.classList.add('precinct');
        path.dataset.precinct = id;
        path.setAttribute('d', geometryPath(feature.geometry, project));
        path.setAttribute('fill-rule', 'evenodd');
        const label = boundaryLabel(feature, mapConfig);
        title.textContent = label;
        boundaryLabels.set(id, label);
        path.append(title);
        path.addEventListener('pointerenter', event => {
            if (event.pointerType === 'touch') return;
            hoveredPrecinct = id;
            updateMapStatus();
        });
        path.addEventListener('pointerleave', () => {
            hoveredPrecinct = null;
            updateMapStatus();
        });
        path.addEventListener('click', event => {
            event.stopPropagation();
            if (gestures.isClickSuppressed()) return;
            selectedPath?.classList.remove('is-selected');
            if (selectedPrecinct === id) {
                selectedPrecinct = null;
                selectedPath = null;
            } else {
                selectedPrecinct = id;
                selectedPath = path;
                path.classList.add('is-selected');
                if (window.matchMedia('(max-width: 720px)').matches) expandResults(true);
            }
            updateMapStatus();
        });
        pathByPrecinct.set(id, path);
        fragment.append(path);
    });

    layer.append(fragment);
}

async function fetchText(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url.pathname}: HTTP ${response.status}`);
    return response.text();
}

function applyMetadata(results) {
    mapResults = results;
    // Built pages already contain their final header. Hydrate only raw developer previews.
    if (!app.querySelector('.election-header').hasAttribute('data-metadata-ready') || new URLSearchParams(location.search).has('config')) {
        document.title = mapConfig.title;
        app.querySelector('[data-map-heading]').textContent = mapConfig.title;
        app.querySelector('[data-map-heading]').title = mapConfig.title;
        const siteLink = app.querySelector('[data-site-link]');
        const siteSeparator = app.querySelector('[data-site-separator]');
        siteLink.hidden = siteSeparator.hidden = !mapConfig.siteLink;
        if (mapConfig.siteLink) {
            siteLink.textContent = mapConfig.siteLink.label;
            siteLink.href = mapConfig.siteLink.href;
        }
        const updated = results.election.lastUpdated;
        if (updated) {
            electionStatus.dateTime = updated;
            electionStatus.textContent = formatUpdated(updated, mapConfig.timeZone);
        } else {
            electionStatus.removeAttribute('datetime');
            electionStatus.textContent = 'Snapshot date not provided';
        }
        const mobileUpdated = app.querySelector('[data-mobile-election-status]');
        mobileUpdated.textContent = electionStatus.textContent;
        if (updated) mobileUpdated.dateTime = updated;
    }
    app.querySelector('.map-panel').setAttribute('aria-label', `Interactive election map: ${mapConfig.title}`);
    app.querySelector('#map-title').textContent = mapConfig.title;
    app.querySelector('#map-description').textContent = mapConfig.description || `Interactive results for ${pathByPrecinct.size} precincts.`;
    const note = app.querySelector('[data-map-note]');
    note.textContent = mapConfig.note || '';
    note.hidden = !mapConfig.note;
    app.querySelectorAll('[data-source]').forEach(link => {
        const url = results.sources[link.dataset.source];
        link.hidden = !url;
        if (url) link.href = url;
        else link.removeAttribute('href');
    });
}

async function initialize() {
    try {
        // Alternate configs allow developers to preview another county without UI changes.
        const configUrl = new URL(new URLSearchParams(location.search).get('config') || './map-config.json', location.href);
        const config = JSON.parse(await fetchText(configUrl));
        if (!config.results || !config.boundaries) throw new Error('Map config needs results and boundaries file paths.');
        const [resultText, boundaryText] = await Promise.all([
            fetchText(new URL(config.results, configUrl)),
            fetchText(new URL(config.boundaries, configUrl)),
        ]);
        const dataset = prepareDataset(config, parseResults(resultText, config), JSON.parse(boundaryText));
        mapConfig = dataset.config;
        allBoundaries = dataset.geojson;
        populateContestSelect(dataset.results.contests);
        loading.hidden = true;
        await selectContest(contestSummaries[0]);
        applyMetadata(dataset.results);
    } catch (error) {
        finishContestLoading('Contests unavailable');
        contestDetails.setAttribute('aria-busy', 'false');
        loading.textContent = 'Election data could not be loaded.';
        contestTitle.textContent = 'Data unavailable';
        contestSummary.textContent = error.message;
        // The pre-rendered title and snapshot timestamp remain useful if data fails.
        console.error(error);
    }
}

const viewAnimator = createViewAnimator({
    getView: () => viewBox,
    render: paintViewBox,
    reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    onStateChange: active => svg.toggleAttribute('data-view-transition', active),
});

contestSelect.addEventListener('change', () => {
    const contest = contestSummaries.find(item => item.id === contestSelect.value);
    if (contest) selectContest(contest);
});

app.querySelector('[data-zoom-in]').addEventListener('click', () => zoom(0.72));
app.querySelector('[data-zoom-out]').addEventListener('click', () => zoom(1.38));
app.querySelector('[data-reset]').addEventListener('click', resetMap);

const gestures = attachMapGestures(svg, {
    getViewBox: () => viewBox,
    setViewBox,
    clampWidth,
    getAspectRatio: () => mapAspect,
    onInteractionStart: viewAnimator.cancel,
    toMapPoint: (x, y) => {
        const point = svg.createSVGPoint();
        point.x = x;
        point.y = y;
        return point.matrixTransform(svg.getScreenCTM().inverse());
    },
});

resultsToggle.addEventListener('click', () => expandResults(resultsToggle.getAttribute('aria-expanded') !== 'true'));

new ResizeObserver(() => {
    const rect = svg.getBoundingClientRect();
    if (!mapProjection || !rect.width || !rect.height) return;
    const aspect = rect.height / rect.width;
    if (Math.abs(aspect - mapAspect) < 0.001) return;
    const previousView = viewAnimator.getDestination() || { ...viewBox };
    const atInitialView = ['x', 'y', 'width', 'height'].every(key => Math.abs(previousView[key] - initialViewBox[key]) < 0.01);
    mapAspect = aspect;
    updateInitialView();
    if (atInitialView) moveToView(initialViewBox, { duration: 280 });
    else moveToView({ x: previousView.x, y: previousView.y + (previousView.height - previousView.width * aspect) / 2, width: previousView.width }, { duration: 280 });
}).observe(svg);

svg.addEventListener('click', event => {
    if (event.target !== svg || gestures.isClickSuppressed()) return;
    selectedPath?.classList.remove('is-selected');
    selectedPath = null;
    selectedPrecinct = null;
    updateMapStatus();
});

initialize();

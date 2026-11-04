import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS_DATA_URL = 'https://results.saccounty.gov/results/public/api/elections/sacramento-county-ca/69/data';
const BALLOT_ITEM_URL = `${RESULTS_DATA_URL}/ballot-item/`;
const PRECINCTS_URL = 'https://services1.arcgis.com/5NARefyPVtAeuJPU/arcgis/rest/services/ConsolidatedPrecincts/FeatureServer/41/query?where=1%3D1&outFields=VPrecinct&returnGeometry=true&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.00015&f=geojson';
const RESULTS_PAGE_URL = 'https://results.saccounty.gov/results/public/sacramento-county-ca/69';
const BOUNDARIES_PAGE_URL = 'https://data-sacramentocounty.opendata.arcgis.com/maps/255dd4348bd045cea5c7c4ea949a5b4a';
const INCLUDED_OFFICES = new Set([
    'Governor',
    'Lieutenant Governor',
    'Secretary of State',
    'Controller',
    'Treasurer',
    'Attorney General',
    'Insurance Commissioner',
    'Board of Equalization District 1',
    'State Superintendent of Public Instruction',
]);

const directory = path.dirname(fileURLToPath(import.meta.url));
const outputDirectory = path.resolve(directory, '../public/data');

function textOf(value) {
    if (!Array.isArray(value)) return '';
    return value.find(item => item.languageId === 'en')?.text || value[0]?.text || '';
}

function precinctName(value) {
    return String(value).padStart(7, '0');
}

function shortContestName(name) {
    const proposition = name.match(/^(Proposition \d+)\b/);
    return proposition ? proposition[1] : name;
}

function isIncludedContest(contest) {
    const name = textOf(contest.name);
    return contest.hasBreakdownResults && (INCLUDED_OFFICES.has(name) || /^Proposition \d+\b/.test(name));
}

async function fetchJson(url) {
    const response = await fetch(url, {
        headers: {
            accept: 'application/json',
            'user-agent': 'electionslopmap data downloader',
        },
    });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
}

function compactChoice(choice) {
    return {
        id: choice.id,
        name: textOf(choice.name),
        party: choice.party?.abbreviation || '',
        votes: choice.voteCount,
        color: choice.party?.color || null,
    };
}

function compactContest(detail) {
    const choices = detail.summaryResults.ballotOptions.map(compactChoice);
    const choiceIndexes = new Map(choices.map((choice, index) => [choice.id, index]));
    const precincts = {};

    for (const result of detail.breakdownResults) {
        const votes = Array(choices.length).fill(null);
        for (const option of result.ballotOptions) {
            const index = choiceIndexes.get(option.id);
            if (index !== undefined) votes[index] = option.voteCount;
        }
        precincts[textOf(result.precinct.name)] = votes;
    }

    const name = textOf(detail.name);
    return {
        id: detail.id,
        name,
        shortName: shortContestName(name),
        type: detail.contestType,
        choices,
        precincts,
    };
}

const [data, geometry] = await Promise.all([
    fetchJson(RESULTS_DATA_URL),
    fetchJson(PRECINCTS_URL),
]);

const resultPrecincts = data.precincts.map(precinct => textOf(precinct.name));
const geometryPrecincts = geometry.features.map(feature => precinctName(feature.properties.VPrecinct));
const geometrySet = new Set(geometryPrecincts);

if (resultPrecincts.length !== 719 || geometryPrecincts.length !== 719) {
    throw new Error(`Expected 719 precincts; received ${resultPrecincts.length} result records and ${geometryPrecincts.length} geometries.`);
}
if (resultPrecincts.some(id => !geometrySet.has(id))) {
    throw new Error('The result precincts do not match the boundary layer.');
}

const includedContests = data.ballotItems.filter(isIncludedContest);
const contests = [];
for (const [index, contest] of includedContests.entries()) {
    console.log(`[${index + 1}/${includedContests.length}] ${textOf(contest.name)}`);
    const response = await fetchJson(`${BALLOT_ITEM_URL}${contest.id}`);
    contests.push(compactContest(response.ballotItemWithBreakdown));
}

const snapshot = {
    generatedAt: new Date().toISOString(),
    sources: {
        results: RESULTS_PAGE_URL,
        boundaries: BOUNDARIES_PAGE_URL,
    },
    election: {
        name: textOf(data.election.name),
        date: data.election.electionDate,
        official: data.election.isOfficialResults,
        asOf: data.election.asOf,
        lastUpdated: data.election.lastUpdated,
        precinctsReporting: data.election.precinctsReporting,
    },
    precincts: resultPrecincts,
    contests,
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
    writeFile(path.join(outputDirectory, 'sacramento-2026-results.json'), JSON.stringify(snapshot)),
    writeFile(path.join(outputDirectory, 'sacramento-2026-precincts.geojson'), JSON.stringify(geometry)),
]);

console.log(`Saved ${contests.length} contests and ${resultPrecincts.length} precincts to ${outputDirectory}.`);

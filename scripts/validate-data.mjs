import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseResults, prepareDataset } from '../public/dataset.js';

try {
    const configUrl = process.argv[2]
        ? pathToFileURL(path.resolve(process.argv[2]))
        : new URL('../public/map-config.json', import.meta.url);
    const config = JSON.parse(await readFile(configUrl, 'utf8'));
    if (!config.results || !config.boundaries) throw new Error('Config needs results and boundaries file paths.');
    const [text, boundaries] = await Promise.all([
        readFile(new URL(config.results, configUrl), 'utf8'),
        readFile(new URL(config.boundaries, configUrl), 'utf8'),
    ]);
    const dataset = prepareDataset(config, parseResults(text, config), JSON.parse(boundaries));
    console.log(`${config.title}: ${dataset.results.contests.length} contests, ${dataset.geojson.features.length} precinct boundaries. Data is valid.`);
} catch (error) {
    console.error(`Invalid map data: ${error.message}`);
    process.exitCode = 1;
}

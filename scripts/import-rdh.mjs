import { mkdir, mkdtemp, readFile, rename, rm, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { convertRdh, readRdhInput } from './rdh-data.mjs';

export async function writeRdhDataset(output, dataset) {
    try { await lstat(output); throw new Error('Output already exists; choose a new directory.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await mkdir(path.dirname(output), { recursive: true });
    const staging = await mkdtemp(path.join(path.dirname(output), '.rdh-import-'));
    try {
        for (const [name, value] of [['map-config.json', dataset.config], ['results.json', dataset.results], ['precincts.geojson', dataset.boundaries]]) {
            await writeFile(path.join(staging, name), JSON.stringify(value, null, name === 'map-config.json' ? 2 : 0) + '\n');
        }
        await rename(staging, output);
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const { values } = parseArgs({ options: {
            input: { type: 'string' }, mapping: { type: 'string' }, output: { type: 'string' },
            entry: { type: 'string' }, inspect: { type: 'boolean' }, help: { type: 'boolean' },
        } });
        if (values.help) {
            console.log('npm run import:rdh -- --input FILE_OR_URL --inspect\nnpm run import:rdh -- --input FILE_OR_URL --mapping imports/county.json --output public/data/county [--entry file.geojson]');
        } else {
            if (!values.input) throw new Error('Supply --input with a local GeoJSON/ZIP or authorized direct file URL.');
            if (!values.inspect && (!values.mapping || !values.output)) throw new Error('Supply --mapping and --output, or use --inspect to list input fields.');
            const input = await readRdhInput(values.input, { entry: values.entry });
            if (input.type !== 'FeatureCollection' || !input.features?.length) throw new Error('Input must be a nonempty GeoJSON FeatureCollection.');
            if (values.inspect) {
                console.log(JSON.stringify({ features: input.features.length, firstFeatureProperties: input.features[0].properties }, null, 2));
            } else {
                const mapping = JSON.parse(await readFile(values.mapping, 'utf8'));
                const dataset = convertRdh(input, mapping);
                const output = path.resolve(values.output);
                await writeRdhDataset(output, dataset);
                console.log(`Imported ${dataset.boundaries.features.length} precincts and ${dataset.results.contests.length} contests into ${output}`);
                console.log(`Validate: npm run validate -- ${path.join(values.output, 'map-config.json')}`);
                const relative = path.relative(fileURLToPath(new URL('../public/', import.meta.url)), output);
                if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
                    console.log(`Preview: http://127.0.0.1:8000/?config=./${relative.split(path.sep).join('/')}/map-config.json`);
                }
            }
        }
    } catch (error) {
        console.error(`RDH import failed: ${error.message}`);
        process.exitCode = 1;
    }
}

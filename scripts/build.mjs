import { cp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareDataset } from '../public/dataset.js';
import { validateConfig } from './validate-data.mjs';

export async function buildSite({ outputDirectory, siteLink } = {}) {
    const root = fileURLToPath(new URL('../', import.meta.url));
    const source = path.join(root, 'public');
    const output = path.resolve(outputDirectory || path.join(root, 'dist'));
    const isWithin = (parent, child) => {
        const relative = path.relative(parent, child);
        return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
    };
    if (isWithin(output, root) || isWithin(source, output)) {
        throw new Error('Build output must be separate from the source directory and repository ancestors.');
    }
    const dataset = await validateConfig();
    const config = siteLink === undefined ? dataset.config : { ...dataset.config, siteLink };
    prepareDataset(config, dataset.results, dataset.geojson);
    // Validate before replacing a previous build, so bad config cannot erase it.
    await rm(output, { recursive: true, force: true });
    await cp(source, output, { recursive: true });
    await writeFile(path.join(output, 'map-config.json'), JSON.stringify(config, null, 2) + '\n');
    return { outputDirectory: output, config };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const label = process.env.MAP_SITE_LABEL;
        const href = process.env.MAP_SITE_URL;
        if ((label !== undefined) !== (href !== undefined)) throw new Error('Set both MAP_SITE_LABEL and MAP_SITE_URL.');
        const result = await buildSite({ siteLink: label === undefined ? undefined : { label, href } });
        console.log(`Built ${result.config.title} into ${result.outputDirectory}`);
    } catch (error) {
        console.error(`Build failed: ${error.message}`);
        process.exitCode = 1;
    }
}

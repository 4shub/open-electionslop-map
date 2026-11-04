import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { prepareDataset } from '../public/dataset.js';
import { validateConfig } from './validate-data.mjs';

async function versionAssets(output, config) {
    async function filesIn(directory) {
        const entries = await readdir(directory, { withFileTypes: true });
        const files = await Promise.all(entries.map(entry => entry.isDirectory()
            ? filesIn(path.join(directory, entry.name)) : entry.isFile() ? [path.join(directory, entry.name)] : []));
        return files.flat().sort();
    }
    const files = await filesIn(output);
    const hash = createHash('sha256');
    for (const filename of files) hash.update(path.relative(output, filename)).update('\0').update(await readFile(filename));
    const version = hash.digest('hex').slice(0, 16);
    const versionUrl = url => {
        const [resource, fragment] = url.split('#');
        return `${resource}${resource.includes('?') ? '&' : '?'}v=${version}${fragment === undefined ? '' : `#${fragment}`}`;
    };
    // Version every link in the asset chain, including module imports and data.
    // HTML and assets can otherwise be cached for different lengths of time.
    for (const filename of files.filter(file => /\.(?:html|js|css)$/.test(file))) {
        let contents = await readFile(filename, 'utf8');
        if (filename.endsWith('.html')) contents = contents.replace(/((?:href|src)=)(["'])(\.\/[^"']+\.(?:css|js))\2/g,
            (_, attribute, quote, url) => `${attribute}${quote}${versionUrl(url)}${quote}`);
        if (filename.endsWith('.js')) contents = contents
            .replace(/(\bfrom\s+)(["'])(\.\.?\/[^"']+\.js)\2/g, (_, prefix, quote, url) => `${prefix}${quote}${versionUrl(url)}${quote}`)
            .replace(/(["'])\.\/map-config\.json\1/g, (_, quote) => `${quote}${versionUrl('./map-config.json')}${quote}`);
        if (filename.endsWith('.css')) contents = contents.replace(/url\((["'])(\.\/?[^"']+)\1\)/g,
            (_, quote, url) => `url(${quote}${versionUrl(url)}${quote})`);
        await writeFile(filename, contents);
    }
    const versionedConfig = { ...config, results: versionUrl(config.results), boundaries: versionUrl(config.boundaries) };
    await writeFile(path.join(output, 'map-config.json'), JSON.stringify(versionedConfig, null, 2) + '\n');
    return { config: versionedConfig, assetVersion: version };
}

export async function buildSite({ outputDirectory, siteLink, configUrl } = {}) {
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
    const dataset = await validateConfig(configUrl);
    let config = siteLink === undefined ? dataset.config : { ...dataset.config, siteLink };
    prepareDataset(config, dataset.results, dataset.geojson);
    // Validate before replacing a previous build, so bad config cannot erase it.
    await rm(output, { recursive: true, force: true });
    await cp(source, output, { recursive: true });
    if (configUrl) {
        // Package an external county dataset without retaining the bundled county's files.
        const dataDirectory = path.join(output, 'data');
        await rm(dataDirectory, { recursive: true, force: true });
        await mkdir(dataDirectory, { recursive: true });
        config = { ...config, resultsFormat: 'json', results: './data/results.json', boundaries: './data/precincts.geojson' };
        await writeFile(path.join(dataDirectory, 'results.json'), JSON.stringify(dataset.results) + '\n');
        await writeFile(path.join(dataDirectory, 'precincts.geojson'), JSON.stringify(dataset.geojson) + '\n');
    }
    await writeFile(path.join(output, 'map-config.json'), JSON.stringify(config, null, 2) + '\n');
    return { outputDirectory: output, ...await versionAssets(output, config) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const { values } = parseArgs({ options: { config: { type: 'string' } } });
        const label = process.env.MAP_SITE_LABEL;
        const href = process.env.MAP_SITE_URL;
        if ((label !== undefined) !== (href !== undefined)) throw new Error('Set both MAP_SITE_LABEL and MAP_SITE_URL.');
        const result = await buildSite({
            siteLink: label === undefined ? undefined : { label, href },
            configUrl: values.config ? pathToFileURL(path.resolve(values.config)) : undefined,
        });
        console.log(`Built ${result.config.title} into ${result.outputDirectory}`);
    } catch (error) {
        console.error(`Build failed: ${error.message}`);
        process.exitCode = 1;
    }
}

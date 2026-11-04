import { cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateConfig } from './validate-data.mjs';

try {
    // Validate before replacing a previous build, so bad data cannot erase it.
    const dataset = await validateConfig();
    const source = new URL('../public/', import.meta.url);
    const output = new URL('../dist/', import.meta.url);
    await rm(output, { recursive: true, force: true });
    await cp(source, output, { recursive: true });
    console.log(`Built ${dataset.config.title} into ${fileURLToPath(output)}`);
} catch (error) {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
}

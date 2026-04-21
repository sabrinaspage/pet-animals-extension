// build.js
// Minimal esbuild pipeline: bundle src/service_worker.js and src/content.js
// into dist/, then copy public/* (manifest, icons, css) alongside.

import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const watch = process.argv.includes('--watch');

async function run() {
  if (existsSync('dist')) await rm('dist', { recursive: true });
  await mkdir('dist', { recursive: true });

  const common = {
    bundle: true,
    format: 'iife',              // service workers and classic content scripts both accept IIFE
    target: 'chrome110',         // current-gen Chrome; drops transpilation weight
    platform: 'browser',
    minify: true,
    sourcemap: true,
    logLevel: 'info',
  };

  const targets = [
    { entryPoints: ['src/service_worker.js'], outfile: 'dist/service_worker.js' },
    { entryPoints: ['src/content.js'],        outfile: 'dist/content.js' },
  ];

  if (watch) {
    const contexts = await Promise.all(
      targets.map((t) => context({ ...common, ...t }))
    );
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('watching...');
  } else {
    await Promise.all(targets.map((t) => build({ ...common, ...t })));
  }

  // Copy static assets
  await cp('public', 'dist', { recursive: true });
  console.log('static assets copied to dist/');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

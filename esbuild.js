const esbuild = require("esbuild");
const fs = require('node:fs');
const crypto = require('node:crypto');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const artifacts = require('./codec/artifacts.json');
	for (const [name, expected] of Object.entries(artifacts.sha256)) {
		if (crypto.createHash('sha256').update(fs.readFileSync(`codec/${name}`)).digest('hex') !== expected) { throw new Error(`Codec checksum mismatch: ${name}`); }
	}
	fs.mkdirSync('dist/codec', { recursive: true });
	fs.cpSync('codec', 'dist/codec', { recursive: true });
	const ctx = await esbuild.context({
		entryPoints: ['src/extension.ts', 'src/palette-worker.ts', 'src/thumbnail-worker.ts', 'src/profile-job.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outdir: 'dist',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});

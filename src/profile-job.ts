/** Developer-only subprocess entry point; exercises the same production pipeline. */
import { parentPort } from 'node:worker_threads';
import { join } from 'node:path';
import { inspectSource } from './image/metadata';
import { imagePolicy } from './image/policy';
import { ImageDiagnostic, runPipeline } from './pipeline';

if (parentPort) { throw new Error('Profiling jobs must run in a subprocess'); }
process.once('message', (request: { path: string; decoder: 'auto' | 'native' | 'portable'; limit: number; jobs: number }) => {
    void (async () => {
        const started = performance.now(), cpu = process.cpuUsage();
        const events: ImageDiagnostic[] = [], retained: ReturnType<typeof process.memoryUsage>[] = [];
        const resources = () => process.getActiveResourcesInfo().filter(name => name === 'MessagePort' || name === 'ProcessWrap');
        const baselineResources = resources().length;
        let source, error: string | undefined;
        try {
            source = await inspectSource(request.path, imagePolicy(request.limit));
            for (let index = 0; index < request.jobs; index++) {
                const result = await runPipeline(join(__dirname, 'palette-worker.js'), request.path, 'analogous', 'dark', undefined, 'automatic', 'balanced', undefined, 'vibrant', undefined, {
                    decoderMode: request.decoder, imagePolicy: imagePolicy(request.limit), onDiagnostic: event => events.push(event),
                });
                if (!result.swatches.length || result.theme.checks.some(check => check.ratio < check.minimum)) { throw new Error('Palette failed correctness checks'); }
                retained.push(process.memoryUsage());
            }
        } catch (value) { error = value instanceof Error ? value.message : String(value); }
        await new Promise<void>(resolve => setImmediate(resolve));
        const activeResourceDelta = resources().length - baselineResources;
        const sourceError = error;
        if (activeResourceDelta > 0) { error = `Pipeline cleanup left ${activeResourceDelta} active worker/helper resources`; }
        process.send?.({ source, error, sourceError: error === sourceError ? undefined : sourceError, activeResourceDelta, durationMs: performance.now() - started, cpu: process.cpuUsage(cpu), nodeHighWaterBytes: process.resourceUsage().maxRSS * 1024, events, retained });
        process.once('message', () => process.exit(0));
    })();
});
process.send?.({ ready: true });

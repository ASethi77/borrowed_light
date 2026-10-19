const {fork,spawnSync,execFileSync} = require('node:child_process');
const fs = require('node:fs');
const {join,resolve,basename} = require('node:path');
const {parseArgs} = require('node:util');
const os = require('node:os');
const {startSampler} = require('./image-sampler.cjs');

const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function expectedOutcome(error,expectedRejection) {
    return expectedRejection ? (error && /megapixel|edge limit|2 GiB/.test(error) ? 'expected-rejection' : 'failed') : (error ? 'failed' : 'passed');
}
function writeReport(directory,report) {
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
    const columns=['id','decoder','run','jobs','limit','outcome','durationMs','sampledTreePeakMiB','nodeHighWaterMiB','sampledCpuMs','error'];
    const values=report.rows.map(row=>[row.id,row.decoder,row.run,row.jobs,row.limit,row.outcome,row.durationMs,(row.resources?.sampledTreePeakBytes??0)/1048576,(row.nodeHighWaterBytes??0)/1048576,row.resources?.sampledCpuMs??'',row.error??'']);
    fs.writeFileSync(join(directory,'report.csv'),[columns,...values].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n')+'\n');
    const table=values.map(row=>`<tr>${row.map((v,index)=>`<td>${escape(typeof v==='number'&&index>=6?v.toFixed(1):v)}</td>`).join('')}</tr>`).join('\n');
    fs.writeFileSync(join(directory,'report.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Image resource report</title><style>body{font:14px system-ui;margin:32px;color:#20252b}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ddd;padding:8px}thead{background:#edf2f7}td:nth-child(6){font-weight:bold}pre{white-space:pre-wrap}a{color:#165ab5}</style><h1>Image resource report</h1><p>${escape(report.environment.platform)} / ${escape(report.environment.arch)} · ${escape(report.environment.commit)} · ${escape(report.created)}</p><p>50 ms process-tree RSS samples can miss short peaks and count shared pages more than once. Node high-water memory is a separate OS measurement. Individual helper high-water values and sampled CPU totals are in the JSON report; high-water values are never summed as a simultaneous peak. Fixture generation and the collector are excluded. Resource thresholds are informational.</p><table><thead><tr>${columns.map(c=>`<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>${table}</tbody></table><h2>Environment</h2><pre>${escape(JSON.stringify(report.environment,null,2))}</pre></html>`);
    const summary=['## Image resource qualification',`Platform: ${report.environment.platform}/${report.environment.arch}; commit: ${report.environment.commit}`,'','| Case | Decoder | Outcome | ms | Sampled tree MiB |','|---|---|---|---:|---:|',...report.rows.map(row=>`| ${row.id.replace(/\|/g,'/')} | ${row.decoder} | ${row.outcome} | ${row.durationMs?.toFixed(1)??'—'} | ${((row.resources?.sampledTreePeakBytes??0)/1048576).toFixed(1)} |`),'','Memory/timing are report-only. Raw JSON includes the sample interval, per-process high-water measurements, CPU, WASM allocations, retained-memory samples, and failures.',''];
    fs.writeFileSync(join(directory,'summary.md'),summary.join('\n'));
}

async function measure(input,decoder,limit,jobs) {
    const child=fork(resolve('dist/profile-job.js'),[],{silent:true,windowsHide:true});
    let result, sampler, resources, logs='', exited=false;
    child.on('exit',()=>{exited=true;});
    child.stdout.on('data',data=>{logs=(logs+data.toString()).slice(-65536);});
    child.stderr.on('data',data=>{logs=(logs+data.toString()).slice(-65536);});
    const receive=timeout=>new Promise((resolveMessage,reject)=>{
        const timer=setTimeout(()=>{cleanup();reject(new Error('Profiling subprocess deadline expired'));},timeout);
        const onMessage=message=>{cleanup();resolveMessage(message);};
        const onExit=code=>{cleanup();reject(new Error(`Profiling subprocess exited without results (${code})`));};
        const onError=error=>{cleanup();reject(error);};
        function cleanup(){clearTimeout(timer);child.removeListener('message',onMessage);child.removeListener('exit',onExit);child.removeListener('error',onError);}
        child.once('message',onMessage);child.once('exit',onExit);child.once('error',onError);
    });
    try {
        const ready=await receive(15000); if(!ready.ready) {throw new Error('Invalid profiling handshake');}
        sampler=await startSampler(child.pid);
        const reply=receive(125000*jobs+15000);
        child.send({path:input.path,decoder,limit,jobs});
        result=await reply;
        resources=await sampler.stop();sampler=undefined;
        if(resources.error||!resources.samples) {throw new Error(`Resource collector failed: ${resources.error??'no samples'}`);}
        child.send({exit:true});
        await new Promise(resolveExit=>{if(exited) {resolveExit();} else {child.once('exit',resolveExit);}});
    } catch(error) {
        result={...result,error:String(error),durationMs:result?.durationMs??0};
    } finally {
        if(sampler) {resources=await sampler.stop();}
        if(!exited) {
            // A crashed/unresponsive job must not leave its decoder helpers behind.
            for(const pid of resources?.livePids??[]) {if(pid!==child.pid) {try {process.kill(pid);} catch { /* already exited */ }} }
            const closed=new Promise(resolveClose=>child.once('close',resolveClose));child.kill();await closed;
        }
    }
    const redact=text=>text?.split(input.path).join('<input>');
    return {...result,error:redact(result?.error),sourceError:redact(result?.sourceError),logs:redact(logs),resources};
}

async function main() {
    const {values:args}=parseArgs({options:{suite:{type:'string',default:'smoke'},decoder:{type:'string',default:'auto'},file:{type:'string'},'limit-mp':{type:'string'},runs:{type:'string'},repeats:{type:'string'},output:{type:'string'}}});
    if(!['smoke','full'].includes(args.suite)||!['auto','native','portable','both'].includes(args.decoder)) {throw new Error('Use --suite smoke|full and --decoder auto|native|portable|both');}
    if(args.decoder==='native'&&!['win32','darwin'].includes(process.platform)) {throw new Error('Native normalization is unavailable on this platform');}
    const runs=Number(args.runs??(args.suite==='full'?'3':'1')), repeats=Number(args.repeats??(args.suite==='full'?'20':'0'));
    const limit=args['limit-mp']===undefined?undefined:Number(args['limit-mp']);
    if(!Number.isInteger(runs)||runs<1||runs>20||!Number.isInteger(repeats)||repeats<0||repeats>100||limit!==undefined&&(!Number.isInteger(limit)||limit<1||limit>512)) {throw new Error('Invalid runs, repeats, or limit-mp');}
    let inputs;
    if(args.file) {inputs=[{id:basename(args.file),path:resolve(args.file),format:'user-file'}];}
    else {
        const generated=spawnSync(process.env.PYTHON??(process.platform==='win32'?'python':'python3'),['tools/image-fixtures.py','--suite',args.suite],{stdio:'inherit',windowsHide:true});
        if(generated.status!==0) {throw new Error('Fixture generation failed; see the generator output above');}
        inputs=JSON.parse(fs.readFileSync(`.cache/image-fixtures/${args.suite}.json`,'utf8')).cases;
    }
    const decoders=args.decoder==='both'?(['win32','darwin'].includes(process.platform)?['native','portable']:['portable']):[args.decoder];
    const report={schemaVersion:1,created:new Date().toISOString(),environment:{platform:process.platform,arch:process.arch,osRelease:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem(),node:process.version,versions:process.versions,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:Boolean(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()),codecs:JSON.parse(fs.readFileSync('codec/sources.json','utf8')),codecArtifacts:JSON.parse(fs.readFileSync('codec/artifacts.json','utf8')),unavailableDecoders:['win32','darwin'].includes(process.platform)?[]:['native']},rows:[]};
    const directory=resolve(args.output??join('profiling-results',`${process.platform}-${Date.now()}`));
    writeReport(directory,report);
    async function runCase(input,decoder,effectiveLimit,run,jobs,expectedRejection=false,suffix='') {
        console.log(`${decoder}: ${input.id}${suffix} (${effectiveLimit} MP, ${jobs} job(s))`);
        const measurement=await measure(input,decoder,effectiveLimit,jobs);
        const {path:unused,...metadata}=input;void unused;
        const outcome=expectedOutcome(measurement.error,expectedRejection);
        report.rows.push({...metadata,id:input.id+suffix,decoder,run,jobs,limit:effectiveLimit,expectedRejection,...measurement,outcome});
        writeReport(directory,report);
    }
    for(const decoder of decoders) {
        for(const input of inputs) {
            const pixels=input.width*input.height;
            const effectiveLimit=limit??Math.max(256,Math.ceil(pixels/1000000)||256);
            for(let run=1;run<=runs;run++) {await runCase(input,decoder,effectiveLimit,run,1,Number.isFinite(pixels)&&pixels>effectiveLimit*1000000);}
            if(!args.file&&pixels>256000000&&limit===undefined) {await runCase(input,decoder,256,1,1,true,'-default-rejection');}
        }
        if(repeats) {const input=inputs.find(input=>input.format==='progressive'&&input.width===7952)??inputs[0];await runCase(input,decoder,limit??256,1,repeats,input.width*input.height>(limit??256)*1000000,'-repeated');}
    }
    if(process.env.GITHUB_STEP_SUMMARY) {fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,fs.readFileSync(join(directory,'summary.md')));}
    console.log(`Reports: ${directory}`);
    if(report.rows.some(row=>row.outcome==='failed')) {process.exitCode=1;}
}
module.exports={expectedOutcome,writeReport,measure};
if(require.main===module) {main().catch(error=>{console.error(error);process.exitCode=1;});}

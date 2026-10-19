const {readFile} = require('node:fs/promises');
const {readFileSync} = require('node:fs');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {join} = require('node:path');
const exec = promisify(execFile);

function parsePs(text, root) {
    const rows = text.trim().split('\n').map(line => {
        const fields = line.trim().split(/\s+/);
        const clock = fields[3]?.split(/[-:]/).map(Number) ?? [];
        const seconds = clock.reduce((sum, part, index) => sum + part * (index === 0 && clock.length === 4 ? 86400 : 60 ** (clock.length - index - 1)), 0);
        return {pid:Number(fields[0]), parent:Number(fields[1]), rss:Number(fields[2])*1024, highWater:null, cpuMs:seconds*1000};
    }).filter(row => Number.isFinite(row.rss));
    const selected = new Set([root]); let changed;
    do { changed=false; for(const row of rows) { if(selected.has(row.parent) && !selected.has(row.pid)) {selected.add(row.pid); changed=true;} } } while(changed);
    return rows.filter(row=>selected.has(row.pid));
}

async function startSampler(root, onSample = () => {}) {
    const processes = new Map(); let sampledTreePeakBytes=0, samples=0, failure=null, livePids=[];
    const record = values => {
        samples++;
        livePids=values.map(p=>p.pid);
        sampledTreePeakBytes=Math.max(sampledTreePeakBytes,values.reduce((sum,p)=>sum+p.rss,0));
        for(const p of values) {
            const old=processes.get(p.pid);
            processes.set(p.pid,{pid:p.pid, sampledPeakBytes:Math.max(old?.sampledPeakBytes??0,p.rss), observedHighWaterBytes:p.highWater===null||p.highWater===undefined?null:Math.max(old?.observedHighWaterBytes??0,p.highWater), sampledCpuMs:Math.max(old?.sampledCpuMs??0,p.cpuMs)});
        }
        onSample({elapsed:Date.now(),processes:values});
    };
    let stop;
    if(process.platform==='win32') {
        const script=readFileSync(join(__dirname,'windows-image-sampler.ps1'),'utf8');
        const child=spawn(join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
        let tail='', errors='', stopped=false;
        await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>{child.kill();reject(new Error('Windows sampler did not become ready'));},15000);
            child.on('error',error=>{clearTimeout(timer);reject(error);});
            child.stderr.on('data',data=>{errors+=data.toString();});
            child.stdout.on('data',data=>{
                tail+=data.toString(); let newline;
                while((newline=tail.indexOf('\n'))>=0) {
                    const line=tail.slice(0,newline); tail=tail.slice(newline+1);
                    try { const value=JSON.parse(line); if(value.processes) {record(value.processes);clearTimeout(timer);resolve();} }
                    catch(error) {failure=String(error);}
                }
            });
            child.on('exit',code=>{clearTimeout(timer);if(!stopped&&code!==0) {failure=errors||`Windows sampler exited ${code}`;reject(new Error(failure));}});
            child.stdin.end(JSON.stringify({pid:root})+'\n');
        });
        stop=async()=>{stopped=true;if(child.exitCode!==null||child.signalCode!==null) {return;} const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;};
    } else {
        const ticks=process.platform==='linux'?Number((await exec('getconf',['CLK_TCK'])).stdout.trim()):100;
        let active=Promise.resolve(), running=false;
        const sample=async()=>{
            try {
                if(process.platform==='linux') {
                    const values=[], pending=[root], seen=new Set();
                    while(pending.length) {
                        const pid=pending.pop(); if(seen.has(pid)) {continue;} seen.add(pid);
                        try {
                            const [status,stat,children]=await Promise.all([readFile(`/proc/${pid}/status`,'utf8'),readFile(`/proc/${pid}/stat`,'utf8'),readFile(`/proc/${pid}/task/${pid}/children`,'utf8')]);
                            const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
                            values.push({pid,rss:Number(/VmRSS:\s+([0-9]+)/.exec(status)?.[1]??0)*1024,highWater:Number(/VmHWM:\s+([0-9]+)/.exec(status)?.[1]??0)*1024,cpuMs:(Number(fields[11])+Number(fields[12]))*1000/ticks});
                            pending.push(...children.trim().split(/\s+/).filter(Boolean).map(Number));
                        } catch(error) {if(!['ENOENT','ESRCH'].includes(error.code)) {throw error;}}
                    }
                    record(values);
                } else if(process.platform==='darwin') {
                    record(parsePs((await exec('/bin/ps',['-axo','pid=,ppid=,rss=,time='],{maxBuffer:8*1024*1024})).stdout,root));
                } else {throw new Error('No resource collector for this platform');}
            } catch(error) {failure=String(error);}
        };
        await sample();
        const timer=setInterval(()=>{if(!running) {running=true;active=sample().finally(()=>{running=false;});}},50);
        stop=async()=>{clearInterval(timer);await active;await sample();};
    }
    return {async stop(){await stop();return {intervalMs:50,samples,sampledTreePeakBytes,livePids,processes:[...processes.values()],sampledCpuMs:[...processes.values()].reduce((sum,p)=>sum+p.sampledCpuMs,0),error:failure};}};
}
module.exports={startSampler,parsePs};

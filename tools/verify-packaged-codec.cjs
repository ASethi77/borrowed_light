const {Worker}=require('node:worker_threads');
const assert=require('node:assert/strict');
const worker=new Worker(process.argv[2],{workerData:{path:process.argv[3],policy:{maxMegapixels:256},format:'png'}});
let settled=false;
const timer=setTimeout(()=>finish(new Error('Packaged codec timed out')),15000);
function finish(error) {
    if(settled) {return;} settled=true;clearTimeout(timer);
    void worker.terminate().then(()=>{if(error) {console.error(error);process.exitCode=1;} else {console.log('Extracted WASM codec decoded the fixture successfully');}});
}
worker.once('message',message=>{
    try {
        if(message.error) {throw new Error(message.error);}
        assert.ok(message.png instanceof Uint8Array);
        const png=Buffer.from(message.png);
        assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
        assert.equal(png.readUInt32BE(16),16);assert.equal(png.readUInt32BE(20),16);
        finish();
    } catch(error) {finish(error);}
});
worker.once('error',finish);
worker.once('exit',code=>{if(!settled) {finish(new Error(`Packaged codec exited without a result (${code})`));}});

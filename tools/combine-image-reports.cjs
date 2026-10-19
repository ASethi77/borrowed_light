const fs=require('node:fs');
const {join}=require('node:path');
const {writeReport}=require('./profile-images.cjs');
const root=process.argv[2]??'profiling-results/all';
const reports=fs.readdirSync(root,{withFileTypes:true}).filter(item=>item.isDirectory()).map(item=>join(root,item.name,'report.json')).filter(file=>fs.existsSync(file)).map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
const missing=['win32','darwin','linux'].filter(platform=>!reports.some(report=>report.environment.platform===platform));
const combined={schemaVersion:1,created:new Date().toISOString(),environment:{platform:'combined',arch:'multiple',commit:process.env.GITHUB_SHA??reports[0]?.environment.commit,reports:reports.map(report=>report.environment),missingPlatforms:missing},rows:reports.flatMap(report=>report.rows.map(row=>({...row,id:`${report.environment.platform}/${row.id}`})))};
writeReport(join(root,'summary'),combined);
for(const extension of ['json','csv','html']) {fs.copyFileSync(join(root,'summary',`report.${extension}`),join(root,`combined.${extension}`));}
if(process.env.GITHUB_STEP_SUMMARY) {fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,fs.readFileSync(join(root,'summary','summary.md')));if(missing.length) {fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`\nMissing platforms: ${missing.join(', ')}\n`);}}
if(missing.length||combined.rows.some(row=>row.outcome==='failed')) {process.exitCode=1;}

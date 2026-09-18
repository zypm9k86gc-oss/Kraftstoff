// Regression inputs from real OCR runs on four user-provided dashboard photos.
// Photos are intentionally not published with the application.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/app.js','utf8');
const c=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function chooseReading('),source.indexOf('function parseDashboardText(')),c);
const fields=['consumption','duration','averageSpeed','distance'];
const inputs=[
 [['2 11,7 /100km','211,71'],['79:28h'],['69'],['5408,8','>408,8']],
 [['6,81/100km','6,8 /100km'],['1:11h'],['98 km/h'],['116,1km']],
 [['9,6/100km','2 9,61/100km'],['7:45h |'],['2 116 km/h'],['903,4 km |']],
 [['6,7','8,7 V100Km'],['2:22h','2:22n'],['79'],['187,4 km']],
];
const expected=[[11.7,'79:28',69,5408.8],[6.8,'1:11',98,116.1],[9.6,'7:45',116,903.4],[undefined,'2:22',79,187.4]];
let accepted=0;
inputs.forEach((photo,p)=>photo.forEach((texts,i)=>{
 const readings=texts.map(text=>({value:c.parseFieldText(text,fields[i]),confidence:80})).filter(r=>r.value!==undefined);
 const actual=c.chooseReading(readings);
 assert.equal(actual,expected[p][i],`Photo ${p+1} ${fields[i]}`);
 if(actual!==undefined)accepted++;
}));
assert.equal(c.chooseReading([{value:6.7,confidence:70},{value:8.7,confidence:95},{value:8.7,confidence:95}]),undefined);
assert.equal(c.findDashboardFields([],1600,1200),null);
console.log(`${accepted}/16 photo-derived values accepted; conflicting consumption left blank`);

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const controls = {};
const $ = id => controls[id] ||= {value:'',checked:false,hidden:false};
const elements = Object.fromEntries(['date','name','distance','consumption','duration','averageSpeed','previewImage','photoPreview','photoDrop','scanAgainButton'].map(key=>[key,{value:''}]));
const trip = {id:'old',date:'2026-09-17',name:'Testfahrt',distance:5408.8,consumption:11.7,durationMinutes:4768,averageSpeed:69,image:'photo',createdAt:123};
const state = {trips:[trip],editingId:null};
const context = vm.createContext({state,elements,$,crypto:{randomUUID:()=> 'new'},Date,Number,Boolean,Math,
  resetCapture(){state.editingId=null;},setScanStatus(){},updateScorePreview(){},switchView(){},showToast(){},
  formatInputNumber:v=>String(v).replace('.',','), formatDuration:m=>`${Math.floor(m/60)}:${String(m%60).padStart(2,'0')} h`,
  parseLocaleNumber:v=>Number(String(v).replace(',','.')),parseDuration:v=>{const m=v.match(/^(\d{1,3}):([0-5]\d)$/);return m?Number(m[1])*60+Number(m[2]):NaN;},calculateFEI:()=>42});
vm.runInContext(source.slice(source.indexOf('function tripFromForm('),source.indexOf('function addTrip(')),context);
context.editTrip('old');
assert.equal(elements.duration.value,'79:28');
assert.equal(state.imageData,'photo');
assert.equal($('#accEnabled').checked,false);
assert.equal($('#traffic').value,'');
$('#accEnabled').checked=true; $('#accSpeed').value='120'; $('#traffic').value='++'; context.syncACC();
assert.equal($('#accSpeed').required,true);
elements.name.value='Bearbeitet';
const changed=context.tripFromForm();
assert.equal(changed.id,'old');assert.equal(changed.createdAt,123);assert.equal(changed.image,'photo');
assert.equal(changed.name,'Bearbeitet');assert.equal(changed.accSpeed,120);assert.equal(changed.traffic,'++');
assert.equal(changed.durationMinutes,4768);assert.equal(trip.name,'Testfahrt');
$('#accSpeed').value='';assert.equal(context.tripFromForm(),null);
$('#accEnabled').checked=false;context.syncACC();assert.equal(context.tripFromForm().accSpeed,null);
assert.equal($('#accSpeed').disabled,true);
let submit;
elements.form={addEventListener:(event,fn)=>{submit=fn;}};
Object.assign(context,{persistTrips(){},renderAll(){},addTrip(){throw Error('Edit must not duplicate trip');}});
const start=source.indexOf('elements.form.addEventListener("submit"');
vm.runInContext(source.slice(start,source.indexOf('\n\n$("#tripList")',start)),context);
submit({preventDefault(){}});
assert.equal(state.trips.length,1);assert.equal(state.trips[0].id,'old');assert.equal(state.trips[0].name,'Bearbeitet');
console.log('Edit/save, legacy data, duration over 24 hours, ACC validation and traffic tests passed');

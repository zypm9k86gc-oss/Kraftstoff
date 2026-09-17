const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const context = vm.createContext({Math});
vm.runInContext(source.slice(source.indexOf('function cameraSourceRect('), source.indexOf('async function captureCamera(')), context);
// Landscape source is clipped horizontally, portrait source vertically.
for (const [w,h,expected] of [[1920,1080,{x:312,y:280.8,width:1296,height:518.4}], [1080,1920,{x:54,y:765.6,width:972,height:388.8}]]) {
  const r=context.cameraSourceRect(w,h,400,300,{x:20,y:78,width:360,height:144});
  for(const key of Object.keys(expected)) assert.ok(Math.abs(r[key]-expected[key])<.001, key);
  assert.ok(r.x>=0 && r.y>=0 && r.x+r.width<=w && r.y+r.height<=h);
}
let stopped=0;
const controls={};
const lifecycle=vm.createContext({clearTimeout(){},cameraReadyTimer:1,cameraRequest:1,cameraStream:{getTracks:()=>[{stop:()=>stopped++},{stop:()=>stopped++}]},cameraVideo:{srcObject:{}},$:id=>controls[id] ||= {}});
vm.runInContext(source.slice(source.indexOf('function stopCamera('), source.indexOf('// Map the visible overlay')), lifecycle);
lifecycle.stopCamera();
assert.equal(stopped,2);assert.equal(lifecycle.cameraStream,null);assert.equal(lifecycle.cameraVideo.srcObject,null);
assert.equal(controls['#cameraCapture'].disabled,true);
lifecycle.stopCamera();assert.equal(stopped,2);
console.log('Camera crop mapping (portrait/landscape) and stream cleanup passed');
Object.assign(lifecycle,{cameraStream:{},cameraDialog:{open:true}});
lifecycle.cameraVideo.videoWidth=1920;lifecycle.cameraVideo.readyState=2;lifecycle.cameraVideo.paused=true;
vm.runInContext(source.slice(source.indexOf('function cameraReady('),source.indexOf('cameraVideo.addEventListener("playing"')),lifecycle);
lifecycle.cameraReady();assert.equal(controls['#cameraCapture'].disabled,true);
lifecycle.cameraVideo.paused=false;lifecycle.cameraReady();assert.equal(controls['#cameraCapture'].disabled,false);
console.log('Capture remains disabled until video is playing');

const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
const parser = source.slice(source.indexOf('function parseDashboardText('), source.indexOf('function loadImage('));
const context = vm.createContext({});
vm.runInContext(parser, context);
const cases = [
  ['70 km\n11,8 l/100km 29:07h\n76 km/h 2204,0 km\n5273 km 431,2 km', {consumption:11.8,duration:'29:07',averageSpeed:76,distance:2204}],
  ['11,7 l/100km\n79:28 h\n69 km/h\n5408,8 km\n5462 km\n16:42', {consumption:11.7,duration:'79:28',averageSpeed:69,distance:5408.8}],
  ['6,1 l/100km\n0:12\n40 km/h\n8 km', {consumption:6.1,duration:'0:12',averageSpeed:40,distance:8}],
  ['11,7 l/100km\n79:28h\n69 km/h\n5.408,8 km', {consumption:11.7,duration:'79:28',averageSpeed:69,distance:5408.8}],
  ['11,7 l/100km', {consumption:11.7}],
  ['70 km\n5273 km\n431,2 km\n16:42\n18:06', {}],
];
for (const [text, expected] of cases) {
  const result = JSON.parse(JSON.stringify(context.parseDashboardText(text)));
  assert.deepEqual(result, expected, text);
}
console.log(`${cases.length} OCR parser regression tests passed`);
vm.runInContext(source.slice(source.indexOf('function fieldRectangle('), source.indexOf('function parseDashboardText(')), context);
for (const [text, field, expected] of [
  ['11,7 l/100km', 'consumption', 11.7],
  ['11,8', 'consumption', 11.8],
  ['79:28 h', 'duration', '79:28'],
  ['29:07', 'duration', '29:07'],
  ['69', 'averageSpeed', 69],
  ['76 km/h', 'averageSpeed', 76],
  ['5408,8', 'distance', 5408.8],
  ['2.204,0 km', 'distance', 2204],
  ['79:88', 'duration', undefined],
  ['70 km 5273 km', 'distance', undefined],
  ['', 'consumption', undefined],
]) assert.equal(context.parseFieldText(text, field), expected, `${field}: ${text}`);
const regions = [0,1,2,3].map(i => context.fieldRectangle(1000,400,i));
assert.deepEqual(JSON.parse(JSON.stringify(regions)), [
  {left:0,top:0,width:600,height:200}, {left:600,top:0,width:400,height:200},
  {left:0,top:200,width:600,height:200}, {left:600,top:200,width:400,height:200}
]);
console.log('Fixed-position parsing and all four image regions passed');

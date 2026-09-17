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

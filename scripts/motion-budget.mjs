import fs from 'node:fs';
import path from 'node:path';

const roots = ['src', 'server'];
const forbidden = new Set(['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'box-shadow']);
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(css|scss|sass|less)$/.test(entry.name)) files.push(full);
  }
}
for (const root of roots) walk(root);
const errors = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const keyframes = source.matchAll(/@(?:-webkit-)?keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g);
  for (const match of keyframes) {
    const body = match[1];
    for (const declaration of body.matchAll(/(?:^|[;{}\n])\s*([a-z-]+)\s*:/g)) {
      const property = declaration[1].toLowerCase();
      if (forbidden.has(property)) errors.push(file + ': keyframe animates forbidden property "' + property + '"');
    }
  }
  for (const declaration of source.matchAll(/transition(?:-property)?\s*:\s*([^;]+);/g)) {
    const value = declaration[1].trim().toLowerCase();
    if (value === 'all' || [...forbidden].some((property) => new RegExp('(?:^|[,\\s])' + property + '(?:$|[,\\s])').test(value))) {
      errors.push(file + ': transition targets layout/paint property "' + value + '"');
    }
  }
}
if (errors.length) {
  console.error('Motion budget failed:');
  for (const error of errors) console.error('- ' + error);
  process.exit(1);
}
console.log('Motion budget passed: no forbidden keyframe or explicit transition properties found in CSS.');

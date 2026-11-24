import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const scanRoots = ['src', 'server', 'index.html'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.html', '.css']);
const unresolved = [];

async function walk(target) {
  const info = await stat(target);
  if (info.isFile()) {
    if (!extensions.has(path.extname(target)) && !target.endsWith('.html')) return;
    const source = await readFile(target, 'utf8');
    source.split(/\r?\n/).forEach((line, index) => {
      if (/\[OWNER TO COMPLETE(?::[^\]]*)?\]/i.test(line) || /OWNER_CONFIRM/.test(line)) {
        unresolved.push({ file: path.relative(root, target), line: index + 1, text: line.trim() });
      }
    });
    return;
  }
  for (const entry of await readdir(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) await walk(child);
    else if (extensions.has(path.extname(child))) await walk(child);
  }
}

for (const item of scanRoots) {
  try { await walk(path.join(root, item)); }
  catch (error) {
    if (item !== 'index.html') throw error;
  }
}

if (unresolved.length) {
  console.error('\nProduction build blocked: unresolved owner-confirmation markers remain.\n');
  for (const item of unresolved) {
    console.error(item.file + ':' + item.line + '  ' + item.text);
  }
  console.error('\nResolve or remove ' + unresolved.length + ' marker(s) after owner review. Do not delete a marker without verifying the claim.\n');
  process.exit(1);
}
console.log('Owner-confirmation check passed: no unresolved markers remain.');

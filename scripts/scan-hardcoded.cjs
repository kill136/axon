const fs = require('fs');
const path = require('path');

function walk(d) {
  let r = [];
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) r = r.concat(walk(p));
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) r.push(p);
  }
  return r;
}

const files = walk('src/web/client/src/components').concat(walk('src/web/client/src/pages'));

let total = 0;
let fileResults = [];

for (const f of files) {
  const c = fs.readFileSync(f, 'utf-8');
  const lines = c.split('\n');
  let hardcoded = [];
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.includes('/*')) inBlockComment = true;
    if (line.includes('*/')) { inBlockComment = false; continue; }
    if (inBlockComment) continue;
    if (line.trim().startsWith('//')) continue;
    if (line.trim().startsWith('*')) continue;
    if (line.trim().startsWith('import')) continue;

    // Remove inline comments
    const noComment = line.replace(/\/\/.*$/, '');
    if (noComment.includes('console.')) continue;

    // Check for Chinese in string literals
    const re = /['"`]([^'"`]*[\u4e00-\u9fff][^'"`]*)['"`]/g;
    let m;
    while ((m = re.exec(noComment)) !== null) {
      hardcoded.push({ line: i + 1, text: m[1].substring(0, 60) });
    }

    // Also check JSX text content: >Chinese text<
    const jsxRe = />([^<]*[\u4e00-\u9fff][^<]*)</g;
    while ((m = jsxRe.exec(noComment)) !== null) {
      const text = m[1].trim();
      if (text && !text.startsWith('{')) {
        hardcoded.push({ line: i + 1, text: 'JSX: ' + text.substring(0, 50) });
      }
    }
  }

  if (hardcoded.length > 0) {
    total += hardcoded.length;
    fileResults.push({
      file: f.replace(/\\/g, '/'),
      count: hardcoded.length,
      samples: hardcoded.slice(0, 3)
    });
  }
}

fileResults.sort((a, b) => b.count - a.count);
fileResults.forEach(r => {
  const short = r.file.replace('src/web/client/src/', '');
  console.log(`${short}: ${r.count} hits`);
  r.samples.forEach(s => console.log(`  L${s.line}: ${s.text}`));
});
console.log(`\nTotal: ${total} hardcoded strings in ${fileResults.length} files`);

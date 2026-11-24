/** Bundle the dependency-free Pulsegrid Studio into a single self-contained HTML string. */
import fs from 'node:fs/promises';
import path from 'node:path';

const root = '/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d61-c65f7b386000/audio_work/pulsegrid_src';
const importPattern = /^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?\s*$/gm;

async function bundle (entry, replacements = []) {
    const modules = new Map();
    const visit = async file => {
        file = path.posix.normalize(file);
        if (modules.has(file)) return;
        let source = await fs.readFile(path.join(root, file), 'utf8');
        const dependencies = [];
        for (const match of source.matchAll(importPattern)) {
            dependencies.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2])));
        }
        for (const dependency of dependencies) await visit(dependency);
        source = source.replace(importPattern, (_, names, relative) => {
            const id = path.posix.normalize(path.posix.join(path.posix.dirname(file), relative));
            return `const {${names}} = __modules[${JSON.stringify(id)}];`;
        });
        const exports = [];
        source = source.replace(/^export\s+(async\s+function|class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
            (_, kind, name) => { exports.push(name); return `${kind} ${name}`; });
        if (/^\s*(?:import|export)\s/m.test(source)) throw new Error(`Unsupported module syntax in ${file}`);
        for (const [re, val] of replacements) source = source.replace(re, () => val);
        const wrap = file === 'app.js' ? '(async()=>{' : '(()=>{';
        const close = file === 'app.js' ? '})().catch(e=>{console.error(e);});' : '})();';
        modules.set(file, `__modules[${JSON.stringify(file)}]=${wrap}\n${source}\nreturn {${exports.join(',')}};\n${close}`);
    };
    await visit(entry);
    return `(async()=>{\n'use strict';\nconst __modules=Object.create(null);\n${[...modules.values()].join('\n')}\n})().catch(e=>{console.error('Pulsegrid boot failed:',e);});`;
}

// Worklet and export worker are separate JS globals, bundled independently.
const worklet = await bundle('engine/worklet.js');
const worker = await bundle('engine/export-worker.js');
const blobExpr = code => `URL.createObjectURL(new Blob([${JSON.stringify(code)}],{type:'text/javascript'}))`;
const replacements = [
    [/new\s*URL\(\s*['"]\.\/worklet\.js['"]\s*,\s*import\.meta\.url\s*\)/g, blobExpr(worklet)],
    [/new\s*URL\(\s*['"]\.\/engine\/export-worker\.js['"]\s*,\s*import\.meta\.url\s*\)/g, blobExpr(worker)]
];
const app = await bundle('app.js', replacements);
const css = await fs.readFile(path.join(root, 'styles.css'), 'utf8');
let html = await fs.readFile(path.join(root, 'index.html'), 'utf8');
html = html.replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="app.js"></script>', () => `<script type="module">\n${app.replace(/<\/script/gi, '<\\/script')}\n</script>`);
await fs.writeFile('/root/.codebuddy/artifact/2f8a7d30-9c21-4f0b-1d61-c65f7b386000/audio_work/pulsegrid-standalone.html', html);
console.log(`Built pulsegrid-standalone.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KiB)`);

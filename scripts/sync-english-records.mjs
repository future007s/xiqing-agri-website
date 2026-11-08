import {readFile, readdir, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {parse} from 'yaml';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('src/i18n/records-en.json', root), 'utf8'));
const han = /[\u3400-\u9fff]/u;
export function englishText(value) {
  if (!han.test(value)) return value;
  if (catalog[value]) return catalog[value];
  const photo = /^(\d+)月(\d+)日育苗观察$/.exec(value);
  if (photo) return `Growing observation, ${photo[2]} ${['January','February','March','April','May','June','July','August','September','October','November','December'][Number(photo[1])-1]}`;
  throw new Error(`Missing English record translation: ${JSON.stringify(value)}`);
}
export function englishData(value) {
  if (typeof value === 'string') return englishText(value);
  if (Array.isArray(value)) return value.map(englishData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, englishData(item)]));
  return value;
}
export async function syncEnglishRecords({check = false} = {}) {
  // Prepare every translation before writing; a missing translation never publishes a mixed-language record.
  const output = [];
  for (const [folder, excluded] of [['experiments','T01-001'], ['trace-batches','PB-QDF01-20260824-01']]) {
    for (const file of await readdir(new URL(`src/content/${folder}/`, root))) {
      if (!file.endsWith('.md')) continue;
      const source = await readFile(new URL(`src/content/${folder}/${file}`, root), 'utf8');
      const [, front, body] = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source) ?? [];
      if (!front) throw new Error(`Invalid frontmatter: ${file}`);
      const data = parse(front);
      if (data.id === excluded) continue;
      const marker = '<!-- xiqing-record-days:v1\n';
      const contract = body.includes(marker) ? JSON.parse(body.split(marker)[1].split('\nxiqing-record-days:v1 -->')[0]) : null;
      const prose = body.split('<!-- xiqing-record-sync:v1 BEGIN -->')[0];
      const translatedBody = (contract ? prose : body).split('\n').map(englishText).join('\n').trim();
      const content = `---\n${JSON.stringify(englishData(data), null, 2)}\n---\n\n${translatedBody}\n${contract ? `\n${marker}${JSON.stringify(englishData(contract), null, 2)}\nxiqing-record-days:v1 -->\n` : ''}`;
      output.push([new URL(`src/content/${folder}-en/${file}`, root), content]);
    }
  }
  for (const [target, content] of output) {
    let current; try { current = await readFile(target, 'utf8'); } catch {}
    if (current === content) continue;
    if (check) throw new Error(`English record needs regeneration: ${fileURLToPath(target)}`);
    await mkdir(new URL('./', target), {recursive:true});
    await writeFile(target, content);
  }
  return output.length;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(`English records checked: ${await syncEnglishRecords({check:process.argv.includes('--check')})}`);
}

import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { portableCatalog } from './Portable-Catalog.mjs';
const out = new URL('../ios/App/App/zenix/', import.meta.url);
mkdirSync(out, { recursive: true });
cpSync(new URL('../config/distribution.json', import.meta.url), new URL('distribution.json', out));
// Both native platforms use our existing catalogue and portable source contract.
const catalog = portableCatalog();
writeFileSync(new URL('catalog.js', out), catalog);
cpSync(new URL('../android/app/src/main/assets/zenix/host.js', import.meta.url), new URL('host.js', out));
const legal = new URL('legal/', out); mkdirSync(legal, { recursive: true });
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(new URL(`../${name}`, import.meta.url), new URL(name, legal));
cpSync(new URL('../licenses/', import.meta.url), new URL('licenses/', legal), { recursive: true });

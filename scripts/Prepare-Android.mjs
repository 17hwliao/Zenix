import { mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { portableCatalog } from './Portable-Catalog.mjs';
const out = new URL('../android/app/src/main/assets/zenix/', import.meta.url);
mkdirSync(out, { recursive: true });
cpSync(new URL('../config/distribution.json', import.meta.url), new URL('distribution.json', out));
// Share our catalogue implementation; Android supplies its own HTTP/crypto adapters.
const catalog = portableCatalog();
writeFileSync(new URL('catalog.js', out), catalog);
const legal = new URL('legal/', out);
mkdirSync(legal, { recursive: true });
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(new URL(`../${name}`, import.meta.url), new URL(name, legal));
cpSync(new URL('../licenses/', import.meta.url), new URL('licenses/', legal), { recursive: true });

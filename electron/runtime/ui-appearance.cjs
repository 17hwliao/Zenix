const fs = require('node:fs/promises');
const path = require('node:path');

// The remote page keeps its existing CSP nonce and same-origin API contract.
// Fixed local resources are inlined; no arbitrary path or new HTTP route exists.
async function remoteAppearance(page) {
  const files=['blog-bento.css','application-style.css','native-style.css','nine-slice.js','appearance.js','native-appearance.js'];
  const read = folder => Promise.all(files.map(file=>fs.readFile(path.join(__dirname,'../../',folder,'ui',file),'utf8')));
  let resources;try {resources=await read('public');}catch(error){if(error.code!=='ENOENT')throw error;resources=await read('dist');}
  const [theme,application,native,geometry,model,runtime] = resources;
  const css = [theme,application,native].map(text=>text.replace(/^@import[^;]+;\s*/gm,'')).join('\n');
  const js = [geometry,model,runtime].map(text=>text.replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'')).join('\n');
  const injection=`<style>${css}</style><script type="module" nonce="__NONCE__">${js}</script>`;
  return page.includes('</head>') ? page.replace('</head>',injection+'</head>') : page.replace('</style>','</style>'+injection);
}
module.exports = {remoteAppearance};

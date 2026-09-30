function lxScriptInfo(script) {
  const field = name => (script.match(new RegExp(`^\\s*\\*\\s*@${name}\\s+(.+)$`, 'mi'))?.[1] || '').trim().slice(0, 120);
  return { name: field('name') || '自定义脚本源', description: field('description'), version: field('version') || '1', author: field('author'), homepage: field('homepage'), rawScript: script };
}

module.exports = { lxScriptInfo };

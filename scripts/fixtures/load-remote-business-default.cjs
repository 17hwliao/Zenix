// Load the production default business/library/control hosts while replacing only platform boundaries.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
module.exports=function createLoader(overrides){
 const cache=new Map();
 const root=path.resolve(__dirname,'../../src');
 const mapped=new Map(Object.entries(overrides).map(([name,value])=>[path.resolve(root,name),value]));
 function load(filename){
  filename=path.resolve(filename);if(mapped.has(filename))return mapped.get(filename);
  if(cache.has(filename))return cache.get(filename).exports;
  const mod=new Module(filename);cache.set(filename,mod);const original=Module.createRequire(filename);
  mod.require=name=>{if(name.startsWith('.')){const target=path.resolve(path.dirname(filename),name);if(mapped.has(target))return mapped.get(target);if(fs.existsSync(target+'.ts'))return load(target+'.ts');}return original(name);};
  mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);return mod.exports;
 }
 return load(path.join(root,'features/assistant/remote/business.ts'));
};

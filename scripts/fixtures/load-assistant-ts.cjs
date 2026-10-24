const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const cache=new Map();
module.exports=function load(filename){
 filename=path.resolve(filename);if(cache.has(filename))return cache.get(filename).exports;
 const mod=new Module(filename);cache.set(filename,mod);const original=Module.createRequire(filename);
 mod.require=name=>{if(name.startsWith('.')){const target=path.resolve(path.dirname(filename),name);if(fs.existsSync(target+'.ts'))return load(target+'.ts');}return original(name);};
 mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,filename);return mod.exports;
};

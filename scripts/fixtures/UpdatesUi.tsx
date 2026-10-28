import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import UpdateNotice from '../../src/ui/UpdateNotice';
import MobileSearchBar from '../../src/mobile/MobileSearchBar';
import '../../src/mobile/mobile.css';
let release: any = { status: 'available', channel: 'stable', currentVersion: '1.0.0', version: '1.1.0', build: 20, progress: 0, message: '发现更新', notes: 'Fixture 更新亮点：搜索交互改进。' };
localStorage.clear();
let downloadDone:((state:typeof release)=>void)|undefined;
(window as any).yzqxy = { updates: { invoke: async (request: any) => {
 if(request.operation === 'download'){release={...release,status:'downloading',message:'隔离下载等待中'};return new Promise(resolve=>{downloadDone=resolve;});}
 if(request.operation === 'cancel'){(window as any).cancelled=((window as any).cancelled||0)+1;release={...release,status:'error',message:'下载已取消，进度保留'};downloadDone?.({...release});downloadDone=undefined;}
 if(request.operation === "install") (window as any).installed = ((window as any).installed || 0) + 1; return {...release};
} } };
const root = createRoot(document.getElementById('root')!); let revision = 0;
function Page() { const [keyword, setKeyword] = useState(''); return <><section className="mobile-search glass"><MobileSearchBar keyword={keyword} onChange={setKeyword} onSearch={() => { (window as any).submitted = keyword; }} onClose={() => {}} /></section><UpdateNotice key={revision} /></>; }
function render() { root.render(<React.StrictMode><Page /></React.StrictMode>); }
(window as any).updateFixture = { set: (changes: any) => { release = { ...release, ...changes }; window.dispatchEvent(new Event('zenix-update-state')); }, remount: () => { revision++; render(); } };
render();

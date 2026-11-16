import React from 'react';
import {createRoot} from 'react-dom/client';
import MobileApp from '../../src/mobile/MobileApp';
if(!localStorage.getItem('zenix.space.presentation.v2'))localStorage.setItem('zenix.space.presentation.v2',JSON.stringify({schema:2,mode:'sticker',cardScale:1}));
createRoot(document.getElementById('root')!).render(<MobileApp/>);

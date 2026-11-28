import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import UpdateNotice from './ui/UpdateNotice';
import {startAutomaticUpdates} from './core/updates';
import {FeatureHost} from './features/FeatureLauncher';
import {getAssistantRuntime} from './features/assistant/remote/runtime';

startAutomaticUpdates();
// The companion belongs to the application's viewport. Close a leftover legacy
// desktop pet without changing saved figure/scale preferences.
void window.yzqxy?.companion?.invoke({operation:'assistant',action:'pet',enabled:false}).catch(()=>{});
if (window.yzqxy?.assistantChat) getAssistantRuntime(false);

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/><UpdateNotice/><FeatureHost/></React.StrictMode>);

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import UpdateNotice from './ui/UpdateNotice';
import { startAutomaticUpdates } from './core/updates';
import {FeatureHost} from './features/FeatureLauncher';
startAutomaticUpdates();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <UpdateNotice />
    <FeatureHost/>
  </React.StrictMode>,
);

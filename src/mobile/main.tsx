import React from 'react';
import { createRoot } from 'react-dom/client';
import MobileApp from './MobileApp';
import UpdateNotice from '../ui/UpdateNotice';
import { startAutomaticUpdates } from '../core/updates';
import {FeatureHost} from '../features/FeatureLauncher';
startAutomaticUpdates();

createRoot(document.getElementById('root')!).render(<React.StrictMode><MobileApp /><UpdateNotice /><FeatureHost mobile/></React.StrictMode>);

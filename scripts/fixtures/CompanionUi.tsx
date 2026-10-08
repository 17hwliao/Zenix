import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import MusicTools from '../../src/ui/MusicTools';
import type {PersonalState} from '../../src/core/types';
function Fixture(){const [personal,setPersonal]=useState<PersonalState>({liked:[],favorites:[],history:[],playlists:[]});useEffect(()=>{void window.yzqxy!.personal.load().then(setPersonal);return window.yzqxy!.personal.onChanged(setPersonal);},[]);return <MusicTools personal={personal} close={()=>{document.body.dataset.closed='true';}}/>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);

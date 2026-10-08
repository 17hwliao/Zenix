import {useEffect} from 'react';
export default function Intro({onFinish}:{onFinish?:()=>void}){useEffect(()=>{onFinish?.();},[onFinish]);return null;}

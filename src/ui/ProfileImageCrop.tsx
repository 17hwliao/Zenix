import {useEffect, useRef, useState} from 'react';
import './ProfileImageCrop.css';

type Crop = {x: number; y: number; zoom: number};
type Point = {x: number; y: number};
const center: Crop = {x: .5, y: .5, zoom: 1};
const clamp = (value: number) => Math.min(1, Math.max(0, value));

function region(width: number, height: number, ratio: number, {x,y,zoom}: Crop) {
  const w = Math.min(width, height * ratio) / zoom;
  const h = w / ratio;
  return {w,h,left: (width-w)*x,top: (height-h)*y};
}

export default function ProfileImageCrop({file,title,ratio,circle = false,transparent = false,onCancel,onApply}: {
  file: File; title: string; ratio: number; circle?: boolean; transparent?: boolean;
  onCancel(): void; onApply(value: string): void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<{id: number; start: Point; crop: Crop} | null>(null);
  const [source,setSource] = useState('');
  const [size,setSize] = useState<{width: number; height: number}>();
  const [crop,setCrop] = useState(center);
  const [error,setError] = useState(false);
  const frame = size && region(size.width,size.height,ratio,crop);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  },[file]);

  const apply = () => {
    if (!image.current || !frame) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.round(Math.min(frame.w,ratio >= 2 ? 1400 : 420)));
    canvas.height = Math.max(1,Math.round(canvas.width / ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) {setError(true); return;}
    try {
      ctx.drawImage(image.current,frame.left,frame.top,frame.w,frame.h,0,0,canvas.width,canvas.height);
      onApply(canvas.toDataURL(transparent ? 'image/png' : 'image/webp',.84));
    } catch {setError(true);}
  };

  const stop = (id: number) => {if (drag.current?.id === id) drag.current = null;};
  return <section className="zenix-profile-crop" aria-label={title}>
    <header><h3>{title}</h3><p>拖动图片选取区域，缩放后点击「应用裁剪」。</p></header>
    <div className="zenix-crop-frame" data-circle={circle} style={{aspectRatio:ratio,width:ratio > 2 ? '100%' : undefined}}
      onPointerDown={event => {
        if (!frame || !event.isPrimary || event.button !== 0) return;
        drag.current = {id:event.pointerId,start:{x:event.clientX,y:event.clientY},crop};
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const gesture = drag.current;
        if (!gesture || gesture.id !== event.pointerId || !size) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const original = region(size.width,size.height,ratio,gesture.crop);
        setCrop({...gesture.crop,
          x: clamp(gesture.crop.x - (event.clientX-gesture.start.x) * original.w / bounds.width / Math.max(1,size.width-original.w)),
          y: clamp(gesture.crop.y - (event.clientY-gesture.start.y) * original.h / bounds.height / Math.max(1,size.height-original.h)),
        });
      }}
      onPointerUp={event => stop(event.pointerId)} onPointerCancel={event => stop(event.pointerId)} onLostPointerCapture={event => stop(event.pointerId)}>
      {source && <img ref={image} src={source} alt="裁剪范围预览" draggable={false}
        onLoad={event => setSize({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})} onError={() => setError(true)}
        style={frame && size ? {width:`${size.width/frame.w*100}%`,height:`${size.height/frame.h*100}%`,left:`${-frame.left/frame.w*100}%`,top:`${-frame.top/frame.h*100}%`} : {visibility:'hidden'}}/>}
    </div>
    <div className="zenix-crop-controls">
      <label>缩放<input aria-label="裁剪缩放" type="range" min={1} max={3} step={.01} value={crop.zoom} onChange={event => setCrop({...crop,zoom:Number(event.target.value)})}/></label>
      <label>左右<input aria-label="裁剪左右位置" type="range" min={0} max={1} step={.01} value={crop.x} onChange={event => setCrop({...crop,x:Number(event.target.value)})}/></label>
      <label>上下<input aria-label="裁剪上下位置" type="range" min={0} max={1} step={.01} value={crop.y} onChange={event => setCrop({...crop,y:Number(event.target.value)})}/></label>
    </div>
    {error && <p role="alert">无法裁剪此图片，请换一张图片再试。</p>}
    <div className="zenix-crop-actions"><button type="button" onClick={() => setCrop(center)}>重置位置</button><button type="button" onClick={onCancel}>取消裁剪</button><button type="button" onClick={apply} disabled={!frame || error}>应用裁剪</button></div>
  </section>;
}

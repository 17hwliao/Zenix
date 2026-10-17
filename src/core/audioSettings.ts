export const eqFrequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const eqPresets: Record<string, {name:string; gains:number[]}> = {
  flat:{name:'原声',gains:[0,0,0,0,0,0,0,0,0,0]},
  vocal:{name:'人声',gains:[-2,-2,-1,0,1,3,3,1,0,-1]},
  bass:{name:'低音',gains:[4,4,3,1,0,-1,-1,0,0,0]},
  pop:{name:'流行',gains:[1,2,2,0,-1,0,1,2,2,1]},
};
export type AudioSettings = {enabled:boolean; gains:number[]; preset:string; output:string; applied?:boolean; error?:string};
export const defaultAudioSettings: AudioSettings = {enabled:false,gains:[0,0,0,0,0,0,0,0,0,0],preset:'flat',output:'default'};
export function validateAudio(value: AudioSettings): AudioSettings {
  if(!Array.isArray(value.gains)||value.gains.length!==10||value.gains.some(gain=>!Number.isFinite(gain)||gain < -12||gain > 12))throw Error('均衡器增益必须为 -12 至 12 dB');
  return {enabled:value.enabled===true,gains:[...value.gains],preset:String(value.preset).slice(0,30),output:String(value.output||'default').slice(0,500)};
}
export class AudioGraph {
  private context?:AudioContext; private filters:BiquadFilterNode[]=[]; private gain?:GainNode;private initialization?:Promise<void>;
  constructor(private audio:HTMLAudioElement){}
  async output(device:string){
    if(!this.context)return;const target=this.context as AudioContext&{setSinkId?:(id:string)=>Promise<void>};
    if(!target.setSinkId){if(device!=='default')throw Error('当前环境无法为均衡器选择指定输出设备');return;}
    await target.setSinkId(device==='default'?'':device);
  }
  private async initialize(value:AudioSettings){
    this.context=new AudioContext();try{await this.output(value.output);}catch(error){await this.context.close();this.context=undefined;this.initialization=undefined;throw error;}
    const source=this.context.createMediaElementSource(this.audio);this.filters=eqFrequencies.map(frequency=>{const filter=this.context!.createBiquadFilter();filter.type='peaking';filter.frequency.value=frequency;filter.Q.value=1;return filter;});this.gain=this.context.createGain();let previous:AudioNode=source;for(const filter of this.filters){previous.connect(filter);previous=filter;}previous.connect(this.gain);this.gain.connect(this.context.destination);
  }
  async apply(value:AudioSettings){
    if(!value.enabled&&!this.context)return;
    if(!this.initialization)this.initialization=this.initialize(value);await this.initialization;await this.output(value.output);
    const now=this.context!.currentTime;
    this.filters.forEach((filter,index)=>filter.gain.setTargetAtTime(value.enabled?value.gains[index]:0,now,.03));
    this.gain!.gain.setTargetAtTime(value.enabled?Math.pow(10,-Math.max(0,...value.gains)/20):1,now,.03);
    await this.context!.resume();
  }
  resume(){void this.context?.resume().catch(()=>{});}
  close(){void this.context?.close().catch(()=>{});}
}

import {zipSync,strToU8} from 'fflate';
const atlases=import.meta.glob('../../../assets/assistant/*.png',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
export const costumes=[['ivory-dragon','银龙礼服'],['violet-stars','紫星猫娘'],['noir-gold','黑金礼裙'],['amber-scholar','暖橙书卷'],['moon-piano','月光琴音'],['ink-fox','墨色狐耳'],['azure-fan','青蓝折扇'],['ocean-maid','海蓝女仆']].map(([id,name])=>({id,name,url:atlases[`../../../assets/assistant/${id}.png`]}));
/** Decode only the chosen atlas. Export through the existing script-free skin contract. */
export async function costumeFile(id:string){
 const costume=costumes.find(row=>row.id===id);if(!costume)throw Error('皮肤不存在');
 const image=new Image();image.src=costume.url;await image.decode();if(image.naturalWidth%2||image.naturalHeight%2)throw Error('皮肤图集网格无效');
 const width=image.naturalWidth/2,height=image.naturalHeight/2,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法准备皮肤');
 const files:Record<string,Uint8Array>={},frames:string[]=[];
 for(let index=0;index<4;index++){ctx.clearRect(0,0,width,height);ctx.drawImage(image,index%2*width,Math.floor(index/2)*height,width,height,0,0,width,height);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('无法读取皮肤帧')),'image/png'));const name=`frames/pose-${index}.png`;files[name]=new Uint8Array(await blob.arrayBuffer());frames.push(name);}
 const pose=(frame:number)=>({frames:[frame],fps:12,loop:false});
 const config={schema:1,name:`Zenix 星音 · ${costume.name}`,author:'Zenix',version:'1.0',width,height,frames,animations:{idle:pose(0),shy:pose(1),greeting:pose(2),cheer:pose(2),listening:pose(3),thinking:pose(3),talking:pose(3),success:pose(2)}};
 files['skin.json']=strToU8(JSON.stringify(config));return new File([zipSync(files).slice().buffer as ArrayBuffer],`${id}.zenixskin`,{type:'application/zip'});
}

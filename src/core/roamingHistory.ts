import type {Track} from './types';

/** Current song plus at most three songs heard in this roaming session. */
export class RoamingHistory {
  private entries:Track[]=[];
  private cursor=-1;
  clear(){this.entries=[];this.cursor=-1;}
  record(track:Track){
    const at=this.entries.findIndex(song=>song.id===track.id);
    if(at>=0){this.entries[at]=track;this.cursor=at;return;}
    this.entries=[...this.entries.slice(0,this.cursor+1),track].slice(-4);this.cursor=this.entries.length-1;
  }
  previous(currentId?:string){
    if(this.cursor<0)return;
    if(this.entries[this.cursor].id!==currentId)return this.entries[this.cursor];
    if(this.cursor===0)return;
    return this.entries[--this.cursor];
  }
  next(currentId?:string){
    if(this.entries[this.cursor]?.id!==currentId||this.cursor>=this.entries.length-1)return;
    return this.entries[++this.cursor];
  }
  has(id:string){return this.entries.some(song=>song.id===id);}
  get(id:string){return this.entries.find(song=>song.id===id);}
  before(currentId?:string){const at=this.entries.findIndex(song=>song.id===currentId);return this.entries.slice(0,at<0?this.cursor+1:at).slice(-3);}
  after(currentId?:string){const at=this.entries.findIndex(song=>song.id===currentId);return at<0?[]:this.entries.slice(at+1);}
}

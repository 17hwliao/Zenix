import type { Track } from './types';
type Event = { type: string; track?: Track };
type Writer = (track: Track, seconds: number, plays: number) => Promise<unknown>;
/** Measure audible wall time, never the seekable media position. */
export class ListeningTracker {
  private track?: Track;
  private audible = false;
  private clock: number;
  private seconds = 0;
  private pending = 0;
  private counted = false;
  constructor(private write: Writer, private now = () => performance.now(), private onError = (error: unknown) => console.warn('听歌统计保存失败', error)) { this.clock = now(); }
  tick() {
    const at = this.now(), delta = Math.min(5, Math.max(0, (at-this.clock)/1000)); this.clock=at;
    if (!this.audible || !this.track) return;
    this.seconds += delta; this.pending += delta;
    const threshold = this.track.duration>0 ? Math.min(30,this.track.duration/2) : 30;
    const count = !this.counted && this.seconds>=threshold;
    if(count)this.counted=true;
    if(this.pending>=10 || count)this.flush(count);
  }
  private flush(count=false) { if(!this.track || this.pending<=0&&!count)return;const seconds=this.pending;this.pending=0;void this.write(this.track,seconds,count?1:0).catch(this.onError); }
  handle(event: Event) {
    this.tick();
    if(['manual','selected','ended'].includes(event.type)){this.flush();this.audible=false;this.track=event.type==='selected'?event.track:undefined;this.seconds=0;this.counted=false;}
    else if(event.type==='audible'){if(this.track?.id!==event.track?.id){this.flush();this.track=event.track;this.seconds=0;this.counted=false;}this.audible=true;}
    else if(['waiting','pause','pause-request','failure'].includes(event.type)){this.audible=false;this.flush();}
    this.clock=this.now();
  }
  close(){this.tick();this.flush();this.audible=false;}
}

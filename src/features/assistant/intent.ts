import {parse} from './skin';
import {libraryIntent} from './libraryIntent';
import {controlIntent} from './controlIntent';
export type Intent={kind:'action'|'reply'|'unknown'|'confirm';action?:string;args?:Record<string,unknown>;reply:string;emotion?:string};
/** Local, bounded music intents. Recognition text never becomes executable code. */
export function understand(input:string,confidence=1):Intent{
 const original=input.trim().slice(0,200);
 let text=original.replace(/[，。！？、,.!?]/g,'').replace(/^(?:嘿|你好)?(?:星音|星星|Zenix)[呀啊]?/i,'').replace(/^(?:(?:请你|麻烦你|帮我|给我|请|麻烦))+/,'').replace(/(?:好吗|可以吗|吧|一下|谢谢)$/,'').trim();
 if(!text)return {kind:'unknown',reply:'没有听清，可以再说一次，或输入文字。'};
 if(/^(你好|嗨|早上好|晚上好|在吗|hello|hi)$/i.test(text))return {kind:'reply',reply:'我在。想听什么？你可以让我查歌词、打开歌单、整理喜欢收藏，或搜索和切歌。'};
 if(/^(你是谁|介绍一下自己|你叫什么|你叫什么名字)$/.test(text))return {kind:'reply',reply:'我是 Zenix 的音乐助手星音，负责帮你操作音乐。'};
 if(/^(谢谢你?|多谢|辛苦了)$/.test(text))return {kind:'reply',reply:'不客气，陪你听歌很开心。',emotion:'success'};
 if(/^(你好可爱|你真可爱|好可爱|摸摸头|害羞一下|害羞|你真好看)$/.test(text))return {kind:'reply',reply:'被你发现啦……我有一点点害羞。',emotion:'shy'};
 if(/^(你会什么|帮助|怎么用|能做什么)$/.test(text))return {kind:'reply',reply:'按住说话，松开发送。可以说：当前歌曲的歌词是什么、歌手是谁、前面第三首的歌手、后面五首的名字、前后各两首的全部信息、返回主页、打开歌单《通勤》、创建歌单、把当前歌单全部加入喜欢。删除和批量操作会先请你确认。'};
 if(/^(不要|别|不想|不用|取消|停止识别)/.test(text)||/(然后|接着|并且|再给我)/.test(text))return {kind:'unknown',reply:'这句话有否定或多个操作，我先不执行。请一次说一个明确指令。'};
 const control=controlIntent(text,confidence);if(control)return control;
 const library=libraryIntent(original.replace(/^(?:嘿|你好)?(?:星音|星星|Zenix)[呀啊]?[，,\s]*/i,'').replace(/^(?:(?:请你|麻烦你|帮我|给我|请|麻烦))+/,'').replace(/(?:好吗|可以吗|谢谢|一下|吧)[。！!?？]?$/,'').replace(/[。！!?？]$/,'').trim(),confidence);
 if(library)return library;
 const aliases:Record<string,string>={停一下:'暂停',先停一下:'暂停',停一停:'暂停',暂停音乐:'暂停',继续听:'继续播放',接着放:'继续播放',开始播放:'播放',放音乐:'播放',换一首:'下一首',换首歌:'下一首',下一手:'下一首',上一手:'上一首',回到上一首:'上一首',重听上一首:'上一首',记住这里:'标记当前片段',记下这一段:'标记当前片段'};
 text=aliases[text]||text;
 const find=text.match(/^(?:我想听|想听|我想找|帮我找|播放一首|放一首|播放歌曲|播放|搜索一下|搜索|搜一下|找一下|找歌)\s*[《“"]?(.+?)[》”"]?$/);
 let command=parse(text);
 if(find&&!['播放','继续播放'].includes(text)){
  const query=find[1].replace(/的(?=[^的]+$)/,' ').trim();
  if(query)command={action:'search',args:{query}};
 }
 if(!command)return {kind:'unknown',reply:'这句话还没对应到音乐操作。可以说“下一首”，或“搜索 歌名”；也可以修改下方文字。'};
 const descriptions:Record<string,string>={play:'继续播放',pause:'暂停播放',next:'切到下一首',previous:'播放上一首',bookmark:'标记当前片段',tasks:'打开缓存任务',search:`搜索“${String(command.args.query||'')}”`};
 return {kind:confidence>=.62?'action':'confirm',...command,reply:descriptions[command.action]||'执行操作'};
}

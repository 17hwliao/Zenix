function audioPrefix(bytes){
  const b=Buffer.from(bytes),text=b.toString('utf8');
  return b.length>=4&&(text.startsWith('ID3')||text.startsWith('fLaC')||text.startsWith('OggS')||text.startsWith('#EXTM3U')||text.startsWith('RIFF')&&b.toString('ascii',8,12)==='WAVE'||b.toString('ascii',4,8)==='ftyp'||b[0]===255&&(b[1]&224)===224);
}
async function checkResponse(response,signal){
  if(!response.ok||!response.body)throw Error(`音频返回HTTP ${response.status}`);
  const reader=response.body.getReader();let bytes=Buffer.alloc(0);
  try{while(bytes.length<16){signal?.throwIfAborted();const row=await reader.read();if(row.done)break;bytes=Buffer.concat([bytes,Buffer.from(row.value).subarray(0,64)]);}if(!audioPrefix(bytes))throw Error('响应不是可识别的音频');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
module.exports={audioPrefix,checkResponse};

/** Keep each utterance below both platform limits, without truncating the response. */
export function speechChunks(messages:string[],limit=260):string[]{
 const result:string[]=[];for(const message of messages){let chunk='';for(const character of message){if(chunk.length+character.length>limit){result.push(chunk);chunk='';}chunk+=character;if(/[。！？\n]/.test(character)&&chunk.length>=80){result.push(chunk);chunk='';}}if(chunk.trim())result.push(chunk);}return result;
}

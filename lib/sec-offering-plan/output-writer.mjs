import {open,readFile,rename,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function decode(bytes){
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  if(text.includes('\ufffd'))throw Error('replacement_character_forbidden');
  return text;
}
async function absent(path){try{await stat(path);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('immutable_target_exists:'+path);}
export async function atomicCreate(path,bytes){
  await absent(path);
  const file=await open(path+'.pending','wx',0o600);
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await absent(path);await rename(path+'.pending',path);
}
// The CLI writes final JSON directly to a file. No JSON text crosses a shell.
// Never fix JSON, strip fences, normalize Unicode, replace characters or reserialize raw output.
export async function freezeOutput(inputPath,outputPath,freezePath){
  const lock=await open(outputPath+'.lock','wx',0o600);
  try{
    await absent(outputPath);await absent(freezePath);
    const original=await readFile(inputPath),text=decode(original);
    const semantic=JSON.parse(text),roundTrip=Buffer.from(text,'utf8');
    if(!roundTrip.equals(original))throw Error('utf8_roundtrip_mismatch');
    await atomicCreate(outputPath,roundTrip);
    const saved=await readFile(outputPath),readBack=JSON.parse(decode(saved));
    if(!saved.equals(original)||!isDeepStrictEqual(semantic,readBack))throw Error('saved_output_mismatch');
    if(!isDeepStrictEqual(semantic,JSON.parse(JSON.stringify(readBack))))throw Error('semantic_roundtrip_mismatch');
    const frozen={protocol:'offering-output-r2',sha256:sha256(saved),bytes:saved.length,frozenAt:new Date().toISOString(),strictUtf8:true,byteIdentical:true,semanticIdentical:true};
    await atomicCreate(freezePath,Buffer.from(JSON.stringify(frozen,null,2)+'\n','utf8'));
    const verified=JSON.parse(decode(await readFile(freezePath)));
    if(verified.sha256!==sha256(await readFile(outputPath)))throw Error('freeze_hash_mismatch');
    return {value:readBack,freeze:frozen};
  }finally{await lock.close();} // Permanent one-shot marker; no overwrite or retry.
}

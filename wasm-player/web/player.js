import {makeRenderer} from "./renderer.js";
const $=id=>document.getElementById(id);
const canvas=$("canvas"),panel=$("panel"),seek=$("seek"),play=$("play"),status=$("status");
const LIMIT=128*1024*1024, HIGH=8, LOW=3;
let renderer, worker, abort, loadId=0, generation=0, queue=[], inflight=false, ready=false,
    eof=false, playing=false, seeking=false, duration=0, current=0, rate=1, anchor=0,
    running=false, preview=false, dragging=false, lastFrame=null, framesShown=0, framesDropped=0;
const now=()=>performance.now()/1000;
function message(s,error=false){status.textContent=s;status.classList.toggle("error",error);}
function fmt(t){t=Math.max(0,Math.floor(t||0));let m=Math.floor(t/60),s=t%60;return String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");}
function controls(){
  play.disabled=!ready;play.textContent=playing?"❚❚":"▶";
  seek.disabled=!ready||duration<=0;
  seek.max=duration||0;
  if(!dragging)seek.value=Math.min(current,duration||current);
  $("time").textContent=fmt(dragging?Number(seek.value):current)+" / "+fmt(duration);
}
function haltClock(){running=false;}
function startClock(){anchor=now()-current/rate;running=true;}
function error(e){
  playing=false;ready=false;seeking=false;inflight=false;haltClock();queue=[];
  if(worker){worker.terminate();worker=null;}
  message(String(e.message||e),true);controls();
}
function pull(force=false){
  if(!worker||!ready||seeking||inflight||eof||(!playing&&!preview))return;
  if(!force&&queue.length>LOW)return;
  const count=Math.min(3,HIGH-queue.length);if(count<=0)return;
  inflight=true;worker.postMessage({type:"pull",generation,count});
}
function show(f){
  renderer.draw(f);current=f.pts;lastFrame=f;framesShown++;
  $("info").textContent=f.width+" × "+f.height+" | FFmpeg WASM CPU | "+renderer.name+
     " | 缓冲 "+queue.length+" 帧 | 已显示 "+framesShown+" | 跳过 "+framesDropped;
}
function handle(data){
  if(data.generation!==generation)return;
  if(data.type==="error"){error(data.message);return;}
  if(data.type==="opened"){
    ready=true;duration=Math.max(0,Number(data.duration)||0);preview=true;
    message("视频已打开，正在解码首帧…");controls();pull(true);
  }else if(data.type==="seeked"){
    seeking=false;preview=true;pull(true);
  }else if(data.type==="frames"){
    inflight=false;eof=data.eof;queue.push(...data.frames);
    if(preview&&queue.length){
      try{show(queue.shift());}catch(e){error(e);return;}
      preview=false;haltClock();message(playing?"播放中":"已就绪");
      controls();
    }else if(preview&&eof){
      preview=false;playing=false;haltClock();message("目标时间后没有可显示的视频帧");controls();
    }
    pull();
  }
}
async function readURL(url,signal){
  const u=new URL(url,location.href);
  if(!["http:","https:"].includes(u.protocol))throw new Error("只接受 HTTP/HTTPS URL");
  const r=await fetch(u,{signal});
  if(!r.ok)throw new Error("HTTP "+r.status);
  const size=Number(r.headers.get("content-length"));
  if(size>LIMIT)throw new Error("视频超过 128 MiB");
  if(!r.body||!r.body.getReader){const b=await r.arrayBuffer();if(b.byteLength>LIMIT)throw new Error("视频超过 128 MiB");return b;}
  const reader=r.body.getReader(),chunks=[];let total=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;
      if(total>LIMIT){await reader.cancel();throw new Error("视频超过 128 MiB");}
      chunks.push(value);message("下载中 "+(total/1048576).toFixed(1)+" MiB");
    }
  }finally{reader.releaseLock();}
  const out=new Uint8Array(total);let pos=0;
  for(const c of chunks){out.set(c,pos);pos+=c.length;}return out.buffer;
}
async function load(source,auto=false){
  const id=++loadId;generation++;if(abort)abort.abort();abort=new AbortController();
  if(worker)worker.terminate();worker=null;
  queue=[];inflight=ready=eof=seeking=preview=false;playing=auto;haltClock();
  current=duration=framesShown=framesDropped=0;lastFrame=null;controls();$("info").textContent="";
  try{
    if(!window.WebAssembly)throw new Error("浏览器不支持 WebAssembly");
    if(!renderer)renderer=makeRenderer(canvas);
    message("正在读取视频…");
    let buffer;
    if(source instanceof File){
      if(source.size>LIMIT)throw new Error("视频超过 128 MiB");
      buffer=await source.arrayBuffer();
    }else buffer=await readURL(source,abort.signal);
    if(id!==loadId)return;
    message("正在加载 FFmpeg WASM 解码器…");
    worker=new Worker("./decoder.worker.js");
    worker.onmessage=e=>{if(id===loadId)handle(e.data);};
    worker.onerror=e=>{if(id===loadId)error(e.message||"WASM 加载失败");};
    worker.postMessage({type:"open",generation,buffer},[buffer]);
  }catch(e){if(id===loadId&&e.name!=="AbortError")error(e);}
}
function jump(t){
  if(!ready||!worker||!duration)return;
  t=Math.max(0,Math.min(t,Math.max(0,duration-0.05)));
  generation++;queue=[];inflight=false;eof=false;seeking=true;preview=true;
  current=t;haltClock();message("正在定位关键帧…");controls();
  worker.postMessage({type:"seek",generation,seconds:t});
}
function toggle(){
  if(!ready)return;
  if(eof&&!queue.length&&!playing){playing=true;jump(0);return;}
  playing=!playing;haltClock();controls();
  if(playing){message("播放中");pull(true);}else message("已暂停");
}
function tick(){
  requestAnimationFrame(tick);
  if(!playing||!ready||seeking||preview)return;
  if(!queue.length){
    haltClock();
    if(eof){playing=false;message("播放结束");controls();}
    else{message("解码缓冲中…");pull(true);}
    return;
  }
  if(!running)startClock();
  const t=(now()-anchor)*rate;
  let latest=null;
  while(queue.length&&queue[0].pts<=t+0.002){if(latest)framesDropped++;latest=queue.shift();}
  if(latest){try{show(latest);}catch(e){error(e);return;}controls();}
  pull();
}
$("load").onclick=()=>{const url=$("url").value.trim();if(url)load(url,true);};
$("url").onkeydown=e=>{if(e.key==="Enter")$("load").click();};
$("file").onchange=e=>{if(e.target.files[0])load(e.target.files[0],true);};
play.onclick=toggle;
seek.oninput=()=>{dragging=true;controls();};
seek.onchange=()=>{const t=Number(seek.value);dragging=false;jump(t);};
$("speed").onchange=e=>{rate=Number(e.target.value);haltClock();};
$("full").onclick=async()=>{
  if(document.fullscreenElement){await document.exitFullscreen();return;}
  if(panel.classList.contains("full")){panel.classList.remove("full");return;}
  try{if(panel.requestFullscreen){await panel.requestFullscreen();return;}}catch(_){}
  panel.classList.add("full");
};
document.addEventListener("keydown",e=>{if(e.key==="Escape")panel.classList.remove("full");});
canvas.onclick=toggle;
const q=new URLSearchParams(location.search);
const svg=q.get("svg")||q.get("overlay");
if(svg){try{const u=new URL(svg,location.href);if(["https:","http:"].includes(u.protocol)){$("overlay").src=u.href;$("overlay").hidden=false;}}catch(_){}}
if(q.get("video")){$("url").value=q.get("video");load(q.get("video"),q.get("autoplay")==="1");}
controls();requestAnimationFrame(tick);

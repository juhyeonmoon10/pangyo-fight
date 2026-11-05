/* Browser adapter for the MIT-licensed fiiight / IKEMEN GO WASM backend.
   Actual character logic, physics, hitboxes and rendering run in IKEMEN. */
(() => {
 'use strict';
 let started=false,activeCallbacks=null;
 const script=src=>new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(new Error('실행 파일을 불러오지 못했습니다: '+src));document.head.append(el);});
 const callFs=(name,...args)=>new Promise((resolve,reject)=>globalThis.fs[name](...args,(e,r)=>e?reject(e):resolve(r)));
 async function writeText(name,text){const bytes=new TextEncoder().encode(text);const fd=await callFs('open',name,1|64|512,0o644);try{await callFs('write',fd,bytes,0,bytes.length,0);}finally{await callFs('close',fd);}}
 const cleanName=(value,fallback)=>Array.from(String(value||'').replace(/[\u0000-\u001f\u007f]/g,'').trim()).slice(0,16).join('')||fallback;
 function reportError(err){const text=err?.message||String(err);activeCallbacks?.onError?.(new Error(text));}
 window.__ikemenShowError=message=>{reportError(message);};
 window.PangyoEngine={
  async start(options={}){
   if(started)throw new Error('게임을 다시 시작하려면 페이지를 새로고침하세요.');
   const {canvas,onProgress=()=>{},onReady=()=>{},onError=()=>{},onExit=()=>{}}=options;
   if(!canvas||canvas.id!=='ikemen-canvas')throw new Error('게임 화면을 찾지 못했습니다.');
   const probe=document.createElement('canvas');
   const gl=probe.getContext('webgl2');
   if(!gl||typeof WebAssembly!=='object')throw new Error('이 브라우저에서 WebGL 2 또는 WebAssembly를 사용할 수 없습니다. 크롬 업데이트와 기기 설정을 확인해 주세요.');
   gl.getExtension('WEBGL_lose_context')?.loseContext();
   started=true;activeCallbacks={onProgress,onReady,onError,onExit};
   let ready=false,failed=false;
   const fail=e=>{if(failed)return;failed=true;onError(e instanceof Error?e:new Error(String(e)));};
   const log=[];log.push=function(...lines){for(const line of lines){if(String(line).includes('PANGYO_READY')&&!ready){ready=true;onReady();canvas.focus();window.__ikemenResumeAudio?.();}}return Array.prototype.push.apply(this,lines);};
   globalThis.__ikemenBootLog=log;
   window.__ikemenShowError=message=>fail(new Error(message));
   try{
    onProgress({message:'격투 엔진을 준비하고 있어요',fraction:.02});
    await script('./runtime/wasm_exec.js');
    await script('./runtime/fs-shim.js');
    const manifestResponse=await fetch('./assets/game-manifest.json',{cache:'no-cache'});
    if(!manifestResponse.ok)throw new Error('게임 데이터 목록을 불러오지 못했습니다.');
    const manifest=await manifestResponse.json();
    if(options.network&&globalThis.__ikemenRTC?.buildId!==manifest.buildId)throw new Error('연결 중 게임 버전이 바뀌었어요. 두 사람 모두 페이지를 새로고침하고 다시 방을 만들어 주세요.');
    let indexed=0;
    for(const pack of manifest.packs){
     await mountZipIndex(pack.url,'/ikemen',{onProgress:(loaded,total)=>onProgress({message:'게임 자료를 불러오고 있어요',loaded,total,fraction:.05+.25*(indexed+(total?loaded/total:0))/manifest.packs.length})});
     indexed++;onProgress({message:'캐릭터 자료 준비 중',fraction:.05+.25*indexed/manifest.packs.length});
    }
    await prefetchLazy('/ikemen',['data/','font/','external/'],(loaded,total)=>onProgress({message:'판교고 화면을 불러오고 있어요',loaded,total,fraction:.3+.3*(total?loaded/total:0)}));
    // The shell provides a Chromebook layout; edited controls persist after first boot.
    let reset=true;try{reset=localStorage.getItem('pangyo-layout')!=='chromebook-1';}catch{}
    if(reset){await writeText('/ikemen/save/config.ini',manifest.config);try{localStorage.setItem('pangyo-layout','chromebook-1');}catch{}}
    const players=options.players||[];
    await writeText('/ikemen/data/pangyo/players.txt',cleanName(players[0],'1P 도전자')+'\n'+cleanName(players[1],'2P 도전자')+'\n');
    globalThis.process.chdir('/ikemen');
    onProgress({message:'게임 실행 파일을 불러오고 있어요',fraction:.62});
    const response=await fetch(manifest.engine.url);
    if(!response.ok)throw new Error('격투 엔진 다운로드 오류: '+response.status);
    const reader=response.body?.getReader();let wasm;
    if(reader){const chunks=[];let received=0;for(;;){const r=await reader.read();if(r.done)break;chunks.push(r.value);received+=r.value.length;onProgress({message:'격투 엔진 다운로드 중',loaded:received,total:manifest.engine.bytes,fraction:.62+.27*Math.min(1,received/manifest.engine.bytes)});}wasm=new Uint8Array(received);let offset=0;for(const c of chunks){wasm.set(c,offset);offset+=c.length;}}
    else wasm=new Uint8Array(await response.arrayBuffer());
    const go=new Go();go.argv=['ikemen','-windowed'];
    const demo=new URLSearchParams(location.search).get('demo')==='1';
    if(options.network){if(!globalThis.__ikemenRTC)throw new Error('상대 연결이 준비되지 않았습니다.');go.argv.push(demo?'-ip':'-webnet',demo?(options.network.role==='host'?'':'192.0.2.1'):options.network.role);}
    if(demo)go.argv.push('-p1','ryu/pangyo-ryu.def','-p2','student02/student02.def','-p1.ai','5','-p2.ai','5','-s','stages/school.def','-time','30','-rounds','1','-loadmotif');
    let exitCode=0;go.exit=code=>{exitCode=code;for(const timer of go._scheduledTimeouts.values())clearTimeout(timer);go._scheduledTimeouts.clear();};
    onProgress({message:'캐릭터와 기술을 준비하고 있어요. 첫 실행은 잠시 걸릴 수 있어요.',fraction:.92});
    const result=await WebAssembly.instantiate(wasm,go.importObject);
    const run=go.run(result.instance);
    const detach=()=>globalThis.__ikemenRTC?.shutdownAfterEngineExit?.();
    run.then(()=>{detach();if(exitCode!==0)fail(new Error('게임이 종료되었습니다 ('+exitCode+').\n'+log.slice(-12).join('\n')));else onExit();},error=>{detach();fail(error);});
   }catch(e){fail(e);throw e;}
  },
  resumeAudio(){window.__ikemenResumeAudio?.();},
  getDiagnostics(){return{fps:globalThis.__ikemenFPS??null,log:(globalThis.__ikemenBootLog||[]).slice(-30),assets:globalThis.__fsLazyStats??null};}
 };
 for(const event of ['pointerdown','keydown'])window.addEventListener(event,()=>window.__ikemenResumeAudio?.(),{passive:true});
})();

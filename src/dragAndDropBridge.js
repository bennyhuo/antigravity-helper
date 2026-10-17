// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PATCH_VERSION = 'v8';
const LEGACY_BLOCK_REGEX = /\/\* AGY_HELPER_(?:TOP_)?START(?::[^\s*]+)? \*\/[\s\S]*?\/\* AGY_HELPER_(?:TOP_)?END(?::[^\s*]+)? \*\//g;

const WORKBENCH_CSS_START = `/* AGY_HELPER_WORKBENCH_CSS_START:${PATCH_VERSION} */`;
const WORKBENCH_CSS_END = `/* AGY_HELPER_WORKBENCH_CSS_END:${PATCH_VERSION} */`;
const WORKBENCH_CSS_LEGACY_REGEX = /\/\* AGY_HELPER_WORKBENCH_CSS_START(?::[^\s*]+)? \*\/[\s\S]*?\/\* AGY_HELPER_WORKBENCH_CSS_END(?::[^\s*]+)? \*\//g;

const STATE_FILE_PATH = path.join(__dirname, '..', '.agy-helper-state.json');

const WORKBENCH_WIDGET_CSS_RULES = `
#agy-helper-selection-widget{
  position:fixed;
  z-index:2147483647;
  display:flex;
  align-items:center;
  padding:2px;
  border-radius:6px;
  background:var(--vscode-editorWidget-background,#252526);
  border:1px solid var(--vscode-editorWidget-border,var(--vscode-contrastBorder,rgba(128,128,128,0.35)));
  box-shadow:0 4px 12px rgba(0,0,0,0.32);
  opacity:0;
  pointer-events:none;
  transform:translateY(3px) scale(0.96);
  transition:opacity 0.12s ease,transform 0.12s ease;
  user-select:none;
  -webkit-app-region:no-drag;
}
#agy-helper-selection-widget.agy-visible{
  opacity:1;
  pointer-events:auto;
  transform:translateY(0) scale(1);
}
#agy-helper-selection-btn{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:3px 9px;
  border:none;
  border-radius:4px;
  background:transparent;
  color:var(--vscode-editorWidget-foreground,var(--vscode-foreground,#cccccc));
  font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,sans-serif);
  font-size:12px;
  font-weight:500;
  line-height:16px;
  cursor:pointer;
  white-space:nowrap;
  outline:none;
}
#agy-helper-selection-btn:hover{
  background:var(--vscode-toolbar-hoverBackground,rgba(90,93,94,0.31));
  color:var(--vscode-foreground,#ffffff);
}
#agy-helper-selection-btn:active{
  background:var(--vscode-toolbar-activeBackground,rgba(99,102,103,0.31));
}
#agy-helper-selection-btn svg{
  width:13px;
  height:13px;
  fill:currentColor;
  flex-shrink:0;
  opacity:0.9;
}
#agy-helper-drop-zone{
  position:fixed;
  z-index:2147483646;
  display:none;
  align-items:center;
  justify-content:center;
  pointer-events:none;
  background:transparent;
  box-sizing:border-box;
  transition:background-color 0.12s ease,opacity 0.12s ease;
}
#agy-helper-drop-zone.agy-armed{
  display:flex;
  pointer-events:auto!important;
}
#agy-helper-drop-zone .agy-helper-drop-box{
  pointer-events:none!important;
  opacity:0;
  transform:scale(0.96);
  transition:opacity 0.12s ease,transform 0.12s ease;
  padding:14px 20px;
  border-radius:8px;
  background:var(--vscode-editorWidget-background,rgba(30,30,30,0.92));
  color:var(--vscode-foreground,#ffffff);
  border:1px solid var(--vscode-focusBorder,#007fd4);
  box-shadow:0 4px 16px rgba(0,0,0,0.35);
  font-family:var(--vscode-font-family,-apple-system,BlinkMacSystemFont,sans-serif);
  font-size:13px;
  font-weight:500;
  display:flex;
  align-items:center;
  gap:8px;
  user-select:none;
}
#agy-helper-drop-zone.agy-dragging{
  display:flex;
  pointer-events:auto!important;
  background-color:rgba(0,127,212,0.14);
  outline:2px dashed var(--vscode-focusBorder,#007fd4);
  outline-offset:-6px;
}
#agy-helper-drop-zone.agy-dragging .agy-helper-drop-box{
  opacity:1;
  transform:scale(1);
}`;

const WORKBENCH_CSS_SNIPPET = `\n${WORKBENCH_CSS_START}${WORKBENCH_WIDGET_CSS_RULES}\n${WORKBENCH_CSS_END}\n`;

/**
 * Self-contained Workbench script that runs inside the main VS Code workbench window (`workbench.desktop.main.js`).
 * Provides:
 * 1. A transparent drag-and-drop overlay positioned over the Antigravity Chat panel ONLY while dragging.
 * 2. A floating `Chat` button next to active text selections in code editors.
 *
 * Communicates directly with `bennyhuo.antigravity-helper` via VS Code's internal `ICommandService`
 * and checks `IContextKeyService` (`antigravityHelper.active`) so disabling or uninstalling
 * Antigravity Helper immediately deactivates all UI effects without touching the Antigravity extension.
 *
 * IMPORTANT: Must NOT use `.innerHTML` because VS Code's workbench CSP enforces
 * `require-trusted-types-for 'script'` (`TrustedHTML`).
 */
const WORKBENCH_HELPER_SCRIPT = `(function(WebviewCtor){
  let commandService=null,contextKeyService=null,instantiationService=null,commandServiceId=null,contextKeyServiceId=null,contextListenerBound=false;

  try{
    const origMapSet=Map.prototype.set;
    if(!origMapSet.__agyHelperHooked){
      const hookedMapSet=function(k,v){
        try{
          if(typeof k==="function"){
            const id=String(k);
            if(id==="commandService"){
              commandServiceId=k;
              if(v&&typeof v.executeCommand==="function")commandService=v;
            }else if(id==="contextKeyService"){
              contextKeyServiceId=k;
              if(v&&typeof v.getContextKeyValue==="function")contextKeyService=v;
            }else if(id==="instantiationService"&&v&&typeof v.invokeFunction==="function"){
              instantiationService=v;
            }
            if(commandService&&contextKeyService&&Map.prototype.set===hookedMapSet){
              Map.prototype.set=origMapSet;
            }
          }
        }catch(_){}
        return origMapSet.apply(this,arguments);
      };
      hookedMapSet.__agyHelperHooked=true;
      Map.prototype.set=hookedMapSet;
    }
  }catch(_){}

  function registerWebviewInstance(wv){
    if(!wv||typeof wv!=="object")return;
    try{
      (window.__agyHelperWebviews=window.__agyHelperWebviews||new Set()).add(wv);
      if(wv._instantiationService&&!instantiationService&&typeof wv._instantiationService.invokeFunction==="function"){
        instantiationService=wv._instantiationService;
      }
      if(wv._contextKeyService&&!contextKeyService&&typeof wv._contextKeyService.getContextKeyValue==="function"){
        contextKeyService=wv._contextKeyService;
      }
    }catch(_){}
  }

  try{
    if(WebviewCtor&&WebviewCtor.prototype&&!WebviewCtor.prototype.__agyHelperMountHooked){
      WebviewCtor.prototype.__agyHelperMountHooked=true;
      for(const m of ["mountTo","setContextKeyService","postMessage","_send","doPostMessage","setHtml","style"]){
        const orig=WebviewCtor.prototype[m];
        if(typeof orig==="function"){
          WebviewCtor.prototype[m]=function(...args){
            registerWebviewInstance(this);
            return orig.apply(this,args);
          };
        }
      }
      const origDispose=WebviewCtor.prototype.dispose;
      if(typeof origDispose==="function"){
        WebviewCtor.prototype.dispose=function(...args){
          try{window.__agyHelperWebviews&&window.__agyHelperWebviews.delete(this);}catch(_){}
          return origDispose.apply(this,args);
        };
      }
    }
  }catch(_){}

  if(typeof window==="undefined"||window.__agyHelperWorkbenchInit==="${PATCH_VERSION}")return;
  window.__agyHelperWorkbenchInit="${PATCH_VERSION}";

  let widget=null,dropZone=null,dragLeaveTimer=null,checkTimer=null,extraTimers=[],suppressUntil=0,lastMouseUpX=0,lastMouseUpY=0,lastMouseUpTs=0,isMouseDown=false,lastEditor=null;

  function resolveServices(){
    try{
      if((!instantiationService||!contextKeyService)&&window.__agyHelperWebviews){
        for(const wv of Array.from(window.__agyHelperWebviews)){
          if(wv&&wv._instantiationService&&!instantiationService&&typeof wv._instantiationService.invokeFunction==="function"){
            instantiationService=wv._instantiationService;
          }
          if(wv&&wv._contextKeyService&&!contextKeyService&&typeof wv._contextKeyService.getContextKeyValue==="function"){
            contextKeyService=wv._contextKeyService;
          }
        }
      }
      if(instantiationService&&(!commandServiceId||!contextKeyServiceId)){
        let cur=instantiationService;
        while(cur){
          const entries=cur._services&&cur._services._entries;
          if(entries&&typeof entries.keys==="function"){
            for(const k of entries.keys()){
              const id=String(k);
              if(id==="commandService"&&!commandServiceId)commandServiceId=k;
              else if(id==="contextKeyService"&&!contextKeyServiceId)contextKeyServiceId=k;
            }
          }
          cur=cur._parent;
        }
      }
      if(!commandService&&instantiationService&&commandServiceId){
        try{commandService=instantiationService.invokeFunction((acc)=>acc.get(commandServiceId));}catch(_){}
      }
      if(!contextKeyService&&instantiationService&&contextKeyServiceId){
        try{contextKeyService=instantiationService.invokeFunction((acc)=>acc.get(contextKeyServiceId));}catch(_){}
      }
      if(contextKeyService&&!contextListenerBound&&typeof contextKeyService.onDidChangeContext==="function"){
        contextListenerBound=true;
        contextKeyService.onDidChangeContext((e)=>{
          try{
            if(!e||typeof e.affectsSome!=="function"||e.affectsSome(new Set(["antigravityHelper.active"]))){
              if(isHelperActive()){
                scheduleUpdate(20);
              }else{
                hideWidget();
                disarmDropZone();
              }
            }
          }catch(_){}
        });
      }
    }catch(_){}
  }

  function isHelperActive(){
    resolveServices();
    try{
      if(contextKeyService&&typeof contextKeyService.getContextKeyValue==="function"){
        return Boolean(contextKeyService.getContextKeyValue("antigravityHelper.active"));
      }
    }catch(_){}
    return false;
  }

  function executeHelperCommand(commandId,...args){
    resolveServices();
    try{
      if(commandService&&typeof commandService.executeCommand==="function"){
        return commandService.executeCommand(commandId,...args);
      }
    }catch(_){}
    return undefined;
  }

  function clearAllTimers(){
    if(checkTimer){clearTimeout(checkTimer);checkTimer=null;}
    if(extraTimers.length>0){
      for(let i=0;i<extraTimers.length;i++)clearTimeout(extraTimers[i]);
      extraTimers=[];
    }
  }

  function ensureStyle(){
    const existing=document.getElementById("agy-helper-selection-style");
    if(existing){
      if(existing.getAttribute("data-version")==="${PATCH_VERSION}")return;
      existing.remove();
    }
    const head=document.head||document.documentElement;
    if(!head)return;
    const styleEl=document.createElement("style");
    styleEl.id="agy-helper-selection-style";
    styleEl.setAttribute("data-version","${PATCH_VERSION}");
    styleEl.textContent=${JSON.stringify(WORKBENCH_WIDGET_CSS_RULES)};
    head.appendChild(styleEl);
  }

  function isAntigravityWebview(wv){
    if(!wv)return false;
    const vt=typeof wv.providedViewType==="string"?wv.providedViewType:"";
    const extId=wv.extension&&wv.extension.id?String(wv.extension.id.value||wv.extension.id):"";
    const src=wv.element&&typeof wv.element.getAttribute==="function"?String(wv.element.getAttribute("src")||""):"";
    return /antigravity|jetski/i.test(vt)||/antigravity/i.test(extId)||/antigravity|jetski/i.test(src);
  }

  function getVisibleAntigravityRects(){
    const rects=[];
    const seen=new Set();
    const wvs=window.__agyHelperWebviews;
    if(wvs&&wvs.size>0){
      for(const wv of Array.from(wvs)){
        if(!wv||!wv.element)continue;
        if(!wv.element.isConnected){
          wvs.delete(wv);
          continue;
        }
        if(isAntigravityWebview(wv)){
          seen.add(wv.element);
          const r=wv.element.getBoundingClientRect();
          if(r&&r.width>40&&r.height>40)rects.push(r);
        }
      }
    }
    const iframes=document.querySelectorAll('iframe.webview[src*="antigravity"],iframe.webview[src*="jetski"]');
    for(let i=0;i<iframes.length;i++){
      const el=iframes[i];
      if(!seen.has(el)){
        seen.add(el);
        const r=el.getBoundingClientRect();
        if(r&&r.width>40&&r.height>40)rects.push(r);
      }
    }
    return rects;
  }

  function pickTargetRect(x,y){
    const rects=getVisibleAntigravityRects();
    if(rects.length===0)return null;
    if(typeof x==="number"&&typeof y==="number"&&(x>0||y>0)){
      for(let i=0;i<rects.length;i++){
        const r=rects[i];
        if(x>=r.left&&x<=r.right&&y>=r.top&&y<=r.bottom)return r;
      }
    }
    return rects[0];
  }

  function pathToFileUri(fsPath){
    let normalized=fsPath.replace(/\\\\/g,"/");
    if(!normalized.startsWith("/"))normalized="/"+normalized;
    return "file://"+encodeURI(normalized).replace(/#/g,"%23").replace(/\\?/g,"%3F");
  }

  function parseUriWithOptionalRange(rawUri,addFileItem){
    if(!rawUri||typeof rawUri!=="string")return;
    const trimmed=rawUri.trim();
    if(!trimmed)return;
    const hashIdx=trimmed.indexOf("#");
    if(hashIdx!==-1){
      const baseUri=trimmed.slice(0,hashIdx);
      const fragment=trimmed.slice(hashIdx+1);
      const m=/^L?(\\d+)(?:,\\d+)?(?:-L?(\\d+)(?:,\\d+)?)?$/i.exec(fragment);
      if(m){
        const startLineNumber=parseInt(m[1],10);
        const endLineNumber=m[2]?parseInt(m[2],10):startLineNumber;
        if(startLineNumber>0&&endLineNumber>=startLineNumber){
          addFileItem(baseUri,{startLineNumber,endLineNumber});
          return;
        }
      }
      addFileItem(baseUri,undefined);
      return;
    }
    addFileItem(trimmed,undefined);
  }

  function extractDropItems(dt){
    const items=[];
    const seen=new Set();

    function addFileItem(uri,range){
      if(!uri||typeof uri!=="string")return;
      const cleanUri=uri.trim();
      if(!cleanUri||!/^[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\//.test(cleanUri))return;
      const key=range?cleanUri+"#"+range.startLineNumber+"-"+range.endLineNumber:cleanUri;
      if(seen.has(key))return;
      seen.add(key);
      if(range){
        items.push({type:"file",uri:cleanUri,range});
      }else{
        items.push({type:"file",uri:cleanUri});
      }
    }

    try{
      const rawEditors=dt.getData("CodeEditors")||dt.getData("codeeditors");
      if(rawEditors){
        const editors=JSON.parse(rawEditors);
        if(Array.isArray(editors)){
          for(const ed of editors){
            const res=ed&&(ed.resource||(ed.uri&&ed.uri.toString()));
            if(typeof res==="string"&&res.trim()){
              const sel=ed.options&&ed.options.selection;
              let range;
              if(sel&&typeof sel.startLineNumber==="number"&&typeof sel.endLineNumber==="number"&&(sel.startLineNumber!==sel.endLineNumber||sel.startColumn!==sel.endColumn)){
                range={startLineNumber:sel.startLineNumber,endLineNumber:sel.endLineNumber};
              }
              parseUriWithOptionalRange(res,(u,r)=>addFileItem(u,range||r));
            }
          }
        }
      }
    }catch(_){}

    try{
      const internalUriList=dt.getData("application/vnd.code.uri-list");
      if(internalUriList){
        for(const line of internalUriList.split(/\\r?\\n/)){
          const trimmed=line.trim();
          if(trimmed&&!trimmed.startsWith("#"))parseUriWithOptionalRange(trimmed,addFileItem);
        }
      }
    }catch(_){}

    if(items.length===0){
      try{
        const rawResources=dt.getData("ResourceURLs")||dt.getData("resourceurls");
        if(rawResources){
          const resources=JSON.parse(rawResources);
          if(Array.isArray(resources)){
            for(const r of resources){
              if(typeof r==="string")parseUriWithOptionalRange(r,addFileItem);
            }
          }
        }
      }catch(_){}
    }

    if(items.length===0){
      try{
        const uriList=dt.getData("text/uri-list");
        if(uriList){
          for(const line of uriList.split(/\\r?\\n/)){
            const trimmed=line.trim();
            if(trimmed&&!trimmed.startsWith("#"))parseUriWithOptionalRange(trimmed,addFileItem);
          }
        }
      }catch(_){}
    }

    if(items.length===0){
      try{
        const rawFiles=dt.getData("CodeFiles")||dt.getData("codefiles");
        if(rawFiles){
          const files=JSON.parse(rawFiles);
          if(Array.isArray(files)){
            for(const f of files){
              if(typeof f==="string"&&f.trim())addFileItem(pathToFileUri(f.trim()),undefined);
            }
          }
        }
      }catch(_){}
    }

    if(items.length===0&&dt.files&&dt.files.length>0){
      for(let i=0;i<dt.files.length;i++){
        const file=dt.files[i];
        if(!file)continue;
        let filePath="";
        try{
          if(typeof globalThis.vscode?.webUtils?.getPathForFile==="function"){
            filePath=globalThis.vscode.webUtils.getPathForFile(file)||"";
          }
        }catch(_){}
        if(!filePath&&typeof file.path==="string")filePath=file.path;
        if(filePath&&filePath.trim()){
          addFileItem(pathToFileUri(filePath.trim()),undefined);
        }
      }
    }

    let text="";
    if(items.length===0){
      try{text=dt.getData("text/plain")||"";}catch(_){}
    }

    return {items,text};
  }

  function setCompatibleDropEffect(dt){
    try{
      const allowed=dt.effectAllowed;
      if(!allowed||allowed==="all"||allowed==="uninitialized"||allowed.toLowerCase().includes("copy")){
        dt.dropEffect="copy";
      }else if(allowed.toLowerCase().includes("move")){
        dt.dropEffect="move";
      }else if(allowed.toLowerCase().includes("link")){
        dt.dropEffect="link";
      }else{
        dt.dropEffect="copy";
      }
    }catch(_){}
  }

  function disarmDropZone(){
    if(dragLeaveTimer){
      clearTimeout(dragLeaveTimer);
      dragLeaveTimer=null;
    }
    if(dropZone){
      dropZone.classList.remove("agy-dragging");
      dropZone.classList.remove("agy-armed");
    }
  }

  function ensureDropZone(){
    if(dropZone&&dropZone.isConnected)return dropZone;
    const host=document.querySelector(".monaco-workbench")||document.body;
    if(!host)return null;
    ensureStyle();
    const old=document.getElementById("agy-helper-drop-zone");
    if(old)old.remove();

    dropZone=document.createElement("div");
    dropZone.id="agy-helper-drop-zone";

    const box=document.createElement("div");
    box.className="agy-helper-drop-box";
    const plus=document.createElement("span");
    plus.textContent="+";
    const label=document.createElement("span");
    label.textContent="Drop to add to Antigravity Chat";
    box.appendChild(plus);
    box.appendChild(label);
    dropZone.appendChild(box);
    host.appendChild(dropZone);

    function onZoneDragEnterOrOver(e){
      if(!isHelperActive()){
        disarmDropZone();
        return;
      }
      if(!e.dataTransfer)return;
      const types=Array.from(e.dataTransfer.types||[]);
      if(types.includes("application/context-scope-item")){
        disarmDropZone();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation==="function")e.stopImmediatePropagation();
      setCompatibleDropEffect(e.dataTransfer);

      if(dragLeaveTimer){
        clearTimeout(dragLeaveTimer);
        dragLeaveTimer=null;
      }
      const rect=pickTargetRect(e.clientX,e.clientY);
      if(rect){
        dropZone.style.left=Math.round(rect.left)+"px";
        dropZone.style.top=Math.round(rect.top)+"px";
        dropZone.style.width=Math.round(rect.width)+"px";
        dropZone.style.height=Math.round(rect.height)+"px";
      }
      dropZone.classList.add("agy-armed");
      dropZone.classList.add("agy-dragging");
    }

    function onZoneDragLeave(e){
      e.preventDefault();
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation==="function")e.stopImmediatePropagation();
      if(dragLeaveTimer)clearTimeout(dragLeaveTimer);
      dragLeaveTimer=setTimeout(()=>{
        dragLeaveTimer=null;
        if(dropZone)dropZone.classList.remove("agy-dragging");
      },80);
    }

    function onZoneDrop(e){
      e.preventDefault();
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation==="function")e.stopImmediatePropagation();
      const active=isHelperActive();
      disarmDropZone();
      if(!active||!e.dataTransfer)return;
      const payload=extractDropItems(e.dataTransfer);
      if((payload.items&&payload.items.length>0)||(payload.text&&payload.text.trim())){
        executeHelperCommand("antigravity-helper.handleWebviewDrop",{
          type:"agyHelper.addContext",
          dropId:Date.now()+"-"+Math.random().toString(36).slice(2),
          items:payload.items,
          text:payload.text
        });
      }
    }

    dropZone.addEventListener("dragenter",onZoneDragEnterOrOver,true);
    dropZone.addEventListener("dragover",onZoneDragEnterOrOver,true);
    dropZone.addEventListener("dragleave",onZoneDragLeave,true);
    dropZone.addEventListener("drop",onZoneDrop,true);
    for(const evt of ["pointermove","mousemove","mousedown","wheel","touchstart"]){
      dropZone.addEventListener(evt,()=>disarmDropZone(),{passive:true});
    }
    return dropZone;
  }

  function armDropZone(x,y){
    if(!isHelperActive()){
      disarmDropZone();
      return;
    }
    const rect=pickTargetRect(x,y);
    if(!rect){
      disarmDropZone();
      return;
    }
    const dz=ensureDropZone();
    if(!dz)return;
    dz.style.left=Math.round(rect.left)+"px";
    dz.style.top=Math.round(rect.top)+"px";
    dz.style.width=Math.round(rect.width)+"px";
    dz.style.height=Math.round(rect.height)+"px";
    dz.classList.add("agy-armed");
  }

  window.__agyHelperOnStartBlockDrag=function(wv){
    registerWebviewInstance(wv);
    if(isHelperActive())armDropZone();
  };
  window.__agyHelperOnStopBlockDrag=function(wv){
    registerWebviewInstance(wv);
  };

  function triggerAddSelectionAction(){
    if(!isHelperActive())return;
    const dropId="sel-"+Date.now()+"-"+Math.random().toString(36).slice(2);
    executeHelperCommand("antigravity-helper.handleWebviewDrop",{
      type:"agyHelper.addSelection",
      dropId
    });
    try{
      const sel=window.getSelection();
      if(sel&&typeof sel.removeAllRanges==="function")sel.removeAllRanges();
    }catch(_){}
  }

  function ensureWidget(){
    if(widget&&widget.isConnected)return widget;
    const host=document.querySelector(".monaco-workbench")||document.body;
    if(!host)return null;
    ensureStyle();
    const old=document.getElementById("agy-helper-selection-widget");
    if(old)old.remove();
    widget=document.createElement("div");
    widget.id="agy-helper-selection-widget";

    const btn=document.createElement("button");
    btn.type="button";
    btn.id="agy-helper-selection-btn";
    btn.title="Add Selection to Antigravity Chat";

    const svgNS="http://www.w3.org/2000/svg";
    const svg=document.createElementNS(svgNS,"svg");
    svg.setAttribute("viewBox","0 0 16 16");
    svg.setAttribute("aria-hidden","true");
    const pathEl=document.createElementNS(svgNS,"path");
    pathEl.setAttribute("d","M1.5 2.75C1.5 1.784 2.284 1 3.25 1h9.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 12.75 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H3.25A1.75 1.75 0 0 1 1.5 10.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2v2.19l2.42-2.42a.75.75 0 0 1 .53-.22h3.8a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-9.5Z");
    svg.appendChild(pathEl);

    const span=document.createElement("span");
    span.textContent="Chat";

    btn.appendChild(svg);
    btn.appendChild(span);
    widget.appendChild(btn);
    host.appendChild(widget);

    btn.addEventListener("mousedown",(e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation==="function")e.stopImmediatePropagation();
      suppressUntil=Date.now()+650;
      hideWidget();
      triggerAddSelectionAction();
    },true);
    btn.addEventListener("mouseup",(e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation==="function")e.stopImmediatePropagation();
      suppressUntil=Date.now()+650;
      hideWidget();
    },true);
    btn.addEventListener("click",(e)=>{
      e.preventDefault();
      e.stopPropagation();
      if(typeof e.stopImmediatePropagation==="function")e.stopImmediatePropagation();
      suppressUntil=Date.now()+650;
      hideWidget();
    },true);
    return widget;
  }

  function hideWidget(){
    clearAllTimers();
    if(widget)widget.classList.remove("agy-visible");
  }

  function isEligibleEditor(ed){
    if(!ed||!(ed instanceof Element))return false;
    if(ed.closest(".part.sidebar,.part.auxiliarybar,.part.panel,.find-widget,.quick-input-widget,.suggest-widget,.parameter-hints-widget,.rename-box,.context-view"))return false;
    if(ed.closest(".part.editor,.editor-container,.editor-instance"))return true;
    return false;
  }

  function getEditorFromEvent(e){
    try{
      const path=typeof e.composedPath==="function"?e.composedPath():[];
      for(let i=0;i<path.length;i++){
        const n=path[i];
        if(n&&n.classList&&n.classList.contains("monaco-editor")&&isEligibleEditor(n)){
          return n;
        }
      }
      if(e.target&&typeof e.target.closest==="function"){
        const ed=e.target.closest(".monaco-editor");
        if(ed&&isEligibleEditor(ed))return ed;
      }
    }catch(_){}
    return null;
  }

  function findActiveEditor(){
    const active=document.activeElement;
    if(active&&typeof active.closest==="function"){
      const ed=active.closest(".monaco-editor");
      if(ed&&isEligibleEditor(ed))return ed;
    }
    if(lastEditor&&lastEditor.isConnected&&isEligibleEditor(lastEditor)){
      return lastEditor;
    }
    const focused=document.querySelector(".part.editor .monaco-editor.focused")||
      (document.querySelector(".part.editor .monaco-editor .focused")&&document.querySelector(".part.editor .monaco-editor .focused").closest(".monaco-editor"));
    if(focused&&isEligibleEditor(focused))return focused;
    const allEditors=document.querySelectorAll(".part.editor .monaco-editor");
    for(let i=0;i<allEditors.length;i++){
      const ed=allEditors[i];
      if(isEligibleEditor(ed)&&ed.querySelector(".selected-text"))return ed;
    }
    return null;
  }

  function collectSelectionRects(ed,editorRect){
    const rects=[];
    const nodes=ed.querySelectorAll(".selected-text");
    for(let i=0;i<nodes.length;i++){
      const r=nodes[i].getBoundingClientRect();
      if(r.width>1&&r.height>2&&r.bottom>editorRect.top&&r.top<editorRect.bottom&&r.right>editorRect.left&&r.left<editorRect.right){
        rects.push(r);
      }
    }
    if(rects.length===0){
      try{
        const sel=window.getSelection();
        if(sel&&!sel.isCollapsed&&sel.rangeCount>0){
          const clientRects=sel.getRangeAt(0).getClientRects();
          for(let i=0;i<clientRects.length;i++){
            const r=clientRects[i];
            if(r.width>1&&r.height>2&&r.bottom>editorRect.top&&r.top<editorRect.bottom&&r.right>editorRect.left&&r.left<editorRect.right){
              rects.push(r);
            }
          }
        }
      }catch(_){}
    }
    return rects;
  }

  function updateWidget(){
    try{
      if(!isHelperActive()||isMouseDown||Date.now()<suppressUntil){
        if(!isHelperActive())hideWidget();
        return;
      }
      const ed=findActiveEditor();
      if(!ed){hideWidget();return;}
      const editorRect=ed.getBoundingClientRect();
      if(editorRect.width<10||editorRect.height<10){hideWidget();return;}
      const rects=collectSelectionRects(ed,editorRect);
      if(rects.length===0){hideWidget();return;}
      rects.sort((a,b)=>(Math.abs(a.top-b.top)>2?a.top-b.top:a.left-b.left));
      const firstRect=rects[0];
      const lastRect=rects[rects.length-1];
      let minLeft=firstRect.left,maxRight=firstRect.right;
      for(let i=0;i<rects.length;i++){
        if(rects[i].left<minLeft)minLeft=rects[i].left;
        if(rects[i].right>maxRight)maxRight=rects[i].right;
      }
      const wEl=ensureWidget();
      if(!wEl)return;
      const wWidth=wEl.offsetWidth||64;
      const wHeight=wEl.offsetHeight||26;
      const recentMouse=(Date.now()-lastMouseUpTs)<600;
      const draggedDown=recentMouse&&rects.length>1&&lastMouseUpY>=((firstRect.top+lastRect.bottom)/2);
      let top;
      if(draggedDown){
        top=lastRect.bottom+6;
        if(top+wHeight>editorRect.bottom-6){
          top=firstRect.top-wHeight-6;
        }
      }else{
        top=firstRect.top-wHeight-6;
        if(top<editorRect.top+6){
          top=lastRect.bottom+6;
        }
      }
      let left;
      if(recentMouse){
        const minX=Math.max(editorRect.left+8,minLeft-10);
        const maxX=Math.min(editorRect.right-wWidth-8,Math.max(minX,maxRight-wWidth/2+10));
        left=Math.min(Math.max(lastMouseUpX-wWidth/2,minX),maxX);
      }else{
        left=Math.min(Math.max(editorRect.left+8,firstRect.left),editorRect.right-wWidth-8);
      }
      wEl.style.left=Math.round(left)+"px";
      wEl.style.top=Math.round(top)+"px";
      wEl.classList.add("agy-visible");
    }catch(_){}
  }

  function scheduleUpdate(delay){
    if(Date.now()<suppressUntil)return;
    if(checkTimer)clearTimeout(checkTimer);
    checkTimer=setTimeout(()=>{checkTimer=null;updateWidget();},delay);
  }

  window.addEventListener("dragstart",(e)=>{
    if(isHelperActive())armDropZone(e.clientX,e.clientY);
  },true);

  window.addEventListener("dragenter",(e)=>{
    if(isHelperActive())armDropZone(e.clientX,e.clientY);
  },true);

  window.addEventListener("dragover",(e)=>{
    if(isHelperActive())armDropZone(e.clientX,e.clientY);
  },true);

  window.addEventListener("dragend",()=>{
    disarmDropZone();
  },true);

  window.addEventListener("drop",(e)=>{
    if(!dropZone||!(e.target instanceof Node)||!dropZone.contains(e.target)){
      disarmDropZone();
    }
  },true);

  window.addEventListener("mousemove",(e)=>{
    if(e.buttons===0&&dropZone&&dropZone.classList.contains("agy-armed")){
      disarmDropZone();
    }
  },true);

  window.addEventListener("mousedown",(e)=>{
    if(dropZone&&dropZone.classList.contains("agy-armed"))disarmDropZone();
    if(widget&&e.target instanceof Node&&widget.contains(e.target))return;
    const ed=getEditorFromEvent(e);
    if(ed)lastEditor=ed;
    isMouseDown=true;
    hideWidget();
  },true);

  window.addEventListener("mouseup",(e)=>{
    isMouseDown=false;
    if(Date.now()<suppressUntil)return;
    if(widget&&e.target instanceof Node&&widget.contains(e.target))return;
    const ed=getEditorFromEvent(e);
    if(ed)lastEditor=ed;
    lastMouseUpX=e.clientX;
    lastMouseUpY=e.clientY;
    lastMouseUpTs=Date.now();
    scheduleUpdate(20);
    extraTimers.push(setTimeout(updateWidget,75));
    extraTimers.push(setTimeout(updateWidget,160));
  },true);

  window.addEventListener("dblclick",(e)=>{
    if(Date.now()<suppressUntil)return;
    const ed=getEditorFromEvent(e);
    if(ed)lastEditor=ed;
    lastMouseUpX=e.clientX;
    lastMouseUpY=e.clientY;
    lastMouseUpTs=Date.now();
    scheduleUpdate(20);
    extraTimers.push(setTimeout(updateWidget,80));
  },true);

  document.addEventListener("selectionchange",()=>{
    if(!isMouseDown&&Date.now()>=suppressUntil)scheduleUpdate(35);
  },true);

  window.addEventListener("keyup",(e)=>{
    if(e.key==="Escape"){hideWidget();disarmDropZone();return;}
    if(e.shiftKey||((e.metaKey||e.ctrlKey)&&(e.key==="a"||e.key==="A"))){
      scheduleUpdate(30);
    }else if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown","Backspace","Delete","Enter"].includes(e.key)){
      scheduleUpdate(20);
    }
  },true);

  window.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){hideWidget();disarmDropZone();return;}
    if(!e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.length===1){
      hideWidget();
    }
  },true);

  window.addEventListener("scroll",()=>{
    if(widget&&widget.classList.contains("agy-visible")){
      scheduleUpdate(16);
    }
  },true);

  window.addEventListener("blur",()=>{
    hideWidget();
    disarmDropZone();
  },true);
})(this);`;

const WORKBENCH_JS_MARKER = `/* AGY_HELPER_WB_JS:${PATCH_VERSION} */`;
const WORKBENCH_JS_ORIG =
  '_startBlockingIframeDragEvents(){this.element&&(this.element.style.pointerEvents="none")}_stopBlockingIframeDragEvents(){this.element&&(this.element.style.pointerEvents="auto")}';
const WORKBENCH_JS_PATCHED = `_startBlockingIframeDragEvents(){${WORKBENCH_JS_MARKER}this.element&&(this.element.style.pointerEvents="none");try{window.__agyHelperOnStartBlockDrag&&window.__agyHelperOnStartBlockDrag(this)}catch(_){}}_stopBlockingIframeDragEvents(){this.element&&(this.element.style.pointerEvents="auto");try{window.__agyHelperOnStopBlockDrag&&window.__agyHelperOnStopBlockDrag(this)}catch(_){}}static{${WORKBENCH_HELPER_SCRIPT}}`;
const WORKBENCH_JS_LEGACY_REGEX =
  /_startBlockingIframeDragEvents\(\)\{\/\* AGY_HELPER_WB_JS:[^\s*]+ \*\/[\s\S]*?(?=webviewContentEndpoint\()/g;

/**
 * Lazily require `vscode` so this module can also be imported by standalone Node scripts
 * such as `src/uninstall.js` (`vscode:uninstall`).
 * @returns {typeof import('vscode') | null}
 */
function getVscode() {
  try {
    return require('vscode');
  } catch (_) {
    return null;
  }
}

/**
 * Compute VS Code's product.json SHA-256 checksum format (base64 without trailing '=').
 * @param {Buffer | string} content
 * @returns {string}
 */
function computeVscodeChecksum(content) {
  return crypto
    .createHash('sha256')
    .update(content)
    .digest('base64')
    .replace(/=+$/, '');
}

/**
 * Save the patched `appRoot` path to `.agy-helper-state.json` so `src/uninstall.js`
 * can locate and restore the exact VS Code workbench installation upon uninstall.
 * @param {string} appRoot
 */
function saveStateAppRoot(appRoot) {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify({ appRoot, updatedAt: Date.now() }, null, 2), 'utf8');
  } catch (_) {}
}

/**
 * Remove `.agy-helper-state.json`.
 */
function clearStateFile() {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      fs.unlinkSync(STATE_FILE_PATH);
    }
  } catch (_) {}
}

/**
 * Discover candidate VS Code `appRoot` directories across saved state, `vscode.env.appRoot`,
 * `process.execPath`, and standard macOS / Windows / Linux installation locations.
 * @param {string} [explicitAppRoot]
 * @returns {string[]}
 */
function findCandidateAppRoots(explicitAppRoot) {
  /** @type {Set<string>} */
  const roots = new Set();

  if (explicitAppRoot && fs.existsSync(explicitAppRoot)) {
    roots.add(explicitAppRoot);
  }

  const vscode = getVscode();
  if (vscode && vscode.env && vscode.env.appRoot && fs.existsSync(vscode.env.appRoot)) {
    roots.add(vscode.env.appRoot);
  }

  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const state = JSON.parse(fs.readFileSync(STATE_FILE_PATH, 'utf8'));
      if (state && typeof state.appRoot === 'string' && fs.existsSync(state.appRoot)) {
        roots.add(state.appRoot);
      }
    }
  } catch (_) {}

  // Derive from process.execPath (e.g. inside Code Helper.app/Contents/MacOS/...)
  try {
    let dir = path.dirname(process.execPath);
    for (let i = 0; i < 8; i++) {
      const candidate1 = path.join(dir, 'Resources', 'app');
      const candidate2 = path.join(dir, 'resources', 'app');
      if (fs.existsSync(path.join(candidate1, 'out', 'vs', 'workbench'))) {
        roots.add(candidate1);
      }
      if (fs.existsSync(path.join(candidate2, 'out', 'vs', 'workbench'))) {
        roots.add(candidate2);
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (_) {}

  const stdCandidates = [
    '/Applications/Visual Studio Code.app/Contents/Resources/app',
    '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app',
    path.join(os.homedir(), 'Applications', 'Visual Studio Code.app', 'Contents', 'Resources', 'app')
  ];
  for (const c of stdCandidates) {
    if (fs.existsSync(c)) {
      roots.add(c);
    }
  }

  return Array.from(roots);
}

/**
 * Patch VS Code's workbench CSS & JS so:
 * 1. Dragging files/folders/tabs/selections displays a transparent drop zone directly over the Antigravity panel.
 * 2. Selecting text in a code editor displays a floating `Chat` button that adds the selection to Antigravity Chat.
 * Also updates `product.json` checksums so VS Code does not show a corrupt warning.
 *
 * @param {string} [appRoot]
 * @returns {{ patched: boolean, alreadyPatched: boolean, error?: string }}
 */
function patchVscodeWorkbench(appRoot) {
  const vscode = getVscode();
  const targetAppRoot = appRoot || (vscode && vscode.env ? vscode.env.appRoot : '');
  if (!targetAppRoot || !fs.existsSync(targetAppRoot)) {
    return { patched: false, alreadyPatched: false };
  }

  const cssPath = path.join(targetAppRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
  const jsPath = path.join(targetAppRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  const productJsonPath = path.join(targetAppRoot, 'product.json');

  if (!fs.existsSync(cssPath) || !fs.existsSync(jsPath)) {
    return { patched: false, alreadyPatched: false };
  }

  try {
    let css = fs.readFileSync(cssPath, 'utf8');
    let js = fs.readFileSync(jsPath, 'utf8');

    const cssHasCurrent = css.includes(WORKBENCH_CSS_START);
    const jsHasCurrent = js.includes(WORKBENCH_JS_MARKER);

    saveStateAppRoot(targetAppRoot);

    if (cssHasCurrent && jsHasCurrent) {
      return { patched: false, alreadyPatched: true };
    }

    // Create backups of original unpatched workbench files
    const cssBakPath = cssPath + '.agy-helper.bak';
    const jsBakPath = jsPath + '.agy-helper.bak';
    const productBakPath = productJsonPath + '.agy-helper.bak';

    if (!fs.existsSync(cssBakPath) && !WORKBENCH_CSS_LEGACY_REGEX.test(css)) {
      fs.writeFileSync(cssBakPath, css, 'utf8');
    }
    WORKBENCH_CSS_LEGACY_REGEX.lastIndex = 0;

    if (!fs.existsSync(jsBakPath) && !js.includes('AGY_HELPER_WB_JS')) {
      fs.writeFileSync(jsBakPath, js, 'utf8');
    }

    if (fs.existsSync(productJsonPath) && !fs.existsSync(productBakPath)) {
      fs.copyFileSync(productJsonPath, productBakPath);
    }

    // Restore clean base before applying current patch
    if (fs.existsSync(cssBakPath)) {
      css = fs.readFileSync(cssBakPath, 'utf8');
    } else {
      css = css.replace(WORKBENCH_CSS_LEGACY_REGEX, '');
    }

    if (fs.existsSync(jsBakPath)) {
      js = fs.readFileSync(jsBakPath, 'utf8');
    } else {
      js = js.replace(WORKBENCH_JS_LEGACY_REGEX, WORKBENCH_JS_ORIG);
    }

    css = css + WORKBENCH_CSS_SNIPPET;

    if (js.includes(WORKBENCH_JS_ORIG)) {
      js = js.replace(WORKBENCH_JS_ORIG, WORKBENCH_JS_PATCHED);
    }

    fs.writeFileSync(cssPath, css, 'utf8');
    fs.writeFileSync(jsPath, js, 'utf8');

    // Update SHA-256 checksums in product.json
    if (fs.existsSync(productJsonPath)) {
      try {
        const productRaw = fs.readFileSync(productJsonPath, 'utf8');
        const product = JSON.parse(productRaw);
        if (product && product.checksums && typeof product.checksums === 'object') {
          product.checksums['vs/workbench/workbench.desktop.main.css'] = computeVscodeChecksum(
            fs.readFileSync(cssPath)
          );
          product.checksums['vs/workbench/workbench.desktop.main.js'] = computeVscodeChecksum(
            fs.readFileSync(jsPath)
          );
          fs.writeFileSync(productJsonPath, JSON.stringify(product, null, '\t') + '\n', 'utf8');
        }
      } catch (_) {}
    }

    return { patched: true, alreadyPatched: false };
  } catch (err) {
    return {
      patched: false,
      alreadyPatched: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Restore VS Code's original workbench CSS, JS, and product.json files.
 * @param {string} [appRoot]
 * @returns {{ restored: boolean, error?: string }}
 */
function unpatchVscodeWorkbench(appRoot) {
  const candidateRoots = findCandidateAppRoots(appRoot);
  if (candidateRoots.length === 0) {
    return { restored: false };
  }

  let anyChanged = false;
  /** @type {string[]} */
  const errors = [];

  for (const root of candidateRoots) {
    const cssPath = path.join(root, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
    const jsPath = path.join(root, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
    const productJsonPath = path.join(root, 'product.json');

    try {
      for (const filePath of [cssPath, jsPath, productJsonPath]) {
        if (!fs.existsSync(filePath)) continue;
        const bakPath = filePath + '.agy-helper.bak';
        if (fs.existsSync(bakPath)) {
          fs.copyFileSync(bakPath, filePath);
          fs.unlinkSync(bakPath);
          anyChanged = true;
        } else if (filePath === cssPath) {
          const content = fs.readFileSync(cssPath, 'utf8');
          const cleaned = content.replace(WORKBENCH_CSS_LEGACY_REGEX, '');
          if (cleaned !== content) {
            fs.writeFileSync(cssPath, cleaned, 'utf8');
            anyChanged = true;
          }
        } else if (filePath === jsPath) {
          const content = fs.readFileSync(jsPath, 'utf8');
          const cleaned = content.replace(WORKBENCH_JS_LEGACY_REGEX, WORKBENCH_JS_ORIG);
          if (cleaned !== content) {
            fs.writeFileSync(jsPath, cleaned, 'utf8');
            anyChanged = true;
          }
        }
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  clearStateFile();

  return {
    restored: anyChanged,
    error: errors.length > 0 ? errors.join('; ') : undefined
  };
}

/**
 * Find all installed `google.google-antigravity` extension directories on disk.
 * @returns {string[]}
 */
function findAntigravityExtensionDirs() {
  /** @type {Set<string>} */
  const dirs = new Set();

  const vscode = getVscode();
  if (vscode && vscode.extensions) {
    const ext = vscode.extensions.getExtension('google.google-antigravity');
    if (ext && ext.extensionPath && fs.existsSync(ext.extensionPath)) {
      dirs.add(ext.extensionPath);
    }
  }

  const home = os.homedir();
  const candidateRoots = [
    path.join(home, '.vscode', 'extensions'),
    path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.vscode-oss', 'extensions')
  ];

  for (const root of candidateRoots) {
    try {
      if (!fs.existsSync(root)) continue;
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('google.google-antigravity-')) {
          dirs.add(path.join(root, entry.name));
        }
      }
    } catch (_) {}
  }

  return Array.from(dirs);
}

/**
 * Remove any legacy patch from a `google.google-antigravity` directory and restore its original files.
 * @param {string} extDir
 * @returns {{ restored: boolean, error?: string }}
 */
function unpatchAntigravityDir(extDir) {
  const extJsPath = path.join(extDir, 'extension.js');
  const bridgeJsPath = path.join(extDir, 'bridge.js');

  try {
    let changed = false;
    for (const filePath of [extJsPath, bridgeJsPath]) {
      if (!fs.existsSync(filePath)) continue;
      const bakPath = filePath + '.agy-helper.bak';
      if (fs.existsSync(bakPath)) {
        fs.copyFileSync(bakPath, filePath);
        fs.unlinkSync(bakPath);
        changed = true;
      } else {
        const content = fs.readFileSync(filePath, 'utf8');
        const cleaned = content
          .replace(LEGACY_BLOCK_REGEX, '')
          .replace(
            'var a=(window.__agyHelperVsCodeApi||(window.__agyHelperVsCodeApi=acquireVsCodeApi()));',
            'var a=acquireVsCodeApi();'
          );
        if (cleaned !== content) {
          fs.writeFileSync(filePath, cleaned, 'utf8');
          changed = true;
        }
      }
    }
    return { restored: changed };
  } catch (err) {
    return {
      restored: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Clean up any legacy disk patches in `google.google-antigravity` extension directories.
 * @returns {boolean}
 */
function cleanupLegacyAntigravityPatches() {
  let anyRestored = false;
  for (const dir of findAntigravityExtensionDirs()) {
    const res = unpatchAntigravityDir(dir);
    if (res.restored) anyRestored = true;
  }
  return anyRestored;
}

/**
 * Synchronous helper to restore all Workbench and legacy Antigravity patches.
 * Safe to call from both the Extension Host and standalone Node scripts (`src/uninstall.js`).
 * @param {string} [appRoot]
 * @returns {{ restored: boolean }}
 */
function restoreAllPatchesSync(appRoot) {
  const legacyRestored = cleanupLegacyAntigravityPatches();
  const wbRes = unpatchVscodeWorkbench(appRoot);
  return { restored: Boolean(legacyRestored || wbRes.restored) };
}

/**
 * Ensure the VS Code workbench has the transparent drag-and-drop overlay and selection `Chat` button enabled,
 * while cleaning up any legacy patches on `google.google-antigravity`.
 * @param {{ silent?: boolean }} [options]
 */
async function ensureDragAndDropEnabled(options = {}) {
  const vscode = getVscode();
  if (!vscode) return;

  await vscode.commands.executeCommand('setContext', 'antigravityHelper.active', true);

  // Clean up any legacy patches that modified google.google-antigravity on disk in older versions
  const legacyCleaned = cleanupLegacyAntigravityPatches();
  const wbRes = patchVscodeWorkbench(vscode.env.appRoot);

  if (wbRes.error && !wbRes.patched && !wbRes.alreadyPatched) {
    vscode.window.showErrorMessage(`Antigravity Helper: Failed to enable workbench bridge: ${wbRes.error}`);
    return;
  }

  if (wbRes.patched || legacyCleaned) {
    const action = await vscode.window.showInformationMessage(
      'Antigravity Helper: Direct drag-and-drop and selection Chat button have been enabled! Reload the window to apply.',
      'Reload Window'
    );
    if (action === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } else if (!options.silent && wbRes.alreadyPatched) {
    vscode.window.showInformationMessage(
      'Antigravity Helper: Direct drag-and-drop and selection Chat button are already enabled.'
    );
  }
}

/**
 * Disable the drag-and-drop overlay and selection `Chat` button and restore original files.
 */
async function disableDragAndDrop() {
  const vscode = getVscode();
  if (vscode) {
    await vscode.commands.executeCommand('setContext', 'antigravityHelper.active', false);
  }

  const { restored } = restoreAllPatchesSync(vscode && vscode.env ? vscode.env.appRoot : undefined);

  if (!vscode) return;

  if (restored) {
    const action = await vscode.window.showInformationMessage(
      'Antigravity Helper: Original files restored and helper effects disabled. Reload the window to finalize.',
      'Reload Window'
    );
    if (action === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } else {
    vscode.window.showInformationMessage(
      'Antigravity Helper: Drag-and-drop and selection Chat button have been disabled.'
    );
  }
}

module.exports = {
  STATE_FILE_PATH,
  ensureDragAndDropEnabled,
  disableDragAndDrop,
  patchVscodeWorkbench,
  unpatchVscodeWorkbench,
  unpatchAntigravityDir,
  cleanupLegacyAntigravityPatches,
  restoreAllPatchesSync,
  findAntigravityExtensionDirs
};

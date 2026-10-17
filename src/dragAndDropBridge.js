// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const Module = require('module');
const vscode = require('vscode');
const { handleWebviewDrop } = require('./contextCommands');

const PATCH_VERSION = 'v7';
const START_MARKER = `/* AGY_HELPER_START:${PATCH_VERSION} */`;
const END_MARKER = `/* AGY_HELPER_END:${PATCH_VERSION} */`;
const TOP_START_MARKER = `/* AGY_HELPER_TOP_START:${PATCH_VERSION} */`;
const TOP_END_MARKER = `/* AGY_HELPER_TOP_END:${PATCH_VERSION} */`;
const LEGACY_BLOCK_REGEX = /\/\* AGY_HELPER_(?:TOP_)?START(?::[^\s*]+)? \*\/[\s\S]*?\/\* AGY_HELPER_(?:TOP_)?END(?::[^\s*]+)? \*\//g;

const WORKBENCH_CSS_START = `/* AGY_HELPER_WORKBENCH_CSS_START:${PATCH_VERSION} */`;
const WORKBENCH_CSS_END = `/* AGY_HELPER_WORKBENCH_CSS_END:${PATCH_VERSION} */`;
const WORKBENCH_CSS_LEGACY_REGEX = /\/\* AGY_HELPER_WORKBENCH_CSS_START(?::[^\s*]+)? \*\/[\s\S]*?\/\* AGY_HELPER_WORKBENCH_CSS_END(?::[^\s*]+)? \*\//g;
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
}`;
const WORKBENCH_CSS_SNIPPET = `\n${WORKBENCH_CSS_START}
iframe.webview{pointer-events:auto!important;}${WORKBENCH_WIDGET_CSS_RULES}
${WORKBENCH_CSS_END}\n`;

/**
 * Self-contained floating selection `Chat` widget script that runs inside the main VS Code
 * workbench window (`workbench.desktop.main.js`).
 * IMPORTANT: Must NOT use `.innerHTML` because VS Code's workbench CSP enforces
 * `require-trusted-types-for 'script'` (`TrustedHTML`).
 */
const WORKBENCH_SELECTION_POPUP_SCRIPT = `(function(WebviewCtor){
  try{
    if(WebviewCtor&&WebviewCtor.prototype&&!WebviewCtor.prototype.__agyHelperMountHooked){
      WebviewCtor.prototype.__agyHelperMountHooked=true;
      for(const m of ["mountTo","on","postMessage","_send","doPostMessage","setHtml","doUpdateContent","style","_startBlockingIframeDragEvents","_stopBlockingIframeDragEvents"]){
        const orig=WebviewCtor.prototype[m];
        if(typeof orig==="function"){
          WebviewCtor.prototype[m]=function(...args){
            try{(window.__agyHelperWebviews=window.__agyHelperWebviews||new Set()).add(this);}catch(_){}
            return orig.apply(this,args);
          };
        }
      }
    }
  }catch(_){}
  if(typeof window==="undefined"||window.__agyHelperSelectionPopupInit==="${PATCH_VERSION}")return;
  window.__agyHelperSelectionPopupInit="${PATCH_VERSION}";
  let widget=null,checkTimer=null,extraTimers=[],suppressUntil=0,lastMouseUpX=0,lastMouseUpY=0,lastMouseUpTs=0,isMouseDown=false,lastEditor=null;

  function clearAllTimers(){
    if(checkTimer){clearTimeout(checkTimer);checkTimer=null;}
    if(extraTimers.length>0){
      for(let i=0;i<extraTimers.length;i++)clearTimeout(extraTimers[i]);
      extraTimers=[];
    }
  }

  function ensureStyle(){
    if(document.getElementById("agy-helper-selection-style"))return;
    const head=document.head||document.documentElement;
    if(!head)return;
    const styleEl=document.createElement("style");
    styleEl.id="agy-helper-selection-style";
    styleEl.textContent=${JSON.stringify(WORKBENCH_WIDGET_CSS_RULES)};
    head.appendChild(styleEl);
  }

  function triggerAddSelectionAction(){
    const dropId="sel-"+Date.now()+"-"+Math.random().toString(36).slice(2);
    const wvs=window.__agyHelperWebviews;
    if(wvs&&wvs.size>0){
      for(const wv of Array.from(wvs)){
        try{
          const handlers=wv&&wv._messageHandlers&&typeof wv._messageHandlers.get==="function"?wv._messageHandlers.get("onmessage"):null;
          if(handlers&&typeof handlers.forEach==="function"){
            handlers.forEach((fn)=>{
              try{fn({message:{type:"agyHelper.addSelection",dropId}},{});}catch(_){}
            });
          }
        }catch(_){}
        try{
          if(wv&&typeof wv.postMessage==="function"){
            wv.postMessage({type:"agyHelper.triggerAddSelection",dropId});
          }
        }catch(_){}
      }
    }
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
      if(isMouseDown||Date.now()<suppressUntil)return;
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

  window.addEventListener("mousedown",(e)=>{
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
    if(e.key==="Escape"){hideWidget();return;}
    if(e.shiftKey||((e.metaKey||e.ctrlKey)&&(e.key==="a"||e.key==="A"))){
      scheduleUpdate(30);
    }else if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","PageUp","PageDown","Backspace","Delete","Enter"].includes(e.key)){
      scheduleUpdate(20);
    }
  },true);

  window.addEventListener("keydown",(e)=>{
    if(e.key==="Escape"){hideWidget();return;}
    if(!e.shiftKey&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&e.key.length===1){
      hideWidget();
    }
  },true);

  window.addEventListener("scroll",()=>{
    if(widget&&widget.classList.contains("agy-visible")){
      scheduleUpdate(16);
    }
  },true);

  window.addEventListener("blur",()=>hideWidget(),true);
})(this);`;

const WORKBENCH_JS_MARKER = `/* AGY_HELPER_WB_JS:${PATCH_VERSION} */`;
const WORKBENCH_JS_ORIG =
  '_startBlockingIframeDragEvents(){this.element&&(this.element.style.pointerEvents="none")}_stopBlockingIframeDragEvents(){this.element&&(this.element.style.pointerEvents="auto")}';
const WORKBENCH_JS_PATCHED = `_startBlockingIframeDragEvents(){${WORKBENCH_JS_MARKER}this.element&&((!this.providedViewType||/antigravity|jetski/i.test(this.providedViewType))?(window.__agyHelperWebviews=window.__agyHelperWebviews||new Set,window.__agyHelperWebviews.add(this),this.element.style.pointerEvents="auto",(!this._agyArmTs||Date.now()-this._agyArmTs>80)&&(this._agyArmTs=Date.now(),this.postMessage({type:"agyHelper.armDropZone"}))):this.element.style.pointerEvents="none")}_stopBlockingIframeDragEvents(){this.element&&(this.element.style.pointerEvents="auto",(!this.providedViewType||/antigravity|jetski/i.test(this.providedViewType))&&(window.__agyHelperWebviews=window.__agyHelperWebviews||new Set,window.__agyHelperWebviews.add(this)))}static{${WORKBENCH_SELECTION_POPUP_SCRIPT}}`;
const WORKBENCH_JS_LEGACY_REGEX =
  /_startBlockingIframeDragEvents\(\)\{\/\* AGY_HELPER_WB_JS:[^\s*]+ \*\/[\s\S]*?(?=webviewContentEndpoint\()/g;

/**
 * Injected at the very top of `bridge.js` so `acquireVsCodeApi()` can be shared
 * between Antigravity's `bridge.js` and our drag-and-drop script without throwing
 * "An instance of the VS Code API has already been acquired".
 */
const BRIDGE_TOP_SCRIPT = `${TOP_START_MARKER}
(function() {
  try {
    if (typeof window !== 'undefined' && typeof window.acquireVsCodeApi === 'function' && !window.acquireVsCodeApi.__agyHelperWrapped) {
      const origAcquire = window.acquireVsCodeApi;
      let cachedApi = null;
      const wrappedAcquire = function() {
        if (!cachedApi) {
          cachedApi = origAcquire.apply(this, arguments);
        }
        window.__agyHelperVsCodeApi = cachedApi;
        return cachedApi;
      };
      wrappedAcquire.__agyHelperWrapped = true;
      try {
        window.acquireVsCodeApi = wrappedAcquire;
      } catch (_) {}
    }
  } catch (_) {}
})();
${TOP_END_MARKER}
`;

/**
 * Self-contained script that runs inside the Antigravity Webview (`bridge.js` / `webview.html`).
 * Handles drag-and-drop of files, folders, editor tabs, symbols, and text selections
 * into the Antigravity chat panel WITHOUT requiring the user to hold Shift, and forwards
 * floating selection `Chat` button clicks to the Extension Host.
 */
const WEBVIEW_DROP_SCRIPT = `
(function() {
  if (window.__agyHelperDropInitialized === '${PATCH_VERSION}') return;
  window.__agyHelperDropInitialized = '${PATCH_VERSION}';

  function getVsCodeApi() {
    if (window.__agyHelperVsCodeApi) {
      return window.__agyHelperVsCodeApi;
    }
    try {
      if (typeof acquireVsCodeApi === 'function') {
        window.__agyHelperVsCodeApi = acquireVsCodeApi();
        return window.__agyHelperVsCodeApi;
      }
    } catch (e) {}
    return null;
  }

  function pathToFileUri(fsPath) {
    let normalized = fsPath.replace(/\\\\/g, '/');
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized;
    }
    return 'file://' + encodeURI(normalized).replace(/#/g, '%23').replace(/\\?/g, '%3F');
  }

  function parseUriWithOptionalRange(rawUri, addFileItem) {
    if (!rawUri || typeof rawUri !== 'string') return;
    const trimmed = rawUri.trim();
    if (!trimmed) return;

    const hashIdx = trimmed.indexOf('#');
    if (hashIdx !== -1) {
      const baseUri = trimmed.slice(0, hashIdx);
      const fragment = trimmed.slice(hashIdx + 1);
      // Match #L10, #L10-L20, #10,1-20,5, #L10,1-L20,5
      const m = /^L?(\\d+)(?:,\\d+)?(?:-L?(\\d+)(?:,\\d+)?)?$/i.exec(fragment);
      if (m) {
        const startLineNumber = parseInt(m[1], 10);
        const endLineNumber = m[2] ? parseInt(m[2], 10) : startLineNumber;
        if (startLineNumber > 0 && endLineNumber >= startLineNumber) {
          addFileItem(baseUri, { startLineNumber, endLineNumber });
          return;
        }
      }
      addFileItem(baseUri, undefined);
      return;
    }

    addFileItem(trimmed, undefined);
  }

  function extractDropItems(dt) {
    const items = [];
    const seen = new Set();

    function addFileItem(uri, range) {
      if (!uri || typeof uri !== 'string') return;
      const cleanUri = uri.trim();
      if (!cleanUri) return;
      // Only accept file:// or vscode-remote:// or workspace schemes
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\\/\\//.test(cleanUri)) return;
      const key = range ? cleanUri + '#' + range.startLineNumber + '-' + range.endLineNumber : cleanUri;
      if (seen.has(key)) return;
      seen.add(key);
      if (range) {
        items.push({ type: 'file', uri: cleanUri, range: range });
      } else {
        items.push({ type: 'file', uri: cleanUri });
      }
    }

    // 1. CodeEditors (Editor tab drag, Outline symbol drag, Search result drag)
    try {
      const rawEditors = dt.getData('CodeEditors') || dt.getData('codeeditors');
      if (rawEditors) {
        const editors = JSON.parse(rawEditors);
        if (Array.isArray(editors)) {
          for (const ed of editors) {
            const res = ed && (ed.resource || (ed.uri && ed.uri.toString()));
            if (typeof res === 'string' && res.trim()) {
              const sel = ed.options && ed.options.selection;
              let range;
              if (
                sel &&
                typeof sel.startLineNumber === 'number' &&
                typeof sel.endLineNumber === 'number' &&
                (sel.startLineNumber !== sel.endLineNumber || sel.startColumn !== sel.endColumn)
              ) {
                range = {
                  startLineNumber: sel.startLineNumber,
                  endLineNumber: sel.endLineNumber
                };
              }
              parseUriWithOptionalRange(res, (u, r) => addFileItem(u, range || r));
            }
          }
        }
      }
    } catch (_) {}

    // 2. application/vnd.code.uri-list (Explorer single & multi-file drag)
    try {
      const internalUriList = dt.getData('application/vnd.code.uri-list');
      if (internalUriList) {
        for (const line of internalUriList.split(/\\r?\\n/)) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            parseUriWithOptionalRange(trimmed, addFileItem);
          }
        }
      }
    } catch (_) {}

    // 3. ResourceURLs
    if (items.length === 0) {
      try {
        const rawResources = dt.getData('ResourceURLs') || dt.getData('resourceurls');
        if (rawResources) {
          const resources = JSON.parse(rawResources);
          if (Array.isArray(resources)) {
            for (const r of resources) {
              if (typeof r === 'string') {
                parseUriWithOptionalRange(r, addFileItem);
              }
            }
          }
        }
      } catch (_) {}
    }

    // 4. text/uri-list
    if (items.length === 0) {
      try {
        const uriList = dt.getData('text/uri-list');
        if (uriList) {
          for (const line of uriList.split(/\\r?\\n/)) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
              parseUriWithOptionalRange(trimmed, addFileItem);
            }
          }
        }
      } catch (_) {}
    }

    // 5. CodeFiles
    if (items.length === 0) {
      try {
        const rawFiles = dt.getData('CodeFiles') || dt.getData('codefiles');
        if (rawFiles) {
          const files = JSON.parse(rawFiles);
          if (Array.isArray(files)) {
            for (const f of files) {
              if (typeof f === 'string' && f.trim()) {
                addFileItem(pathToFileUri(f.trim()), undefined);
              }
            }
          }
        }
      } catch (_) {}
    }

    // 6. OS Finder files (DataTransfer.files)
    if (items.length === 0 && dt.files && dt.files.length > 0) {
      for (let i = 0; i < dt.files.length; i++) {
        const file = dt.files[i];
        if (file && typeof file.path === 'string' && file.path.trim()) {
          addFileItem(pathToFileUri(file.path.trim()), undefined);
        }
      }
    }

    let text = '';
    if (items.length === 0) {
      try {
        text = dt.getData('text/plain') || '';
      } catch (_) {}
    }

    return { items, text };
  }

  let armOverlayFn = null;
  let disarmOverlayFn = null;

  // Intercept control messages from Workbench / Extension Host in capture phase so bridge.js
  // does not log "Unknown message from iframe" for our internal helper messages.
  window.addEventListener('message', (e) => {
    if (e && e.data && typeof e.data === 'object' && typeof e.data.type === 'string' && e.data.type.startsWith('agyHelper.')) {
      e.stopImmediatePropagation();
      if (e.data.type === 'agyHelper.armDropZone' && typeof armOverlayFn === 'function') {
        armOverlayFn();
      } else if (e.data.type === 'agyHelper.disarmDropZone' && typeof disarmOverlayFn === 'function') {
        disarmOverlayFn();
      } else if (e.data.type === 'agyHelper.triggerAddSelection') {
        const api = getVsCodeApi();
        if (api) {
          api.postMessage({
            type: 'agyHelper.addSelection',
            dropId: e.data.dropId || ('sel-' + Date.now() + '-' + Math.random().toString(36).slice(2))
          });
        }
      }
    }
  }, true);

  function setupDropZone() {
    if (!document.body) return;
    const existingZone = document.getElementById('agy-helper-drop-zone');
    if (existingZone) existingZone.remove();
    const existingStyle = document.getElementById('agy-helper-drop-style');
    if (existingStyle) existingStyle.remove();
    for (const oldEdge of Array.from(document.querySelectorAll('.agy-helper-edge-sensor'))) {
      oldEdge.remove();
    }

    const style = document.createElement('style');
    style.id = 'agy-helper-drop-style';
    style.textContent = \`
      #agy-helper-drop-zone {
        position: fixed;
        inset: 0;
        z-index: 99999;
        pointer-events: auto;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.12s ease, opacity 0.12s ease;
      }
      #agy-helper-drop-zone.agy-passthrough {
        pointer-events: none !important;
      }
      #agy-helper-drop-zone .agy-helper-drop-box {
        pointer-events: none !important;
        opacity: 0;
        transform: scale(0.96);
        transition: opacity 0.12s ease, transform 0.12s ease;
        padding: 14px 20px;
        border-radius: 8px;
        background: var(--vscode-editorWidget-background, rgba(30, 30, 30, 0.92));
        color: var(--vscode-foreground, #ffffff);
        border: 1px solid var(--vscode-focusBorder, #007fd4);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        font-family: var(--vscode-font-family, system-ui, sans-serif);
        font-size: 13px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 8px;
        user-select: none;
      }
      #agy-helper-drop-zone.agy-dragging {
        pointer-events: auto !important;
        background-color: rgba(0, 127, 212, 0.14);
        outline: 2px dashed var(--vscode-focusBorder, #007fd4);
        outline-offset: -6px;
      }
      #agy-helper-drop-zone.agy-dragging .agy-helper-drop-box {
        opacity: 1;
        transform: scale(1);
      }
    \`;
    (document.head || document.documentElement).appendChild(style);

    const zone = document.createElement('div');
    zone.id = 'agy-helper-drop-zone';
    zone.innerHTML = '<div class="agy-helper-drop-box"><span>+</span><span>Drop to add to Antigravity Chat</span></div>';
    document.body.appendChild(zone);

    let isDragging = false;
    let dragLeaveTimer = null;

    function armOverlay() {
      if (!isDragging) {
        zone.classList.remove('agy-passthrough');
      }
    }
    armOverlayFn = armOverlay;

    function disarmOverlay() {
      if (dragLeaveTimer) {
        clearTimeout(dragLeaveTimer);
        dragLeaveTimer = null;
      }
      isDragging = false;
      zone.classList.remove('agy-dragging');
      zone.classList.add('agy-passthrough');
    }
    disarmOverlayFn = disarmOverlay;

    // Normal mouse movements never fire during an HTML5 drag operation.
    // As soon as the user moves or clicks the mouse normally, disarm the overlay
    // so the underlying #jetski-frame receives all normal mouse/scroll events.
    const disarmEvents = ['pointermove', 'mousemove', 'mousedown', 'wheel', 'touchstart'];
    for (const evt of disarmEvents) {
      zone.addEventListener(evt, () => {
        disarmOverlay();
      }, { passive: true });
    }

    document.documentElement.addEventListener('mouseleave', () => {
      armOverlay();
    }, { passive: true });
    document.body.addEventListener('mouseleave', () => {
      armOverlay();
    }, { passive: true });
    window.addEventListener('blur', () => {
      armOverlay();
    }, { passive: true });

    let wasFocused = document.hasFocus();
    setInterval(() => {
      try {
        const nowFocused = document.hasFocus();
        if (wasFocused && !nowFocused && !isDragging) {
          armOverlay();
        }
        wasFocused = nowFocused;

        const isHovered =
          (document.documentElement && document.documentElement.matches(':hover')) ||
          (document.body && document.body.matches(':hover'));
        if (!isHovered && !isDragging) {
          armOverlay();
        }
      } catch (_) {}
    }, 40);

    function setCompatibleDropEffect(dt) {
      try {
        const allowed = dt.effectAllowed;
        if (!allowed || allowed === 'all' || allowed === 'uninitialized' || allowed.toLowerCase().includes('copy')) {
          dt.dropEffect = 'copy';
        } else if (allowed.toLowerCase().includes('move')) {
          dt.dropEffect = 'move';
        } else if (allowed.toLowerCase().includes('link')) {
          dt.dropEffect = 'link';
        } else {
          dt.dropEffect = 'copy';
        }
      } catch (_) {}
    }

    function handleDragEnterOrOver(e) {
      if (!e.dataTransfer) return;
      const types = Array.from(e.dataTransfer.types || []);
      if (types.includes('application/context-scope-item')) {
        disarmOverlay();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      setCompatibleDropEffect(e.dataTransfer);

      if (dragLeaveTimer) {
        clearTimeout(dragLeaveTimer);
        dragLeaveTimer = null;
      }
      if (!isDragging) {
        isDragging = true;
        zone.classList.remove('agy-passthrough');
        zone.classList.add('agy-dragging');
      }
    }

    function handleDragLeave(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }

      if (dragLeaveTimer) {
        clearTimeout(dragLeaveTimer);
      }
      dragLeaveTimer = setTimeout(() => {
        dragLeaveTimer = null;
        isDragging = false;
        zone.classList.remove('agy-dragging');
        zone.classList.remove('agy-passthrough');
      }, 160);
    }

    function handleDrop(e) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') {
        e.stopImmediatePropagation();
      }
      disarmOverlay();

      if (!e.dataTransfer) return;
      const payload = extractDropItems(e.dataTransfer);
      if ((payload.items && payload.items.length > 0) || (payload.text && payload.text.trim())) {
        const api = getVsCodeApi();
        if (api) {
          api.postMessage({
            type: 'agyHelper.addContext',
            dropId: Date.now() + '-' + Math.random().toString(36).slice(2),
            items: payload.items,
            text: payload.text
          });
        }
      }
    }

    // Register in capture phase on window so VS Code's pre/index.html bubble listeners
    // (handleInnerDragStartEvent / handleInnerDragEvent) never disable iframe pointerEvents.
    window.addEventListener('dragenter', handleDragEnterOrOver, true);
    window.addEventListener('dragover', handleDragEnterOrOver, true);
    window.addEventListener('dragleave', handleDragLeave, true);
    window.addEventListener('drop', handleDrop, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDropZone);
  } else {
    setupDropZone();
  }
})();
`;

/**
 * Snippet injected into `extension.js` of `google.google-antigravity` right after
 * `Object.assign(exports, r('vscode'));` so it works regardless of extension activation order.
 */
const EXTENSION_HOST_PATCH_SNIPPET = `${START_MARKER}
(function() {
  const origWindow = exports.window;
  if (!origWindow || origWindow.__agyHelperWrapped) return;
  const processedDrops = (globalThis.__agyHelperProcessedDrops = globalThis.__agyHelperProcessedDrops || new Set());
  const activeWebviews = (globalThis.__agyHelperActiveWebviews = globalThis.__agyHelperActiveWebviews || new Set());
  const inlineDropScript = ${JSON.stringify(WEBVIEW_DROP_SCRIPT)};
  let lastSelectionItems = null;

  function captureEditorSelection(editor) {
    try {
      if (!editor || !editor.document || !editor.document.uri) return;
      const scheme = editor.document.uri.scheme;
      if (scheme === 'output' || scheme === 'debug' || scheme === 'vscode-terminal') return;
      const nonEmpty = (editor.selections || [editor.selection]).filter((s) => s && !s.isEmpty);
      if (nonEmpty.length === 0) return;
      const uriStr = editor.document.uri.toString();
      lastSelectionItems = nonEmpty.map((sel) => ({
        type: 'file',
        uri: uriStr,
        range: {
          startLineNumber: sel.start.line + 1,
          endLineNumber: sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1
        }
      }));
    } catch (_) {}
  }

  async function handleHelperMsg(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.dropId) {
      if (processedDrops.has(msg.dropId)) return;
      processedDrops.add(msg.dropId);
    }
    if (msg.type === 'agyHelper.addSelection') {
      try {
        await exports.commands.executeCommand('antigravity-helper.addSelectionToChat');
        return;
      } catch (_) {}
      captureEditorSelection(origWindow.activeTextEditor);
      if (Array.isArray(lastSelectionItems) && lastSelectionItems.length > 0) {
        const items = lastSelectionItems;
        lastSelectionItems = null;
        try {
          const ed = origWindow.activeTextEditor;
          if (ed && ed.selection && !ed.selection.isEmpty) {
            const pos = ed.selection.active;
            ed.selection = new exports.Selection(pos, pos);
          }
        } catch (_) {}
        await exports.commands.executeCommand('antigravity.addContext', items);
        await exports.commands.executeCommand('antigravity.toggleChatFocus', 'focus');
      }
      return;
    }
    if (msg.type !== 'agyHelper.addContext') return;
    try {
      await exports.commands.executeCommand('antigravity-helper.handleWebviewDrop', msg);
      return;
    } catch (_) {}
    if (Array.isArray(msg.items) && msg.items.length > 0) {
      await exports.commands.executeCommand('antigravity.addContext', msg.items);
      await exports.commands.executeCommand('antigravity.toggleChatFocus', 'focus');
    } else if (typeof msg.text === 'string' && msg.text.trim()) {
      await exports.commands.executeCommand('antigravity.addContext', [msg.text]);
      await exports.commands.executeCommand('antigravity.toggleChatFocus', 'focus');
    }
  }

  function armAllWebviews() {
    for (const wv of Array.from(activeWebviews)) {
      try {
        wv.postMessage({ type: 'agyHelper.armDropZone' });
      } catch (_) {
        activeWebviews.delete(wv);
      }
    }
  }

  function transformWebviewHtml(html) {
    if (typeof html !== 'string' || !html.includes('jetski-frame')) {
      return html;
    }
    let updated = html.replace(/bridge\\.js(?:\\?[^"'>\\s]*)?/g, 'bridge.js?v=${PATCH_VERSION}');
    if (!updated.includes('__agyHelperDropInitialized')) {
      updated = updated.replace(/<\\/body>/i, '<script>' + inlineDropScript + '<\\/script></body>');
    }
    return updated;
  }

  function hookWebviewContainer(container) {
    if (!container || !container.webview || container.webview.__agyHelperHooked) return;
    const wv = container.webview;
    wv.__agyHelperHooked = true;
    activeWebviews.add(wv);

    try {
      if (typeof container.onDidDispose === 'function') {
        container.onDidDispose(() => activeWebviews.delete(wv));
      }
    } catch (_) {}

    try {
      let proto = Object.getPrototypeOf(wv);
      let desc =
        Object.getOwnPropertyDescriptor(wv, 'html') ||
        (proto && Object.getOwnPropertyDescriptor(proto, 'html'));
      if (desc && desc.set && desc.get) {
        const origGet = desc.get.bind(wv);
        const origSet = desc.set.bind(wv);
        Object.defineProperty(wv, 'html', {
          configurable: true,
          enumerable: true,
          get() {
            return origGet();
          },
          set(html) {
            origSet(transformWebviewHtml(html));
          }
        });
      }
    } catch (_) {}

    try {
      const origOnDidReceiveMessage = wv.onDidReceiveMessage.bind(wv);
      origOnDidReceiveMessage((msg) => {
        if (msg && (msg.type === 'agyHelper.addContext' || msg.type === 'agyHelper.addSelection')) {
          handleHelperMsg(msg);
        }
      });
      wv.onDidReceiveMessage = function(listener, thisArgs, disposables) {
        return origOnDidReceiveMessage((msg) => {
          if (msg && typeof msg === 'object' && typeof msg.type === 'string' && msg.type.startsWith('agyHelper.')) {
            return;
          }
          return listener.call(thisArgs, msg);
        }, thisArgs, disposables);
      };
    } catch (_) {}
  }

  try {
    if (origWindow.activeTextEditor) {
      captureEditorSelection(origWindow.activeTextEditor);
    }
    if (typeof origWindow.onDidChangeActiveTextEditor === 'function') {
      origWindow.onDidChangeActiveTextEditor((ed) => {
        captureEditorSelection(ed);
        armAllWebviews();
      });
    }
    if (typeof origWindow.onDidChangeTextEditorSelection === 'function') {
      origWindow.onDidChangeTextEditorSelection((e) => {
        if (e && e.textEditor) captureEditorSelection(e.textEditor);
        armAllWebviews();
      });
    }
    if (typeof origWindow.onDidChangeWindowState === 'function') {
      origWindow.onDidChangeWindowState(() => armAllWebviews());
    }
  } catch (_) {}

  const wrappedWindow = new Proxy(origWindow, {
    get(target, prop) {
      if (prop === '__agyHelperWrapped') return true;
      if (prop === 'registerWebviewViewProvider') {
        return function(viewId, provider, options) {
          if (viewId === 'antigravity.panel' && provider && typeof provider.resolveWebviewView === 'function') {
            const origResolve = provider.resolveWebviewView.bind(provider);
            provider.resolveWebviewView = function(webviewView, ctx, token) {
              hookWebviewContainer(webviewView);
              return origResolve(webviewView, ctx, token);
            };
          }
          return target.registerWebviewViewProvider(viewId, provider, options);
        };
      }
      if (prop === 'createWebviewPanel') {
        return function(viewType, title, showOptions, options) {
          const panel = target.createWebviewPanel(viewType, title, showOptions, options);
          if (viewType === 'jetski-web.editor') {
            hookWebviewContainer(panel);
          }
          return panel;
        };
      }
      const val = Reflect.get(target, prop, target);
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
  exports.window = wrappedWindow;
})();
${END_MARKER}`;

const BRIDGE_JS_PATCH_SNIPPET = `\n${START_MARKER}\n${WEBVIEW_DROP_SCRIPT.trim()}\n${END_MARKER}\n`;

/**
 * Wrap a `vscode` module object at runtime in the Extension Host so if `google.google-antigravity`
 * loads after `antigravity-helper`, its `antigravity.panel` webview gets drag-and-drop support
 * even before any disk patch reload.
 */
function installRuntimeVscodeHook() {
  const origLoad = Module._load;
  if (/** @type {any} */ (origLoad).__agyHelperHooked) {
    return;
  }

  /**
   * @param {vscode.Webview} webview
   */
  function instrumentWebview(webview) {
    if (!webview || /** @type {any} */ (webview).__agyHelperInstrumented) {
      return;
    }
    /** @type {any} */ (webview).__agyHelperInstrumented = true;

    const activeWebviews = (globalThis.__agyHelperActiveWebviews =
      globalThis.__agyHelperActiveWebviews || new Set());
    activeWebviews.add(webview);

    try {
      webview.onDidReceiveMessage((msg) => {
        if (msg && (msg.type === 'agyHelper.addContext' || msg.type === 'agyHelper.addSelection')) {
          handleWebviewDrop(msg);
        }
      });
    } catch (_) {}

    try {
      let proto = Object.getPrototypeOf(webview);
      let desc =
        Object.getOwnPropertyDescriptor(webview, 'html') ||
        (proto && Object.getOwnPropertyDescriptor(proto, 'html'));
      if (desc && desc.set && desc.get) {
        const origGet = desc.get.bind(webview);
        const origSet = desc.set.bind(webview);
        Object.defineProperty(webview, 'html', {
          configurable: true,
          enumerable: true,
          get() {
            return origGet();
          },
          set(html) {
            if (typeof html === 'string' && html.includes('jetski-frame')) {
              html = html.replace(/bridge\.js(?:\?[^"'>\s]*)?/g, `bridge.js?v=${PATCH_VERSION}`);
              if (!html.includes('__agyHelperDropInitialized')) {
                const injected = `<script>${BRIDGE_TOP_SCRIPT}\n${WEBVIEW_DROP_SCRIPT}</script></body>`;
                html = html.replace(/<\/body>/i, injected);
              }
            }
            origSet(html);
          }
        });
      }
    } catch (_) {}
  }

  const hookedLoad = function(request, parent, isMain) {
    const loaded = origLoad.apply(this, arguments);
    if (request === 'vscode' && loaded && loaded.window && !loaded.window.__agyHelperRuntimeHooked) {
      try {
        const origReg = loaded.window.registerWebviewViewProvider.bind(loaded.window);
        loaded.window.registerWebviewViewProvider = function(viewId, provider, options) {
          if (viewId === 'antigravity.panel' && provider && typeof provider.resolveWebviewView === 'function') {
            const origResolve = provider.resolveWebviewView.bind(provider);
            provider.resolveWebviewView = function(webviewView, ctx, token) {
              if (webviewView && webviewView.webview) {
                instrumentWebview(webviewView.webview);
              }
              return origResolve(webviewView, ctx, token);
            };
          }
          return origReg(viewId, provider, options);
        };
        loaded.window.__agyHelperRuntimeHooked = true;
      } catch (_) {}
    }
    return loaded;
  };
  hookedLoad.__agyHelperHooked = true;
  Module._load = hookedLoad;
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
 * Patch VS Code's workbench CSS & JS so:
 * 1. Outer `<iframe class="webview">` is never set to `pointer-events: none` during drag operations
 *    without holding Shift, and notifies the Antigravity webview immediately when a drag starts.
 * 2. Selecting text in a code editor displays a floating `Chat` button that adds the selection
 *    to Antigravity Chat on click.
 * Also updates `product.json` checksums so VS Code does not show a corrupt warning.
 *
 * @param {string} [appRoot]
 * @returns {{ patched: boolean, alreadyPatched: boolean, error?: string }}
 */
function patchVscodeWorkbench(appRoot = vscode.env.appRoot) {
  if (!appRoot || !fs.existsSync(appRoot)) {
    return { patched: false, alreadyPatched: false };
  }

  const cssPath = path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
  const jsPath = path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  const productJsonPath = path.join(appRoot, 'product.json');

  if (!fs.existsSync(cssPath) || !fs.existsSync(jsPath)) {
    return { patched: false, alreadyPatched: false };
  }

  try {
    let css = fs.readFileSync(cssPath, 'utf8');
    let js = fs.readFileSync(jsPath, 'utf8');

    const cssHasCurrent = css.includes(WORKBENCH_CSS_START);
    const jsHasCurrent = js.includes(WORKBENCH_JS_MARKER);

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
function unpatchVscodeWorkbench(appRoot = vscode.env.appRoot) {
  if (!appRoot || !fs.existsSync(appRoot)) {
    return { restored: false };
  }

  const cssPath = path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
  const jsPath = path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
  const productJsonPath = path.join(appRoot, 'product.json');

  try {
    let changed = false;
    for (const filePath of [cssPath, jsPath, productJsonPath]) {
      if (!fs.existsSync(filePath)) continue;
      const bakPath = filePath + '.agy-helper.bak';
      if (fs.existsSync(bakPath)) {
        fs.copyFileSync(bakPath, filePath);
        fs.unlinkSync(bakPath);
        changed = true;
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
 * Find all installed `google.google-antigravity` extension directories on disk.
 * @returns {string[]}
 */
function findAntigravityExtensionDirs() {
  /** @type {Set<string>} */
  const dirs = new Set();

  // 1. Check via VS Code API
  const ext = vscode.extensions.getExtension('google.google-antigravity');
  if (ext && ext.extensionPath && fs.existsSync(ext.extensionPath)) {
    dirs.add(ext.extensionPath);
  }

  // 2. Scan standard ~/.vscode/extensions directories
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
 * Patch a single `google.google-antigravity` extension directory with the drag-and-drop bridge.
 * @param {string} extDir
 * @returns {{ patched: boolean, alreadyPatched: boolean, error?: string }}
 */
function patchAntigravityDir(extDir) {
  const extJsPath = path.join(extDir, 'extension.js');
  const bridgeJsPath = path.join(extDir, 'bridge.js');

  if (!fs.existsSync(extJsPath) || !fs.existsSync(bridgeJsPath)) {
    return { patched: false, alreadyPatched: false, error: `Missing extension.js or bridge.js in ${extDir}` };
  }

  try {
    let extJs = fs.readFileSync(extJsPath, 'utf8');
    let bridgeJs = fs.readFileSync(bridgeJsPath, 'utf8');

    const extHasCurrent = extJs.includes(START_MARKER);
    const bridgeHasCurrent =
      bridgeJs.includes(START_MARKER) &&
      bridgeJs.includes(TOP_START_MARKER) &&
      bridgeJs.includes('window.__agyHelperVsCodeApi=acquireVsCodeApi()');

    if (extHasCurrent && bridgeHasCurrent) {
      return { patched: false, alreadyPatched: true };
    }

    // Create backup of original unpatched files if not present
    const extBakPath = extJsPath + '.agy-helper.bak';
    const bridgeBakPath = bridgeJsPath + '.agy-helper.bak';
    if (!fs.existsSync(extBakPath) && !LEGACY_BLOCK_REGEX.test(extJs)) {
      fs.writeFileSync(extBakPath, extJs, 'utf8');
    }
    LEGACY_BLOCK_REGEX.lastIndex = 0;
    if (!fs.existsSync(bridgeBakPath) && !LEGACY_BLOCK_REGEX.test(bridgeJs)) {
      fs.writeFileSync(bridgeBakPath, bridgeJs, 'utf8');
    }

    // Restore from clean backup if available before applying new patch
    if (fs.existsSync(extBakPath)) {
      extJs = fs.readFileSync(extBakPath, 'utf8');
    } else {
      extJs = extJs.replace(LEGACY_BLOCK_REGEX, '');
    }

    if (fs.existsSync(bridgeBakPath)) {
      bridgeJs = fs.readFileSync(bridgeBakPath, 'utf8');
    } else {
      bridgeJs = bridgeJs.replace(LEGACY_BLOCK_REGEX, '');
    }

    // Inject into extension.js right after `Object.assign(exports, r('vscode'));`
    const anchor = "Object.assign(exports, r('vscode'));";
    if (!extJs.includes(anchor)) {
      return {
        patched: false,
        alreadyPatched: false,
        error: `Could not find "${anchor}" in ${extJsPath}`
      };
    }
    extJs = extJs.replace(anchor, `${anchor}\n${EXTENSION_HOST_PATCH_SNIPPET}`);

    // Capture the singleton acquireVsCodeApi() instance inside bridge.js even if window.acquireVsCodeApi is non-writable
    bridgeJs = bridgeJs.replace(
      'var a=acquireVsCodeApi();',
      'var a=(window.__agyHelperVsCodeApi||(window.__agyHelperVsCodeApi=acquireVsCodeApi()));'
    );

    // Prepend top script and append bottom drop zone script to bridge.js
    const sourceMapIdx = bridgeJs.indexOf('//# sourceMappingURL=');
    const sigIdx = bridgeJs.indexOf('// SIG //');
    const insertIdx = sourceMapIdx !== -1 ? sourceMapIdx : sigIdx !== -1 ? sigIdx : bridgeJs.length;
    bridgeJs =
      BRIDGE_TOP_SCRIPT +
      bridgeJs.slice(0, insertIdx) +
      BRIDGE_JS_PATCH_SNIPPET +
      bridgeJs.slice(insertIdx);

    fs.writeFileSync(extJsPath, extJs, 'utf8');
    fs.writeFileSync(bridgeJsPath, bridgeJs, 'utf8');

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
 * Remove the drag-and-drop patch from a `google.google-antigravity` directory.
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
 * Ensure all installed `google.google-antigravity` extensions and the VS Code workbench
 * have the drag-and-drop bridge and selection floating button enabled.
 * @param {{ silent?: boolean }} [options]
 */
async function ensureDragAndDropEnabled(options = {}) {
  const dirs = findAntigravityExtensionDirs();
  if (dirs.length === 0) {
    if (!options.silent) {
      vscode.window.showWarningMessage(
        'Antigravity Helper: Could not find an installed Google Antigravity extension (`google.google-antigravity`).'
      );
    }
    return;
  }

  let anyPatched = false;
  let anyAlreadyPatched = false;
  /** @type {string[]} */
  const errors = [];

  for (const dir of dirs) {
    const res = patchAntigravityDir(dir);
    if (res.patched) anyPatched = true;
    if (res.alreadyPatched) anyAlreadyPatched = true;
    if (res.error) errors.push(res.error);
  }

  const wbRes = patchVscodeWorkbench();
  if (wbRes.patched) anyPatched = true;
  if (wbRes.alreadyPatched) anyAlreadyPatched = true;

  if (errors.length > 0 && !anyPatched && !anyAlreadyPatched) {
    vscode.window.showErrorMessage(`Antigravity Helper: Failed to enable drag-and-drop: ${errors.join('; ')}`);
    return;
  }

  if (anyPatched) {
    const action = await vscode.window.showInformationMessage(
      'Antigravity Helper: Direct drag-and-drop and selection Chat button have been enabled! Reload the window to apply.',
      'Reload Window'
    );
    if (action === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } else if (!options.silent && anyAlreadyPatched) {
    vscode.window.showInformationMessage(
      'Antigravity Helper: Direct drag-and-drop and selection Chat button are already enabled.'
    );
  }
}

/**
 * Disable the drag-and-drop patch and restore original files.
 */
async function disableDragAndDrop() {
  const dirs = findAntigravityExtensionDirs();
  let anyRestored = false;
  for (const dir of dirs) {
    const res = unpatchAntigravityDir(dir);
    if (res.restored) anyRestored = true;
  }

  const wbRes = unpatchVscodeWorkbench();
  if (wbRes.restored) anyRestored = true;

  if (anyRestored) {
    const action = await vscode.window.showInformationMessage(
      'Antigravity Helper: Original Google Antigravity files restored. Reload the window to apply.',
      'Reload Window'
    );
    if (action === 'Reload Window') {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } else {
    vscode.window.showInformationMessage(
      'Antigravity Helper: No drag-and-drop patch was active.'
    );
  }
}

module.exports = {
  installRuntimeVscodeHook,
  ensureDragAndDropEnabled,
  disableDragAndDrop,
  patchAntigravityDir,
  unpatchAntigravityDir,
  patchVscodeWorkbench,
  unpatchVscodeWorkbench,
  findAntigravityExtensionDirs
};

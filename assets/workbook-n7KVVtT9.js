import{r as m}from"./readonly-signal-C6IA7k3L.js";import{S as w,b as h,p as v,a as k}from"./button-content-D6qi9d6w.js";import{i as x,a as y,b as c,A as b,S as f}from"./ui-runtime-DZIFwxVs.js";const $={preview:!1,disabled:!0,preparing:!1,status:"Loading score controls…"};function P(a,e,t={},s=!1){const r=n=>`${t.idPrefix??""}${n}`,o=t.printWidth&&Number.isFinite(t.printWidth)&&t.printWidth>0?` (${t.printWidth}px)`:"",i=t.scoreCount&&Number.isInteger(t.scoreCount)&&t.scoreCount>0?`all ${t.scoreCount} scores`:"all scores",l=t.sourceHref?c`<a class="source-link" part="link" href=${t.sourceHref}>${h(v,"Read the markup",{layout:"inline"})}</a>`:b;return c`
    <div class="toolbar" part="controls" role="group" aria-label="Score display controls">
      <label><input id=${r("print-preview")} part="preview" type="checkbox"
        aria-describedby=${r("print-layout-help")} .checked=${a.preview}
        @change=${e.preview} /> Use print layout on screen${o}</label>
      <button id=${r("print-scores")} part="print-button" type="button" aria-describedby=${r("print-dialog-help")}
        .disabled=${a.disabled} @click=${e.print}>${h(k,"Open print dialog…")}</button>
      ${s?c`<slot name="actions"></slot><slot name="links">${l}</slot>`:l}
    </div>
    <p id=${r("print-layout-help")} class="toolbar-help" part="help">The checkbox fixes score wrapping at the print width; it does not show paper pages. Short scores may look unchanged.${t.exampleHref?c` Try the <a part="link" href=${t.exampleHref}>automatic ensemble</a> in a narrow window to see the difference.`:b}</p>
    <p id=${r("print-dialog-help")} class="toolbar-help" part="help">Printing includes ${i} and their explanations, without source snippets or text transcripts. It always uses the print layout, whether the checkbox is on or off. Choose paper and margins in your browser’s dialog, then Print or Save as PDF if offered. If no dialog opens here, use a browser with printing support.</p>
    <p id=${r("workbook-status")} class="workbook-status" part="status" role="status" aria-live="polite" aria-atomic="true">${a.status}</p>
  `}let S=0;const u=class u extends x{constructor(){super(...arguments),this.idPrefix=`workbook-${++S}-`,this.sourceHref="",this.exampleHref="",this.signals=new w(this,()=>this.model?.view.get()??$),this.actions={preview:e=>this.model?.setPreview(e.currentTarget.checked),print:()=>{this.model?.requestPrint()}}}get model(){return this.currentModel}set model(e){if(e===this.currentModel)return;const t=this.currentModel;t?.cancelPendingPrint(),this.currentModel=e,this.signals.refresh(),this.requestUpdate("model",t)}disconnectedCallback(){this.model?.cancelPendingPrint(),super.disconnectedCallback()}render(){return P(this.signals.value,this.actions,this,!0)}};u.styles=y`
    :host { display: block; min-width: 0; font: inherit; }
    :host([hidden]), [hidden], ::slotted([hidden]) { display: none !important; }
    *, *::before, *::after, ::slotted(*) { box-sizing: border-box; }
    button, input, ::slotted(button), ::slotted(input), ::slotted(select) { font: inherit; }
    button, input, ::slotted(button), ::slotted(input) { accent-color: var(--workbook-accent, #714a37); }
    a, ::slotted(a) { color: var(--workbook-accent, #714a37); text-underline-offset: 0.2em; }
    button:focus-visible, input:focus-visible, a:focus-visible, ::slotted(:focus-visible) {
      outline: 3px solid var(--workbook-focus, #96613e);
      outline-offset: 4px;
    }
    .toolbar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px 24px;
      margin-top: 24px;
      padding: 15px 0;
      border-block: 1px solid var(--workbook-border, #dedfd5);
      font-size: 0.9rem;
    }
    label { display: flex; align-items: center; gap: 9px; cursor: pointer; min-width: 0; }
    .toolbar input { width: 1.1rem; height: 1.1rem; margin: 0; flex-shrink: 0; }
    button, ::slotted(button) {
      min-width: 44px;
      min-height: 44px;
      color: var(--workbook-button-color, #fffefa);
      background: var(--workbook-button-background, #3e493e);
      border: 1px solid var(--workbook-button-background, #3e493e);
      padding: 7px 14px;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover, ::slotted(button:hover) { background: var(--workbook-button-hover, #293529); }
    button:disabled, ::slotted(button:disabled) { opacity: 0.65; cursor: wait; }
    slot { display: contents; }
    .source-link, ::slotted([slot="links"]) { margin-inline-start: auto; }
    ::slotted(*) { max-width: 100%; }
    .toolbar-help { margin: 10px 0 0; max-width: 90ch; color: var(--workbook-muted, #52564d); font-size: 0.85rem; }
    .workbook-status { margin: 12px 0 0; color: var(--workbook-muted, #52564d); font-size: 0.85rem; }
    @media (max-width: 600px) {
      .toolbar { gap: 12px 18px; }
      .source-link, ::slotted([slot="links"]) { margin-inline-start: 0; }
    }
    @media (forced-colors: active) {
      .toolbar { border-color: CanvasText; }
      button, ::slotted(button) { border-color: ButtonText; }
      button:focus-visible, input:focus-visible, a:focus-visible, ::slotted(:focus-visible) { outline-color: Highlight; }
    }
    @media print { :host { display: none !important; } }
  `,u.properties={model:{attribute:!1,noAccessor:!0},idPrefix:{attribute:"id-prefix"},printWidth:{type:Number,attribute:"print-width"},scoreCount:{type:Number,attribute:"score-count"},sourceHref:{attribute:"source-href"},exampleHref:{attribute:"example-href"}};let p=u;customElements.get("music-workbook-toolbar")||customElements.define("music-workbook-toolbar",p);function g(a){return a?"Previewing score layout at the configured print width. This does not show physical paper pages.":"Responsive score layout. Printing uses each score’s configured print width."}class C{constructor(e,t={}){this.activeRequest=null,this.disposed=!1,this.host=e;const s=t.preview??!1;this.snapshot=new f.State({preview:s,externallyDisabled:t.disabled??!1,preparing:!1,status:g(s)}),this.view=m(new f.Computed(()=>{const{preview:r,externallyDisabled:o,preparing:i,status:l}=this.snapshot.get();return Object.freeze({preview:r,disabled:o||i,preparing:i,status:l})})),this.host.applyPreview(s)}setPreview(e){if(this.disposed)return;const t=this.snapshot.get();this.snapshot.set({...t,preview:e,status:t.preparing?t.status:g(e)}),this.host.applyPreview(e)}setDisabled(e){if(this.disposed)return;const t=this.snapshot.get();t.externallyDisabled!==e&&this.snapshot.set({...t,externallyDisabled:e})}async requestPrint(){const e=this.snapshot.get();if(this.disposed||this.activeRequest||e.externallyDisabled)return;const t={previousStatus:e.status};this.activeRequest=t,this.snapshot.set({...e,preparing:!0,status:"Preparing scores for the print dialog…"});try{for(;this.isCurrent(t);){const s=this.readRenderSnapshot();if(await Promise.all(s.completions),!this.isCurrent(t))return;const r=this.readRenderSnapshot();if(!this.isCurrent(t))return;if(r.scores.length!==s.scores.length||r.scores.some((l,n)=>l!==s.scores[n]||r.completions[n]!==s.completions[n]))continue;let o=0,i=0;for(const l of r.scores){const n=l.diagnostics;if(!Array.isArray(n))throw new Error("A score has not reported its rendering status. Reload the workbook and try again.");n.some(d=>d.severity==="error")&&o++,i+=n.filter(d=>d.severity==="warning").length}if(!this.isCurrent(t))return;if(o){this.setStatus(`Printing blocked: ${o} score${o===1?" has":"s have"} notation errors. Review the score diagnostics, fix the errors, and try again.`);return}this.setStatus("Print dialog requested."+(i?` ${i} notation notice${i===1?" remains":"s remain"}; review the score diagnostics.`:"")+" If nothing opens, use your browser’s Print command."),this.isCurrent(t)&&this.host.requestPrint();return}}catch(s){if(this.isCurrent(t)){const r=s instanceof Error&&s.message?s.message:"The print request could not be prepared.";this.setStatus(`Could not request printing: ${r} Review any reported errors, fix them, and try again.`)}}finally{this.isCurrent(t)&&(this.activeRequest=null,this.snapshot.set({...this.snapshot.get(),preparing:!1}))}}cancelPendingPrint(){const e=this.activeRequest;e&&(this.activeRequest=null,this.snapshot.set({...this.snapshot.get(),preparing:!1,status:e.previousStatus}))}dispose(){this.disposed||(this.disposed=!0,this.cancelPendingPrint())}isCurrent(e){return!this.disposed&&this.activeRequest===e}setStatus(e){this.snapshot.set({...this.snapshot.get(),status:e})}readRenderSnapshot(){const e=[...this.host.readScores()];if(!e.length)throw new Error("No scores are available to print.");const t=e.map(s=>{const r=s.renderComplete;if(!r||typeof r.then!="function")throw new Error("A score is not ready. Reload the workbook after its music components have loaded.");return r});return{scores:e,completions:t}}}function q({root:a,requestPrint:e,preview:t,disabled:s}){const r=()=>[...a.querySelectorAll("[data-score]")].filter(o=>o.isConnected);return new C({readScores:r,applyPreview:o=>{for(const i of r())i.toggleAttribute("print-preview",o)},requestPrint:e},{preview:t,disabled:s})}const R=document.querySelector("music-workbook-toolbar"),H=q({root:document,requestPrint:()=>window.print()});R.model=H;

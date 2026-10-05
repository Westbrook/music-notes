import{i as m,a as w,b as o,A as $e,c as P,D as ke}from"./ui-runtime-DZIFwxVs.js";import{b as e,p as ae,a as Ue,f as be,S as He}from"./button-content-DK5Fi-Iu.js";import{p as Le,a as xe,b as Se,c as We,d as Be,e as p,f as ze,g as je,h as Qe,i as ne,j as d,k as Ce,l as b,m as v,n as r,o as qe,q as Ae,r as he,s as Ge,t as Ke,u as Ve,v as Re,w as c,x as N,y as Ye,z as Ze,A as g,B as Je,C as t,D as $,E as k,F as x,G as S,H as C,I as q,J as A,K as R,L as y,M as T,N as z,O as Xe,P as Te,Q as ie,R as _e,S as et,T as tt,U as ot,V as Pe,W as h,X as se,Y as Ne,Z as O,_ as at,$ as le,a0 as M,a1 as l,a2 as nt,a3 as it,a4 as st,a5 as lt,a6 as rt,a7 as Ee,a8 as I,a9 as F,aa as ct,ab as ve,ac as dt,ad as me,ae as ut,af as pt,ag as bt,ah as ht,ai as vt,aj as De,ak as J,al as Me,am as Z,an as j,ao as Q,ap as E,aq as G,ar as D,as as K,at as V,au as Y,av as mt,aw as ft,ax as gt,ay as yt,az as wt,aA as $t}from"./offline-status-CJpAAGGn.js";const L=class L extends m{constructor(){super(...arguments),this.mode="write",this.toolsPresentation="closed"}render(){return o`<slot name="score"></slot><slot name="tools"></slot><slot name="palette"></slot><slot name="listen"></slot><slot name="read"></slot>`}mount(){this.performUpdate()}};L.properties={mode:{reflect:!0},toolsPresentation:{attribute:"tools-presentation",reflect:!0}},L.styles=w`
    :host {
      box-sizing: border-box;
      display: grid;
      position: relative;
      container: author-workbench / inline-size;
      flex: 1;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      grid-template-areas: "score" "dock";
      gap: 0;
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      --tools-pane-width: 320px;
      --writing-frame-gap: 16px;
    }
    :host([hidden]), :host([mode="pages"]) { display: none !important; }
    slot { display: contents; }
    ::slotted([slot="score"]) {
      grid-area: score;
      display: grid;
      grid-template-rows: minmax(0, 1fr);
      justify-self: start;
      align-self: stretch;
      width: var(--writing-frame-width, min(960px, 100%));
      max-width: none;
      min-width: 0;
      min-height: 0;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--author-divider, #c8cfd6);
      border-radius: 4px 4px 0 0;
      background: var(--author-paper, #fff);
      color: var(--author-ink, #20252b);
      box-shadow: none;
    }
    ::slotted([slot="score"]:focus-visible) { outline-offset: -3px; }
    ::slotted([slot="tools"]) { grid-area: score; justify-self: start; z-index: 1; }
    ::slotted([slot="palette"]), ::slotted([slot="listen"]), ::slotted([slot="read"]) { grid-area: dock; }
    /* The sheet hides its same-width paper without changing engraving width. */
    :host([tools-presentation="sheet"]) ::slotted([slot="score"]) { visibility: hidden; pointer-events: none; }
    :host([tools-presentation="side"]) ::slotted([slot="tools"]) {
      width: var(--tools-pane-width);
      margin-inline-start: calc(var(--writing-frame-width) + var(--writing-frame-gap));
    }
    :host([tools-presentation="sheet"]) ::slotted([slot="tools"]) { width: 100%; margin-inline-start: 0; }
    :host([tools-presentation="closed"]) ::slotted([slot="tools"]) { display: none !important; }
    :host([mode="listen"]) ::slotted([slot="score"]) { width: min(960px, 100%); }
    :host(:not([mode="write"])) ::slotted([slot="tools"]),
    :host(:not([mode="write"])) ::slotted([slot="palette"]) { display: none !important; }
    :host(:not([mode="listen"])) ::slotted([slot="listen"]) { display: none !important; }
    :host(:not([mode="read"])) ::slotted([slot="read"]) { display: none !important; }
    @media (forced-colors: active) {
      ::slotted([slot="score"]) { border-color: CanvasText; }
    }
    @media print { :host { display: none !important; } }
  `;let X=L;customElements.get("music-workspace-frame")||customElements.define("music-workspace-frame",X);const ce=class ce extends m{render(){return o`<slot name="header" part="header"></slot><slot name="body" part="body"></slot><slot name="footer" part="footer"></slot>`}mount(){this.performUpdate()}};ce.styles=w`
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      max-height: inherit;
      box-sizing: border-box;
    }
    :host([hidden]) { display: none !important; }
    slot { display: contents; }
    ::slotted([slot="header"]), ::slotted([slot="footer"]) { flex: none; }
    ::slotted([slot="body"]) { flex: 1; min-width: 0; min-height: 0; overflow: auto; }
    ::slotted([slot="footer"]) { padding: 0 14px 12px; }
    @media (max-width: 760px) { ::slotted([slot="footer"]) { padding: 0 11px 12px; } }
    @media (max-height: 480px) { ::slotted([slot="footer"]) { padding-bottom: 7px; } }
  `;let _=ce;customElements.get("music-panel-frame")||customElements.define("music-panel-frame",_);const W=class W extends m{constructor(){super(...arguments),this.mode="write",this.requestWrite=()=>this.requestMode("write"),this.requestRead=()=>this.requestMode("read"),this.requestListen=()=>this.requestMode("listen"),this.requestPages=()=>this.requestMode("pages")}requestMode(a){this.dispatchEvent(new CustomEvent("view-request",{detail:{mode:a},bubbles:!0,composed:!0}))}render(){return o`
      <nav part="group" aria-label="Workspace view">
        <button part="button" id="view-write" type="button" aria-pressed=${this.mode==="write"} @click=${this.requestWrite}>${e(Le,"Write")}</button>
        <button part="button" id="view-read" type="button" aria-pressed=${this.mode==="read"} @click=${this.requestRead}>${e(xe,"Read")}</button>
        <button part="button" id="view-listen" type="button" aria-pressed=${this.mode==="listen"} @click=${this.requestListen}>${e(Se,"Listen")}</button>
        <button part="button" id="view-pages" type="button" aria-pressed=${this.mode==="pages"} @click=${this.requestPages}>${e(We,"Pages")}</button>
      </nav>
    `}mount(){this.performUpdate()}};W.properties={mode:{attribute:!1}},W.styles=w`
    :host {
      display: inline-flex;
      min-width: 0;
      max-width: 100%;
      font: inherit;
    }
    :host([hidden]) { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    nav {
      display: inline-flex;
      align-items: center;
      gap: var(--music-ui-group-gap);
      padding: var(--music-ui-group-padding);
      border-radius: var(--music-ui-group-radius);
      background: var(--music-ui-color-paper);
      box-shadow: inset 0 0 0 var(--music-ui-border-width) var(--music-ui-color-divider);
    }
    button {
      flex: none;
      min-width: var(--music-ui-control-size);
      min-height: var(--music-ui-control-size);
      max-width: 100%;
      padding: var(--music-ui-control-padding-block) var(--music-ui-control-padding-inline);
      border: var(--music-ui-border-width) solid transparent;
      border-radius: var(--music-ui-control-radius);
      background: transparent;
      color: var(--music-ui-color-ink);
      font: inherit;
      font-size: var(--music-ui-label-size);
      font-weight: var(--music-ui-control-weight);
      line-height: var(--music-ui-label-line-height);
      cursor: pointer;
    }
    button:hover {
      border-color: var(--music-ui-color-border);
      background: var(--music-ui-color-active);
    }
    button[aria-pressed='true'] {
      border-color: var(--music-ui-color-ink);
      background: var(--music-ui-color-active);
      color: var(--music-ui-color-ink);
    }
    button:focus-visible {
      outline: var(--music-ui-focus-width) solid var(--music-ui-color-focus);
      outline-offset: calc(-1 * var(--music-ui-focus-width));
    }
    @media (forced-colors: active) {
      nav {
        background: Canvas;
        box-shadow: none;
        outline: var(--music-ui-border-width) solid GrayText;
        outline-offset: calc(-1 * var(--music-ui-border-width));
      }
      button { color: ButtonText; }
      button:hover { border-color: ButtonText; }
      button[aria-pressed='true'] {
        border-color: Highlight;
        background: Canvas;
        color: ButtonText;
        outline: 2px solid Highlight;
        outline-offset: calc(-1 * var(--music-ui-focus-width));
      }
      button:focus-visible { outline: var(--music-ui-focus-width) dashed Highlight; }
    }
    @media print { :host { display: none !important; } }
  `;let ee=W;customElements.get("music-view-switch")||customElements.define("music-view-switch",ee);function kt(i="write"){return o`
    <a id="skip-to-score" class="skip-link nonprinting" href="#score-editor">Skip to the score</a>
    <header class="app-header nonprinting">
      <div class="header-document"><a class="brand" href=${"/music-notes/index.html"} aria-label="Music Notes notation workbook">Music Notes</a>
        <div class="document-identity">
          <span id="document-title" class="document-name">Untitled composition</span>
          <div class="document-subline">
            <span id="save-status" class="save-status">Opening…</span>
            <span id="workspace-feedback-label" class="workspace-feedback-label" role="status" aria-live="polite" aria-atomic="true"></span>
          </div>
        </div>
        <button id="active-part-label" class="part-navigation" type="button" popovertarget="location-panel" aria-describedby="part-navigation-help" title="Choose part and location">${e(Be,o`<span data-control-label>Full score</span>`,{layout:"inline"})}</button>
        <span id="part-navigation-help" class="visually-hidden">Choose the part or musical location to view.</span>
      </div>
      <music-view-switch id="view-switch" class="view-switch" .mode=${i}></music-view-switch>
      <div class="header-actions">
        <div class="history-actions" aria-label="Edit history">
          <button id="undo" type="button" class="quiet-button" title="Undo (Command or Control + Z)" disabled="">${e(p,"Undo")}</button>
          <button id="redo" type="button" class="quiet-button" title="Redo (Command or Control + Shift + Z)" disabled="">${e(ze,"Redo")}</button>
          <div id="workspace-review-slot" class="workspace-review-slot">
            <button id="workspace-review-trigger" type="button" class="quiet-button" popovertarget="workspace-review" hidden>${e(je,o`<span data-control-label>Review</span>`)}</button>
          </div>
        </div>
        <div class="document-actions">
          <button id="source-trigger" type="button" class="quiet-button" popovertarget="source-panel">${e(ae,"Source")}</button>
          <button id="document-menu-trigger" class="document-menu-trigger" type="button" popovertarget="document-menu">${e(Qe,"Document")}</button>
        </div>
      </div>
    </header>
  `}function xt(){return o`
    <section slot="listen" id="listen-tools" class="listen-tools nonprinting" aria-label="Listening controls" hidden>
      <div class="listen-transport">
        <button id="listen-play" type="button" disabled>Play</button>
        <button id="listen-stop" type="button" disabled>Stop</button>
        <output id="listen-time" aria-label="Playback position" aria-live="off">0:00 / 0:00</output>
        <label class="field" for="listen-tempo"><span>Starting tempo<br>♩ / min</span>
          <input id="listen-tempo" type="number" min="20" max="300" step="1" value="80" inputmode="numeric" aria-describedby="listen-tempo-help">
        </label>
        <button id="listen-score-tempo" type="button" class="quiet-button">Use score tempo</button>
        <button id="listen-download" type="button" disabled>Download WAV</button>
      </div>
      <div class="listen-feedback">
        <p id="listen-status" class="field-help" role="status">Preparing Listen…</p>
        <p id="listen-notices" class="field-help"></p>
        <details class="listen-details"><summary>Playback details</summary>
          <p id="listen-tempo-help">Tempo changes keep their proportions. Without a written tempo, playback starts at 80 BPM. Tempo controls affect playback only.</p>
          <p>Plays the current score or selected part using a synthesized brass-like sound. WAV downloads contain the same audio. Sound stays in this browser.</p>
        </details>
      </div>
    </section>
  `}function St(){return o`
    <section slot="read" id="read-tools" class="read-tools nonprinting" aria-label="Reading controls" hidden="">
      <div>
        <p class="panel-kicker">Stay with the music</p>
        <p id="read-location" class="field-help" role="status">Reading at authored pitch.</p>
      </div>
      <div class="read-navigation">
        <button id="read-previous" type="button">${e(ne,"Previous")}</button>
        <label class="field" for="read-measure">Go to measure<select id="read-measure" name="read-measure" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">Choose a measure</option>
          </select>
        </label>
        <button id="read-go" type="button">${e(d,"Go")}</button>
        <button id="read-next" type="button">${e(d,"Next")}</button>
        <button id="read-refit" type="button" class="quiet-button">${e(Ce,"Refit this window")}</button>
      </div>
    </section>
  `}function Ct(){return o`
    <section id="pages-tools" class="pages-tools nonprinting" aria-label="Paper and publishing" hidden="">
      <div class="page-controls">
        <button id="print-score" type="button" class="primary-button">${e(Ue,"Print / Save as PDF")}</button>
      </div>
      <div class="tool-disclosures page-disclosures">
        <details id="paper-inspector" class="inspector"><summary>Paper &amp; spacing</summary>
          <div class="inspector-content">
            <div class="draft-notice">
              <p id="page-draft-status" class="draft-status" role="status" aria-live="polite"></p>
              <div class="draft-actions">
                <button id="discard-page-draft" type="button" class="quiet-button" hidden="">${e(b,o`<span id="discard-page-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
                <button id="return-page-draft" type="button" class="quiet-button" hidden="">${e(p,o`<span id="return-page-draft-label" data-control-label>Return to target</span>`)}</button>
                <button id="review-page-draft" type="button" class="quiet-button" hidden="">${e(v,"Review current changes")}</button>
              </div>
            </div>
            <div class="field-grid">
              <label class="field" for="page-paper">Paper<select id="page-paper" name="page-paper" class="author-select">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="letter">US Letter</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label class="field" for="page-orientation">Orientation<select id="page-orientation" name="page-orientation" class="author-select">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
              <label class="field" for="page-margin">Margins (mm)<input id="page-margin" name="page-margin" type="number" value="15" min="5" max="50" step="1">
              </label>
              <label class="field" for="page-scale">Staff scale<input id="page-scale" name="page-scale" type="number" value="1" min="0.5" max="2" step="0.05">
              </label>
              <label class="field" for="page-max-measures">Max. measures per line<input id="page-max-measures" name="page-max-measures" type="number" min="1" max="32" step="1" placeholder="Automatic">
              </label>
              <label class="field" for="page-measure-numbers">Measure numbers<select id="page-measure-numbers" name="page-measure-numbers" class="author-select">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="system">Start of system</option>
                  <option value="all">Every measure</option>
                  <option value="none">None</option>
                </select>
              </label>
            </div>
            <label class="check-field" for="page-justify-last">
              <input id="page-justify-last" name="page-justify-last" type="checkbox"> Stretch the final system to the available width</label>
            <button id="apply-pages" type="button" class="primary-button">${e(r,"Apply page settings")}</button>
          </div>
        </details>
        <details id="break-inspector" class="inspector"><summary>Lines &amp; page boundaries</summary>
          <div class="inspector-content">
            <div class="draft-notice">
              <p id="boundary-draft-status" class="draft-status" role="status" aria-live="polite"></p>
              <div class="draft-actions">
                <button id="discard-boundary-draft" type="button" class="quiet-button" hidden="">${e(b,o`<span id="discard-boundary-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
                <button id="return-boundary-draft" type="button" class="quiet-button" hidden="">${e(p,o`<span id="return-boundary-draft-label" data-control-label>Return to target</span>`)}</button>
                <button id="review-boundary-draft" type="button" class="quiet-button" hidden="">${e(v,"Review current changes")}</button>
              </div>
            </div>
            <label class="field" for="page-measure-select">Measure boundary<select id="page-measure-select" name="page-measure-select" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="">Choose a measure</option>
              </select>
            </label>
            <p id="page-selection-context" class="page-selection-context field-help" role="status">Choose the measure where this line or page should begin.</p>
            <div class="field-grid two-fields">
              <label class="field" for="layout-break">Start this measure<select id="layout-break" name="layout-break" class="author-select">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="auto">Automatically</option>
                  <option value="line">On a new line</option>
                  <option value="page">On a new page</option>
                </select>
              </label>
              <label class="check-field align-end" for="layout-keep">
                <input id="layout-keep" name="layout-keep" type="checkbox"> Prefer to keep with the next measure</label>
            </div>
            <p class="field-help">A keep preference can yield to fit or an explicit break. A page break does not certify a safe turn.</p>
            <button id="apply-break" type="button" class="primary-button">${e(r,"Apply boundary choices")}</button>
          </div>
        </details>
        <details id="turn-inspector" class="inspector"><summary>Review a page turn</summary>
          <div class="inspector-content">
            <label class="field" for="turn-boundary">Page boundary<select id="turn-boundary" name="turn-boundary" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="">Choose a page boundary</option>
              </select>
            </label>
            <div id="turn-preview" class="turn-preview"></div>
            <p class="field-help">Check both sides of the turn for the whole part. Open improvisation and one resting voice do not establish time to turn.</p>
            <div class="button-row">
              <button id="mark-turn-reviewed" type="button">${e(qe,"Mark reviewed")}</button>
              <button id="clear-turn-review" type="button" class="quiet-button">${e(Ae,"Clear review")}</button>
            </div>
          </div>
        </details>
      </div>
      <section class="preflight-panel" aria-label="Publication checks">
        <div id="page-preflight" role="status"></div>
        <details class="print-options"><summary>Print options</summary>
          <label class="check-field" for="ack-layout-warnings">
            <input id="ack-layout-warnings" name="ack-layout-warnings" type="checkbox"> I have inspected the reported layout warnings on these pages.</label>
          <label class="check-field" for="print-draft">
            <input id="print-draft" name="print-draft" type="checkbox"> Print a clearly marked draft if musical work remains</label>
          <p class="field-help">A print request opens the browser dialog; it does not confirm that a PDF was saved. Match the preview’s paper settings and turn off browser headers and footers.</p>
        </details>
      </section>
    </section>
  `}const fe="Staff, measure, voice, and event navigation";function Ie(i){const a=new Set(i.selectedIds);return o`
    ${P(i.measure.voices,n=>n.id,(n,u)=>o`
      <div class="event-voice-group">
        <p class="field-help">Voice ${u+1}</p>
        ${P(n.events,s=>s.id,s=>o`
          <button type="button" data-source-id=${s.id}
            aria-pressed=${String(a.has(s.id))}
            class=${u===i.voiceIndex?"active-voice":""}>${e(Ge(s),`${he(s)} · at ${be(s.onset)}`,{layout:"inline"})}</button>
          ${P(s.markings??[],f=>f.id,f=>o`
            <button type="button" class="event-marking-link" data-source-id=${f.id}
              aria-current=${i.activeMarkingId===f.id?"true":$e}>${e(Ve(f),`${Ke(f)} · attached to ${he(s)}`,{layout:"inline"})}</button>
          `)}
        `)}
      </div>
    `)}
    ${P(i.measure.annotations,n=>n.id,n=>o`
      <button type="button" data-source-id=${n.id}>${e(n.kind==="dynamics"?Re:n.kind==="tempo"?c:N,`${n.kind}: ${n.text||n.bpm} · at ${be(n.onset)}`,{layout:"inline"})}</button>
    `)}
  `}function re(i){if(!i.isConnected)return null;const a=i.getRootNode();return"host"in a&&re(a.host)!==a.host?null:a.activeElement??null}function Fe(i){const a=re(i);return a&&i.contains(a)&&a.dataset.sourceId?{element:a,sourceId:a.dataset.sourceId}:void 0}function Oe(i,a,n){if(!a||!i.isConnected)return;if(i.contains(a.element)){re(i)!==a.element&&a.element.focus({preventScroll:!0});return}([...i.querySelectorAll("button[data-source-id]")].find(s=>s.dataset.sourceId===a.sourceId)??i.querySelector("button")??n)?.focus({preventScroll:!0})}const B=class B extends m{constructor(){super(...arguments),this.navigationLabel=fe,this.navigate=a=>{const u=a.composedPath().find(s=>s instanceof Element&&s.localName==="button"&&this.renderRoot.contains(s))?.dataset.sourceId;u&&this.dispatchEvent(new CustomEvent("navigate-request",{bubbles:!0,composed:!0,detail:{sourceId:u,shiftKey:a.shiftKey===!0,metaKey:a.metaKey===!0,ctrlKey:a.ctrlKey===!0,altKey:a.altKey===!0}}))}}renderState(a,n){this.fallbackFocus=n,this.state=a,this.requestUpdate(),this.performUpdate()}willUpdate(){this.focused=Fe(this.renderRoot)}updated(){Oe(this.renderRoot,this.focused,this.fallbackFocus??this.renderRoot.querySelector("nav")??void 0),this.focused=void 0}render(){return o`<nav role="navigation" aria-label=${this.navigationLabel||fe}
      tabindex="-1" @click=${this.navigate}>${this.state?Ie(this.state):$e}</nav>`}};B.properties={state:{attribute:!1},navigationLabel:{attribute:"aria-label"}},B.styles=w`
    :host {
      display: block;
      min-width: 0;
      max-height: 360px;
      margin: 14px 0 0;
      overflow: auto;
      color: var(--music-ui-color-ink);
      font: inherit;
    }
    :host([hidden]) { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    .field-help {
      margin: 0;
      color: var(--music-ui-color-muted);
      font-size: 0.75rem;
      font-weight: 400;
      line-height: 1.5;
    }
    button {
      min-width: var(--music-ui-control-size);
      min-height: var(--music-ui-control-size);
      max-width: calc(100% - 6px);
      margin: 3px;
      padding: 8px 13px;
      border: var(--music-ui-border-width) solid var(--music-ui-color-border);
      border-radius: var(--music-ui-control-radius);
      background: var(--music-ui-color-surface);
      color: var(--music-ui-color-ink);
      font: inherit;
      font-size: 0.78rem;
      font-weight: var(--music-ui-control-weight);
      line-height: 1.35;
      text-align: start;
      overflow-wrap: anywhere;
      cursor: pointer;
    }
    button:hover {
      border-color: var(--music-ui-color-border);
      background: var(--music-ui-color-active);
    }
    button:focus-visible, nav:focus-visible {
      outline: var(--music-ui-focus-width) solid var(--music-ui-color-focus);
      outline-offset: calc(-1 * var(--music-ui-focus-width));
    }
    .event-marking-link {
      display: block;
      max-width: calc(100% - 22px);
      margin: 3px 3px 3px 19px;
      padding: 6px 9px;
      border-left-width: 3px;
      color: #596c50;
      background: #f7f9f3;
      font-size: 0.73rem;
      line-height: 1.3;
    }
    button[aria-pressed='true'], button[aria-current='true'] {
      border-color: var(--music-ui-color-border);
      color: var(--music-ui-color-ink);
      background: var(--music-ui-color-active);
    }
    @media (forced-colors: active) {
      button[aria-pressed='true'], button[aria-current='true'] {
        border-color: Highlight;
        color: ButtonText;
        background: Canvas;
        outline: 2px solid Highlight;
        outline-offset: calc(-1 * var(--music-ui-focus-width));
      }
      button:focus-visible, nav:focus-visible {
        outline: var(--music-ui-focus-width) dashed Highlight;
      }
    }
  `;let U=B;customElements.get("music-event-navigator")||customElements.define("music-event-navigator",U);const ge=new WeakSet;function _t(i,a,n){if(i instanceof U){i.renderState(a,n);return}const u=Fe(i);ge.has(i)||(i.replaceChildren(),ge.add(i)),ke(Ie(a),i),Oe(i,u,n)}const de=class de extends m{constructor(){super(...arguments),this.onScroll=a=>{const n=a.composedPath()[0];!this.isConnected||!(n instanceof HTMLElement)||this.dispatchEvent(new CustomEvent("notation-viewport-change",{bubbles:!0,composed:!0,detail:{scroller:n,layout:this.surface?.getLayoutGeometry()}}))}}mount(){this.performUpdate()}get scoreMount(){return this.mount(),this.renderRoot.querySelector(".score-mount")}get overlayMount(){return this.mount(),this.renderRoot.querySelector(".author-overlays")}get previewMount(){return this.mount(),this.renderRoot.querySelector(".gesture-overlays")}get surface(){return this.scoreMount.querySelector("music-system,music-staff,music-measure")??void 0}getNativeControlBounds(){return this.isConnected?(this.mount(),[...this.renderRoot.querySelectorAll("slot")].flatMap(a=>a.assignedElements({flatten:!0})).filter(a=>a instanceof HTMLElement&&a.getClientRects().length>0).map(a=>a.getBoundingClientRect()).filter(a=>a.width>0&&a.height>0)):[]}render(){return o`
      <slot name="actions" part="actions" data-author-input="native"></slot>
      <div class="score-mount" part="score" @scroll=${this.onScroll}></div>
      <div class="author-overlays" part="selection" aria-hidden="true"></div>
      <div class="gesture-overlays" part="preview" aria-hidden="true"></div>
      <slot name="help" part="help" data-author-input="native"></slot>
    `}};de.styles=w`
    :host { display: block; position: relative; min-width: 0; }
    *, *::before, *::after { box-sizing: border-box; }
    .score-mount { min-width: 0; overflow: auto; }
    .author-overlays, .gesture-overlays { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
    .gesture-overlays { overflow: visible; }
    .author-selection { position: absolute; border: 2px solid var(--author-selection, #175c96); border-radius: 3px;
      background: var(--author-selection-fill, rgba(23,92,150,.12)); }
    .author-playing { border-color: var(--music-ui-color-focus, #7037a0); background: rgba(112,55,160,.18); }
    .author-caret { position: absolute; width: 2px; background: var(--author-insertion, #087368);
      box-shadow: 0 0 0 2px var(--author-paper, #fff); }
    .author-measure-selection { border-style: dashed; background: transparent; }
    .author-event-focus { border: 2px dashed var(--author-focus, #7037a0); background: transparent;
      box-shadow: 0 0 0 1px var(--author-paper, #fff); }
    slot { display: block; }
    @media (forced-colors: active) {
      .author-selection { border-color: Highlight; background: transparent; }
      .author-caret { background: Highlight; box-shadow: 0 0 0 2px Canvas; }
      .author-event-focus { border-color: CanvasText; box-shadow: none; }
    }
    @media print { :host { display: none !important; } }
  `;let te=de;customElements.get("music-score-viewport")||customElements.define("music-score-viewport",te);function qt(){return o`
    <section slot="score" id="score-editor" class="score-editor" tabindex="0" aria-label="Music score editor" aria-describedby="keyboard-help">
      <div id="score-scroll" class="score-scroll" tabindex="0" aria-label="Notation viewport">
        <music-score-viewport id="score-host" class="score-host"></music-score-viewport>
        <details id="navigator-panel" class="navigator-panel nonprinting"><summary>${e(Ye,"Navigate the score as a list",{layout:"inline"})}</summary>
          <music-event-navigator id="event-navigator" class="event-navigator" aria-label="Staff, measure, voice, and event navigation"></music-event-navigator>
        </details>
        <details id="keyboard-shortcuts" class="keyboard-shortcuts nonprinting"><summary id="keyboard-shortcuts-summary">${e(Ze,"Keyboard shortcuts",{layout:"inline"})}</summary>
          <p id="keyboard-help" class="keyboard-help">With the score focused: in Write notes, N/R chooses a note or rest without inserting, Left/Right moves the writing point through existing music and bars, and Enter inserts the current recipe. A–G writes natural pitches in the configured octave on pitched staves. In Select, Left/Right selects music, Shift extends a range, Enter opens Properties, and Delete or Backspace removes the selection. Tap Select more in the palette, then tap notes to add or remove them. Range… selects a passage by its endpoints; Done keeps the selection. Escape cancels an active gesture or collection; when idle, it keeps the current mode. Command or Control + C copies selected notes; switch to Write notes and use Command or Control + V to paste at the writing cursor. Insertions continue through later bars as needed. Command or Control + Z undoes. Native fields and readable text keep their usual keys.</p>
        </details>
        <footer class="workspace-footer nonprinting"><a href=${"/music-notes/index.html"}>${e(xe,"Notation workbook",{layout:"inline"})}</a>
          <span>Written in musical HTML</span>
        </footer>
      </div>
    </section>
  `}function At(){return o`
    <section id="selection-inspector" class="tool-panel properties-panel" role="region" aria-labelledby="properties-heading" tabindex="0">
      <p id="event-form-context" class="target-context">Select an event to edit its values.</p>
      <div class="draft-notice">
        <p id="selected-draft-status" class="draft-status" role="status" aria-live="polite" tabindex="-1"></p>
        <div class="draft-actions">
          <button id="load-event-values" type="button" class="quiet-button" hidden>${e(b,o`<span id="load-event-values-label" data-control-label>Discard &amp; reload</span>`)}</button>
          <button id="return-selected-draft" type="button" class="quiet-button" hidden>${e(p,o`<span id="return-selected-draft-label" data-control-label>Return to target</span>`)}</button>
          <button id="review-selected-draft" type="button" class="quiet-button" hidden>${e(v,"Review current changes")}</button>
        </div>
      </div>
      <div class="properties-actions">
        <button id="properties-pitch" type="button" popovertarget="selection-pitch-chooser" aria-label="Pitch spelling and quarter-tone alterations" disabled>${e(g,"Spelling…")}</button>
        <button id="selection-prepare-drag" type="button" disabled>${e(Je,"Prepare pitch drag")}</button>
      </div>
      ${Rt()}
      <details id="event-details" class="sub-disclosure event-details"><summary>Event details</summary>
        <div class="sub-disclosure-content">
          <p class="field-help">Changes here are staged. Apply event details when ready; common selection controls apply immediately.</p>
          <div class="field-grid two-fields">
            <label class="field" for="selected-kind">Event type<select id="selected-kind" name="selected-kind" class="author-select" >
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="note">Note</option>
                <option value="chord">Chord</option>
                <option value="rhythm">Rhythm note (no pitch)</option>
                <option value="road">3 roads note</option>
                <option value="rest">Rest</option>
                <option value="rhythmic-slash">Rhythmic slash</option>
                <option value="slash">Open slash</option>
              </select>
            </label>
            <label id="selected-pitch-field" class="field" for="selected-pitch">Pitch &amp; octave<input id="selected-pitch" name="selected-pitch" type="text" value="C4" autocomplete="off" spellcheck="false" aria-describedby="selected-pitch-help" />
            </label>
            <label id="selected-pitches-field" class="field" for="selected-pitches" hidden>Chord pitches<input id="selected-pitches" name="selected-pitches" type="text" value="C4 E4 G4" autocomplete="off" spellcheck="false" aria-describedby="selected-pitch-help" />
            </label>
          </div>
          <p id="selected-pitch-help" class="field-help">Spell pitches explicitly: F4 is natural, F#4 sharp, Fqs4 quarter-sharp, and Fqf4 quarter-flat. Use tqf or tqs for three-quarter tones, including in chord pitches. These are alterations from the natural letter, not increments from the current spelling.</p>
          <fieldset id="selected-nominal-span" aria-describedby="selected-nominal-help" hidden>
            <legend>Nominal span (open slash)</legend>
            <div class="field-grid two-fields">
              <label class="field" for="selected-duration">Nominal value<select id="selected-duration" name="selected-duration" class="author-select" aria-describedby="selected-nominal-help">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  ${t({value:"breve",label:"Breve",icon:$})}
                  ${t({value:"whole",label:"Whole",icon:k})}
                  ${t({value:"half",label:"Half",icon:x})}
                  ${t({value:"quarter",label:"Quarter",icon:c,selected:!0})}
                  ${t({value:"eighth",label:"Eighth",icon:S})}
                  ${t({value:"sixteenth",label:"Sixteenth",icon:C})}
                  ${t({value:"thirty-second",label:"32nd",icon:q})}
                  ${t({value:"sixty-fourth",label:"64th",icon:A})}
                  ${t({value:"128th",label:"128th",icon:R})}
                  ${y("quarter")}
                </select>
              </label>
              <label class="field" for="selected-dots">Nominal dots<select id="selected-dots" name="selected-dots" class="author-select" aria-describedby="selected-nominal-help">
                  <button type="button"><selectedcontent></selectedcontent></button>
                  <option value="0">None</option>
                  <option value="1">1 dot</option>
                  <option value="2">2 dots</option>
                  <option value="3">3 dots</option>
                </select>
              </label>
            </div>
            <p id="selected-nominal-help" class="field-help">The time reserved by this open slash; its rhythm stays unwritten. Apply event details to accept the span.</p>
          </fieldset>
          <label class="check-field" for="selected-measure-rest" id="selected-measure-rest-field" hidden>
            <input id="selected-measure-rest" name="selected-measure-rest" type="checkbox" />Full-measure rest</label>
          <button id="update-event" type="button" class="primary-button" disabled>${e(r,"Apply event details")}</button>
        </div>
      </details>
      <details id="event-engraving" class="sub-disclosure"><summary>Engraving</summary>
        <div class="sub-disclosure-content">
          <div class="field-grid two-fields">
            <label class="field" for="selected-accidental-display">Show accidental<select id="selected-accidental-display" name="selected-accidental-display" class="author-select" >
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">When needed</option>
                <option value="always">Always</option>
                <option value="courtesy">Courtesy (parentheses)</option>
              </select>
            </label>
            <label class="field" for="selected-stem">Stem<select id="selected-stem" name="selected-stem" class="author-select" >
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">Automatic</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </label>
          </div>
          <p class="field-help">
            <span id="selected-accidental-help">Show accidental changes the printed sign, not the spelling. </span>These choices apply immediately; Undo restores each change.</p>
        </div>
      </details>
      <div id="selected-common-compat" hidden>
        <label id="selected-direction-field" class="field" for="selected-direction" hidden>Pitch direction<select id="selected-direction" name="selected-direction" class="author-select" aria-describedby="selected-direction-help">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="higher">Higher (top)</option>
            <option value="same">Same (middle)</option>
            <option value="lower">Lower (bottom)</option>
          </select>
        </label>
        <p id="selected-direction-help" class="field-help" hidden>Higher, same, and lower refer to the previous main pitch in this voice, including across rests and barlines. Harmony and ornament notes do not change that reference. Tied continuations use Same (middle). Changing direction does not change the written rhythm.</p>
        <label id="selected-slash-field" class="check-field compatibility-field" for="selected-rhythmic" hidden>
          <input id="selected-rhythmic" name="selected-rhythmic" type="checkbox" />Write slash rhythm</label>
      </div>
      <div class="button-row panel-actions">
        <button id="remove-event" type="button" class="danger-button">${e(T,"Remove event")}</button>
      </div>
    </section>
  `}function Rt(){return o`
    <section id="event-markings-editor" class="subsection" aria-labelledby="event-markings-heading">
      <div class="panel-heading">
        <h3 id="event-markings-heading">Attached marks</h3>
        <p>These marks belong to this event and add no written duration. Chord symbols and instructions at a musical position stay in Instructions.</p>
      </div>
      <p id="event-markings-target" class="target-context">Select one event to edit its attached marks.</p>
      <div class="draft-notice">
        <p id="event-markings-draft-status" class="draft-status" role="status" aria-live="polite" tabindex="-1"></p>
        <div class="draft-actions">
          <button id="discard-event-markings" type="button" class="quiet-button" hidden>${e(b,o`<span id="discard-event-markings-label" data-control-label>Discard changes</span>`)}</button>
          <button id="return-event-markings" type="button" class="quiet-button" hidden>${e(p,o`<span id="return-event-markings-label" data-control-label>Return to target</span>`)}</button>
          <button id="review-event-markings" type="button" class="quiet-button" hidden>${e(v,"Review current changes")}</button>
        </div>
      </div>
      <div id="event-markings-tie-options" class="event-markings-tie-options" hidden>
        <label class="check-field" for="event-markings-tie-scope">
          <input id="event-markings-tie-scope" name="event-markings-tie-scope" type="checkbox" aria-describedby="event-markings-tie-help">Apply interval edits to the complete tie chain</label>
        <p id="event-markings-tie-help" class="field-help">This scope changes harmony intervals across the complete connected tie chain in one edit. Articulations and ornaments stay on the selected segment. Leave it off to edit this segment only; no intervals are inherited automatically.</p>
      </div>
      <p id="event-markings-empty" class="field-help">No marks attached to this event.</p>
      <div id="event-markings-rows"></div>
      <div class="button-row">
        <button id="add-event-articulation" type="button">${e(z,"Add articulation")}</button>
        <button id="add-event-ornament" type="button">${e(Xe,"Add ornament")}</button>
        <button id="add-event-interval" type="button">${e(Te,"Add harmony interval")}</button>
      </div>
      <p id="event-markings-availability" class="field-help"></p>
      <p id="event-markings-placement-help" class="field-help">Articulations and ornaments are placed automatically opposite the drawn stem, or above when there is no stem. Harmony direction stays above or below the main pitch.</p>
      <p id="event-markings-interval-help" class="field-help" hidden>Use intervals 1–13 with optional b or #. For example, 5 above F is C; b3 below B♭ is G. Alter the interval’s distance before applying above or below. Every tied road segment must list the same full set of harmony intervals; nothing is inherited.</p>
      <p id="event-markings-ornament-help" class="field-help" hidden>Ornaments are printed instructions, not written auxiliary notes. In 3 roads music, choose ornament notes freely. Harmony and ornament notes never replace the main pitch used by higher, same, and lower.</p>
      <div class="button-row panel-actions">
        <button id="apply-event-markings" type="button" class="primary-button" disabled>${e(r,"Apply attached marks")}</button>
      </div>
    </section>
  `}function Tt(){return o`
    <section id="passage-inspector" class="tool-panel" role="tabpanel" aria-labelledby="tool-tab-rhythm" tabindex="0" hidden>
      <div class="panel-heading">
        <h2>Relationships &amp; passages</h2>
        <p>Choose events in one voice. Each operation stays together in one undo step.</p>
      </div>
      <div class="field-grid two-fields">
        <label class="field" for="range-start">From event<select id="range-start" name="range-start" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">Current selection</option>
          </select>
        </label>
        <label class="field" for="range-end">Through event<select id="range-end" name="range-end" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">Current selection</option>
          </select>
        </label>
      </div>
      <p id="range-status" class="field-help" role="status" tabindex="-1">Select events from one voice for ties, tuplets, or conversion.</p>
      <div class="button-row">
        <button id="tie-events" type="button">${e(ie,"Tie selected notes")}</button>
        <button id="clear-ties" type="button">${e(_e,o`<span id="clear-ties-label" data-control-label>Clear connected ties</span>`)}</button>
      </div>
      <div class="subsection">
        <div class="field-grid">
          <label class="field" for="convert-kind">Convert passage to<select id="convert-kind" name="convert-kind" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="slash">Improvisation slashes</option>
              <option value="rest">Rests</option>
              <option value="note">Written notes</option>
              <option value="rhythm">Rhythm notes (rhythm staff)</option>
              <option value="road">3 roads notes (3 roads staff)</option>
            </select>
          </label>
          <label class="field" for="convert-pitch">Pitch for written notes<input id="convert-pitch" name="convert-pitch" type="text" value="C4" spellcheck="false">
          </label>
          <label class="field" for="convert-direction" hidden>Pitch direction<select id="convert-direction" name="convert-direction" class="author-select" .value=${"same"}>
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="higher">Higher (top)</option>
              <option value="same" selected="">Same (middle)</option>
              <option value="lower">Lower (bottom)</option>
            </select>
          </label>
          <label class="check-field align-end" for="convert-rhythmic">
            <input id="convert-rhythmic" name="convert-rhythmic" type="checkbox"> Specify slash rhythm</label>
        </div>
        <p id="conversion-help" class="field-help">Rhythm notes prescribe durations without pitches; 3 roads notes prescribe relative pitch direction and duration. To switch between pitched and rhythm staves, use rhythmic slashes to preserve the written attacks, change the staff notation, then convert to the intended events. Open slashes leave attacks improvised. Remove incompatible attached marks deliberately; a failed conversion changes nothing.</p>
        <button id="convert-events" type="button">${e(et,"Review conversion…")}</button>
      </div>
      <section id="tuplet-inspector" class="subsection tuplet-section" aria-label="Tuplets">
        <div class="panel-heading">
          <h2>Tuplets</h2>
          <p>Written values retain their exact ratio, including nested groups.</p>
        </div>
        <div class="draft-notice">
          <p id="tuplet-draft-status" class="draft-status" role="status" aria-live="polite"></p>
          <div class="draft-actions">
            <button id="discard-tuplet-draft" type="button" class="quiet-button" hidden="">${e(b,o`<span id="discard-tuplet-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
            <button id="return-tuplet-draft" type="button" class="quiet-button" hidden="">${e(p,o`<span id="return-tuplet-draft-label" data-control-label>Return to target</span>`)}</button>
            <button id="review-tuplet-draft" type="button" class="quiet-button" hidden="">${e(v,"Review current changes")}</button>
          </div>
        </div>
        <label class="field" for="tuplet-select">Existing group<select id="tuplet-select" name="tuplet-select" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">New tuplet around selection</option>
          </select>
        </label>
        <div class="field-grid">
          <label class="field" for="tuplet-actual">Written units<input id="tuplet-actual" name="tuplet-actual" type="number" value="3" min="2" max="64" step="1">
          </label>
          <label class="field" for="tuplet-normal">In the time of<input id="tuplet-normal" name="tuplet-normal" type="number" value="2" min="1" max="64" step="1">
          </label>
          <label class="field" for="tuplet-bracket">Bracket<select id="tuplet-bracket" name="tuplet-bracket" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="auto">Automatic</option>
              <option value="yes">Show</option>
              <option value="no">Hide</option>
            </select>
          </label>
        </div>
        <label class="check-field" for="tuplet-ratio">
          <input id="tuplet-ratio" name="tuplet-ratio" type="checkbox"> Print the full ratio</label>
        <div class="button-row">
          <button id="wrap-tuplet" type="button" class="primary-button">${e(tt,"Make tuplet")}</button>
          <button id="update-tuplet" type="button">${e(r,"Apply group settings")}</button>
          <button id="unwrap-tuplet" type="button" class="danger-button">${e(T,"Remove tuplet grouping")}</button>
        </div>
      </section>
      <details id="beam-membership" class="sub-disclosure"><summary>Per-event beam membership</summary>
        <div class="sub-disclosure-content">
          <p id="beam-target-context" class="target-context">Uses the event held in Properties.</p>
          <label class="field" for="selected-beam">Per-event beam marker<select id="selected-beam" name="selected-beam" class="author-select" aria-describedby="beam-target-context beam-membership-help" >
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="auto">Follow beat groups</option>
              <option value="start">Start beam</option>
              <option value="continue">Continue beam</option>
              <option value="end">End beam</option>
              <option value="none">No beam</option>
            </select>
          </label>
          <p id="beam-membership-help" class="field-help">This marker applies immediately to the named event. It is not a whole-group beaming command. Return to Properties to change or review the held target.</p>
        </div>
      </details>
    </section>
  `}function Pt(){return o`
    <section id="annotation-inspector" class="tool-panel" role="tabpanel" aria-labelledby="tool-tab-markings" tabindex="0" hidden>
      <div class="panel-heading">
        <h2>Harmony &amp; instructions</h2>
        <p>Write a chord symbol or direction at an exact musical position.</p>
      </div>
      <div class="draft-notice">
        <p id="annotation-draft-status" class="draft-status" role="status" aria-live="polite"></p>
        <div class="draft-actions">
          <button id="discard-annotation-draft" type="button" class="quiet-button" hidden="">${e(b,o`<span id="discard-annotation-draft-label" data-control-label>Discard/start here</span>`)}</button>
          <button id="return-annotation-draft" type="button" class="quiet-button" hidden="">${e(p,o`<span id="return-annotation-draft-label" data-control-label>Return to target</span>`)}</button>
          <button id="review-annotation-draft" type="button" class="quiet-button" hidden="">${e(v,"Review current changes")}</button>
        </div>
      </div>
      <p id="annotation-draft-target" class="target-context">Choose a musical location.</p>
      <div class="field-grid">
        <label class="field" for="annotation-select">Existing instruction<select id="annotation-select" name="annotation-select" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="">New instruction</option>
          </select>
        </label>
        <label class="field" for="annotation-kind">Kind<select id="annotation-kind" name="annotation-kind" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="harmony">Chord symbol</option>
            <option value="direction">Performance direction</option>
            <option value="rehearsal">Rehearsal mark</option>
            <option value="dynamics">Dynamics</option>
            <option value="tempo">Tempo</option>
          </select>
        </label>
        <label class="field" for="annotation-placement">Placement<select id="annotation-placement" name="annotation-placement" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="above">Above staff</option>
            <option value="below">Below staff</option>
          </select>
        </label>
      </div>
      <label class="field" for="annotation-text">Printed text<textarea id="annotation-text" name="annotation-text" rows="2" placeholder="Dm9, softly, or Solo until cue…"></textarea>
      </label>
      <div class="field-grid annotation-position-fields">
        <div class="onset-actions">
          <button id="annotation-at-start" type="button" class="quiet-button">${e(ot,"At bar start")}</button>
          <button id="annotation-at-selection" type="button" class="quiet-button">${e(Pe,"Use selected position")}</button>
        </div>
        <label class="field" for="annotation-at">Position in whole notes<input id="annotation-at" name="annotation-at" type="text" value="0" placeholder="0, 1/4, 1/2…" aria-describedby="annotation-position-help">
        </label>
      </div>
      <div id="annotation-tempo-fields" class="field-grid tempo-fields" hidden="">
        <label class="field" for="annotation-bpm">Tempo BPM<input id="annotation-bpm" name="annotation-bpm" type="number" min="1" max="1000" step="1" placeholder="Optional">
        </label>
        <label class="field" for="annotation-beat">Tempo beat<select id="annotation-beat" name="annotation-beat" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            ${t({value:"breve",label:"Breve",icon:$})}
            ${t({value:"whole",label:"Whole",icon:k})}
            ${t({value:"half",label:"Half",icon:x})}
            ${t({value:"quarter",label:"Quarter",icon:c,selected:!0})}
            ${t({value:"eighth",label:"Eighth",icon:S})}
            ${t({value:"sixteenth",label:"Sixteenth",icon:C})}
            ${t({value:"thirty-second",label:"32nd",icon:q})}
            ${t({value:"sixty-fourth",label:"64th",icon:A})}
            ${t({value:"128th",label:"128th",icon:R})}
            ${y("quarter")}
          </select>
        </label>
        <label class="field" for="annotation-dots">Tempo beat dots<select id="annotation-dots" name="annotation-dots" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="0">None</option>
            <option value="1">1 dot</option>
            <option value="2">2 dots</option>
            <option value="3">3 dots</option>
          </select>
        </label>
      </div>
      <p id="annotation-position-help" class="field-help">0 is the start of the bar; 1/2 is beat 3 in 4/4. Position is musical time, never a pixel offset.</p>
      <details class="sub-disclosure"><summary>Who sees this instruction?</summary>
        <div class="sub-disclosure-content">
          <label class="field" for="annotation-scope">Include in<select id="annotation-scope" name="annotation-scope" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="staff">This staff only</option>
              <option value="all">Score and all relevant parts</option>
              <option value="parts">Chosen parts</option>
            </select>
          </label>
          <div id="annotation-part-scopes" class="check-row"></div>
        </div>
      </details>
      <div class="button-row panel-actions annotation-actions">
        <button id="add-annotation" type="button" class="primary-button">${e(h,"Add instruction")}</button>
        <button id="add-annotation-next" type="button">${e(d,"Add & next bar")}</button>
        <button id="update-annotation" type="button" hidden="">${e(r,"Apply changes")}</button>
        <button id="update-annotation-next" type="button" hidden="">${e(d,"Apply & next bar")}</button>
        <button id="new-annotation" type="button" class="quiet-button" hidden="">${e(h,o`<span id="new-annotation-label" data-control-label>New instruction</span>`)}</button>
        <button id="remove-annotation" type="button" class="danger-button" hidden="">${e(T,"Remove instruction")}</button>
      </div>
    </section>
  `}function Nt(){return o`
    <section id="measure-inspector" class="tool-panel" role="tabpanel" aria-labelledby="tool-tab-measure" tabindex="0" hidden>
      <div class="panel-heading">
        <h2>Measure</h2>
        <p>Changes apply here. Following measures keep their context; meter and pickup changes align across staves.</p>
      </div>
      <div class="draft-notice">
        <p id="measure-draft-status" class="draft-status" role="status" aria-live="polite"></p>
        <div class="draft-actions">
          <button id="discard-measure-draft" type="button" class="quiet-button" hidden="">${e(b,o`<span id="discard-measure-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
          <button id="return-measure-draft" type="button" class="quiet-button" hidden="">${e(p,o`<span id="return-measure-draft-label" data-control-label>Return to target</span>`)}</button>
          <button id="review-measure-draft" type="button" class="quiet-button" hidden="">${e(v,"Review current changes")}</button>
        </div>
      </div>
      <div class="field-grid">
        <label class="field" for="measure-meter">Meter<input id="measure-meter" name="measure-meter" type="text" value="4/4" placeholder="7/8 or 2+2+3/8">
        </label>
        <label class="field" for="measure-groups">Beat groups<input id="measure-groups" name="measure-groups" type="text" placeholder="Automatic, or 2+2+3">
        </label>
        <label class="field" for="measure-key">Key signature<input id="measure-key" name="measure-key" type="text" value="C" placeholder="C, Bb, F#m">
        </label>
        <label class="field" for="measure-clef">Clef<select id="measure-clef" name="measure-clef" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            ${t({value:"treble",label:"Treble",icon:se})}
            ${t({value:"bass",label:"Bass",icon:Ne})}
            ${t({value:"alto",label:"Alto",icon:O})}
            ${t({value:"tenor",label:"Tenor",icon:O})}
          </select>
        </label>
        <label class="field" for="measure-end-bar">Ending barline<select id="measure-end-bar" name="measure-end-bar" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="single">Single</option>
            <option value="double">Double</option>
            <option value="final">Final</option>
            <option value="repeat-end">Repeat end</option>
            <option value="none">None</option>
          </select>
        </label>
      </div>
      <div class="check-row">
        <label class="check-field" for="measure-pickup">
          <input id="measure-pickup" name="measure-pickup" type="checkbox"> Pickup</label>
        <label class="check-field" for="measure-incomplete">
          <input id="measure-incomplete" name="measure-incomplete" type="checkbox"> Incomplete draft</label>
        <label class="check-field" for="measure-repeat-start">
          <input id="measure-repeat-start" name="measure-repeat-start" type="checkbox"> Start repeat</label>
      </div>
      <div class="button-row">
        <button id="apply-measure" type="button" class="primary-button">${e(r,"Apply measure settings")}</button>
        <button id="add-voice" type="button">${e(h,"Add voice")}</button>
      </div>
      <div class="subsection">
        <p id="short-ending-help" class="field-help">A deliberate short ending must be reviewed before publishing; marking a draft does not approve it.</p>
        <p id="short-ending-empty-help" class="field-help" hidden>This measure has unwritten voices. Write each empty voice or use Fill remainder with rests below before approving a short ending.</p>
        <div class="button-row">
          <button id="review-short-measure" type="button" aria-describedby="measure-draft-status short-ending-help">${e(qe,"Approve intentional short ending",{layout:"inline"})}</button>
          <button id="clear-short-review" type="button" class="quiet-button">${e(Ae,"Clear approval")}</button>
        </div>
      </div>
      <div class="subsection button-row">
        <button id="move-measure-earlier" type="button">${e(ne,"Move measure earlier")}</button>
        <button id="move-measure-later" type="button">${e(d,"Move measure later")}</button>
        <button id="remove-measure" type="button" class="danger-button">${e(T,"Remove measure")}</button>
      </div>
      <section class="subsection" aria-labelledby="duplicate-bars-heading">
        <h3 id="duplicate-bars-heading">Duplicate a section</h3>
        <div class="field-grid two-fields">
          <label class="field" for="duplicate-from-measure">From bar<select id="duplicate-from-measure" name="duplicate-from-measure" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Selected bar</option>
            </select>
          </label>
          <label class="field" for="duplicate-through-measure">Through bar<select id="duplicate-through-measure" name="duplicate-through-measure" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Selected bar</option>
            </select>
          </label>
        </div>
        <p class="field-help">Copies the aligned bars across the score, including hidden staves.</p>
        <button id="duplicate-measures" type="button">${e(at,"Duplicate selected measures")}</button>
      </section>
      <section class="subsection" aria-labelledby="measure-rests-heading">
        <h3 id="measure-rests-heading">Complete this voice</h3>
        <p class="field-help">Add explicit rests only after reviewing the current voice’s remaining time.</p>
        <button id="fill-rests" type="button">${e(le,"Fill remainder with rests")}</button>
      </section>
    </section>
  `}function Et(){return o`
    <aside slot="tools" id="workspace-tools" class="workspace-tools nonprinting" data-tools-view="properties" data-tools-presentation="closed" aria-labelledby="workspace-tools-heading" hidden>
      <div class="tools-header">
        <h2 id="workspace-tools-heading" class="visually-hidden">Writing tools</h2>
        <h2 id="properties-heading">Properties</h2>
        <button id="other-tools" type="button" class="quiet-button">${e(M,"Other tools")}</button>
        <button id="back-to-properties" type="button" class="quiet-button" hidden>${e(ne,"Back to properties")}</button>
        <button id="tools-hide" type="button" class="quiet-button" aria-label="Hide writing tools">${e(l,"Hide")}</button>
      </div>
      <div id="tools-tablist" class="tools-tablist" role="tablist" aria-label="Other writing tools" hidden>
        <button id="tool-tab-rhythm" type="button" role="tab" aria-controls="passage-inspector" aria-selected="true" tabindex="0">${e(ie,"Relationships")}</button>
        <button id="tool-tab-markings" type="button" role="tab" aria-controls="annotation-inspector" aria-selected="false" tabindex="-1">${e(Re,"Instructions")}</button>
        <button id="tool-tab-measure" type="button" role="tab" aria-controls="measure-inspector" aria-selected="false" tabindex="-1">${e(nt,"Measure")}</button>
      </div>
      ${At()}
      ${Tt()}
      ${Pt()}
      ${Nt()}
      <div class="tools-footer">
        <button id="tools-expand" type="button" class="quiet-button" aria-pressed="false">${e(Ce,o`<span data-tools-expand-label>Expand task</span>`)}</button>
      </div>
    </aside>
  `}function Dt(){return o`
    <section slot="palette" id="workspace-dock" class="workspace-dock nonprinting" aria-label="Music palette">
      <div id="palette-musical-slots" class="palette-musical-slots">
        <div id="entry-toolbar" class="entry-toolbar" aria-label="New notes">
          <section id="write-tools" class="entry-tools" aria-label="New-note recipe">
            <div class="entry-quick-tools" data-toggle-group-row aria-label="Quick choices for new notes">
              <music-toggle-button-group id="entry-kind" label="Note or rest" .options=${[{value:"note",label:"Note",icon:c},{value:"rest",label:"Rest",icon:le}]} .buttonIds=${{note:"entry-choose-note",rest:"entry-choose-rest"}} value="note" overflow-at="2"></music-toggle-button-group>
              <music-toggle-button-group id="entry-accidentals" label="Accidentals" .options=${it} value="0" overflow-at="3" aria-describedby="event-alteration-status"></music-toggle-button-group>
              <music-toggle-button-group id="entry-duration" label="Duration" .options=${st} value="quarter" overflow-at="4"></music-toggle-button-group>
              <music-toggle-button-group id="entry-dots" label="Dots" .options=${lt} value="0" overflow-at="1" toggle-off-value="0"></music-toggle-button-group>
              <music-toggle-button-group id="entry-attack" label="Attack" .options=${rt} value="none" overflow-at="2" toggle-off-value="none" aria-describedby="entry-attack-status"></music-toggle-button-group>
            </div>
            <p id="entry-attack-status" class="visually-hidden" role="status" aria-live="polite"></p>
            <div id="entry-slot-options" class="palette-slot">
              <button id="entry-settings-trigger" type="button" class="entry-settings-trigger palette-action" popovertarget="entry-settings" aria-label="New note options" aria-describedby="entry-options-help entry-destination">${e(c,o`<span id="entry-settings-label" class="control-caption">Note</span><span id="entry-recipe">C4</span>`,{layout:"inline"})}</button>
              <button id="entry-direction-trigger" type="button" class="palette-action" popovertarget="entry-direction-chooser" aria-label="Direction for the next 3 roads note" aria-describedby="direction-help" hidden>${e(d,o`<span data-control-label>Same (middle)</span>`)}</button>
            </div>
            <div id="entry-slot-value" class="palette-slot">
              <button id="entry-value-trigger" type="button" class="palette-action entry-value-trigger" popovertarget="entry-value-chooser" aria-label="Written value for new notes">${e(c,o`<span id="entry-value-label">Quarter</span><span id="entry-value-dots" class="control-caption">No dots</span>`,{layout:"inline"})}</button>
              <button id="cancel-entry-drag" type="button" class="quiet-button palette-action" aria-label="Cancel prepared note drag" hidden>${e(r,"Done")}</button>
            </div>
            <div id="entry-slot-action" class="palette-slot">
              <button id="insert-event" type="button" class="quiet-button palette-action" aria-describedby="entry-destination">${e(h,o`<span id="insert-event-label">Insert here</span><span id="insert-event-destination" class="control-caption" hidden></span>`,{layout:"inline"})}</button>
              <button id="drag-entry" type="button" hidden class="gesture-handle entry-drag-handle palette-action" aria-label="Drag the configured note to the staff" aria-describedby="pointer-help pitch-help position-help" title="Drag the next note to the staff">${e(Ee,o`<span data-control-label>Drag note</span><span id="drag-entry-value" class="visually-hidden">C4 quarter note</span>`)}</button>
            </div>
          </section>
        </div>
        <div id="pointer-tools" class="pointer-tools" data-selection-state="none" aria-label="Selected music">
          <div id="selection-controls-dock" class="selection-controls-dock">
            <div id="selection-controls" class="selection-controls" role="toolbar" aria-label="Selected music" aria-describedby="selection-controls-context" data-selection-placement="dock" data-selection-state="none" data-has-error="false">
              <div id="selection-quick-tools" class="selection-quick-tools" data-toggle-group-row aria-label="Quick choices for selected notes">
                <music-toggle-button-group id="selection-kind" label="Note or rest" overflow-at="2"></music-toggle-button-group>
                <music-toggle-button-group id="selection-accidentals" label="Accidentals" .buttonIds=${{"-1":"selection-flat",0:"selection-natural",1:"selection-sharp"}} overflow-at="3"></music-toggle-button-group>
                <music-toggle-button-group id="selection-quick-duration" label="Duration" overflow-at="4"></music-toggle-button-group>
                <music-toggle-button-group id="selection-quick-dots" label="Dots" overflow-at="1" toggle-off-value="0"></music-toggle-button-group>
                <music-toggle-button-group id="selection-quick-attack" label="Attack" overflow-at="2" aria-describedby="selection-attack-help"></music-toggle-button-group>
              </div>
              <p id="selection-attack-help" class="visually-hidden">Toggle each articulation or ornament independently. A mixed choice applies it to all selected events; None clears attacks and ornaments.</p>
              <div id="selection-actions" class="selection-actions">
                <div id="selection-slot-1" class="palette-slot selection-pitch-slot">
                  <button id="selection-pitch" type="button" class="selection-action selection-pitch-action" popovertarget="selection-pitch-chooser" hidden>${e(se,o`<span data-control-label>Pitch</span>`)}</button>
                  <button id="selection-shared" type="button" class="selection-action" popovertarget="selection-shared-chooser" hidden>${e(M,o`<span data-control-label>Shared properties</span>`)}</button>
                  <button id="selection-mark-edit" type="button" class="selection-action" hidden>${e(N,o`<span data-control-label>Edit mark</span>`)}</button>
                  <div class="selection-direct-choices">
                    <div id="selection-road-directions" class="selection-shortcuts" role="radiogroup" aria-label="Relative pitch direction" hidden>
                      <button id="selection-higher" type="button" role="radio" aria-checked="false" tabindex="-1">${e(I,"Higher")}</button>
                      <button id="selection-same" type="button" role="radio" aria-checked="false" tabindex="-1">${e(d,"Same")}</button>
                      <button id="selection-lower" type="button" role="radio" aria-checked="false" tabindex="-1">${e(F,"Lower")}</button>
                    </div>
                  </div>
                </div>
                <div id="selection-slot-2" class="palette-slot">
                  <button id="selection-value" type="button" class="selection-action" popovertarget="selection-value-chooser" disabled>${e(c,o`<span data-control-label>Value</span>`)}</button>
                </div>
                <div id="selection-slot-3" class="palette-slot">
                  <button id="selection-attached-marks" type="button" class="selection-action" aria-label="Attached marks for selected event" disabled>${e(z,"Marks")}</button>
                  <button id="selection-relationships" type="button" class="selection-action" aria-label="Relationships for the selected events" hidden>${e(ie,o`<span data-control-label>Relate</span>`)}</button>
                  <button id="selection-mark-remove" type="button" class="selection-action danger-button" hidden>${e(T,"Remove mark")}</button>
                  <button id="drag-pitch" type="button" class="gesture-handle footer-drag-handle" aria-label="Drag selected pitch" aria-describedby="drag-pitch-help pointer-help" title="Drag vertically to change the selected pitch" disabled hidden>${e(ct,"Drag pitch")}</button>
                </div>
                <div id="selection-collection" class="palette-slot selection-collection" role="group" aria-label="Build a selection">
                  <button id="selection-select-more" type="button" aria-describedby="selection-context">${e(ve,"Select more")}</button>
                  <button id="selection-range" type="button" class="selection-action" hidden>${e(ve,"Range…")}</button>
                  <button id="selection-done" type="button" class="selection-done" hidden>${e(r,"Done")}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div id="workspace-mode-slot" class="workspace-mode-slot" role="group" aria-label="Editing mode">
        <button id="toggle-entry" type="button" aria-pressed="false" aria-describedby="entry-destination">${e(dt,o`<span id="entry-mode-label">Write notes</span>`)}</button>
        <button id="select-mode" type="button" aria-pressed="true">${e(Pe,"Select")}</button>
      </div>
      <div id="palette-more-slot" class="palette-more-slot">
        <button id="edit-selected-event" class="selection-action selection-more" type="button" aria-controls="workspace-tools" aria-expanded="false" aria-describedby="edit-selected-help">${e(me,o`<span id="edit-selected-label">More</span><span id="edit-selected-value" hidden></span>`)}</button>
        <button id="tools-toggle" type="button" class="tools-toggle" aria-controls="workspace-tools" aria-expanded="false">${e(me,o`<span data-tools-toggle-label>More</span>`)}</button>
      </div>
      <button id="location-trigger" type="button" class="location-trigger" popovertarget="location-panel" aria-label="Location and musical actions" aria-describedby="selection-controls-context entry-destination">${e(ut,o`<span id="palette-owner-label" class="control-caption">Selected</span><span id="selection-context" class="visually-hidden">Choose a musical location</span><span id="selection-controls-context" class="visually-hidden">Choose music on the staff.</span><span class="location-compact" aria-hidden="true"><span id="selection-compact-staff" class="visually-hidden">Staff</span><span id="selection-compact-context">Bar 1 · V1</span></span>`,{layout:"inline"})}</button>
      <span id="drag-pitch-help" class="visually-hidden">Prepare an untied single note for dragging in Properties.</span>
      <p id="pointer-help" class="visually-hidden">In Write notes, click to place a single pitched note or an ordinary rest. Rest placement works on pitched, rhythm, and 3 roads staves; height never gives a rest a pitch. Full-measure rests use Insert here or Enter. Prepare a note or rest drag in the options before using its handle. Selection controls change existing music; pitch drags keep the rhythm. Escape cancels an active gesture.</p>
      <p id="edit-selected-help" class="visually-hidden">Show or hide Properties for the selected music. With the score focused in Select, Enter opens Properties.</p>
    </section>
  `}const ue=class ue extends m{constructor(){super(...arguments),this.view={documentId:"",status:"",readOnly:!0},this.changeSource=()=>{if(this.view.readOnly)return;const a=this.input.value;this.feedback.refresh(this.view.documentId,a),this.dispatchEvent(new CustomEvent("source-change",{detail:{value:a},bubbles:!0,composed:!0}))},this.applySource=()=>{this.view.readOnly||this.dispatchEvent(new CustomEvent("source-apply",{detail:{value:this.input.value},bubbles:!0,composed:!0}))},this.revertSource=()=>{this.view.readOnly||this.dispatchEvent(new CustomEvent("source-revert",{bubbles:!0,composed:!0}))}}mount(){this.performUpdate()}renderState(a,n={}){const u=a.status!==this.view.status||a.readOnly!==this.view.readOnly;this.view={documentId:a.documentId,status:a.status,readOnly:a.readOnly},u&&this.requestUpdate(),this.mount();const s=this.isConnected&&pt(this)===this.input;(n.forceValue||!s)&&this.input.value!==a.value&&(this.input.value=a.value),this.feedback.refresh(a.documentId,this.input.value)}get inputValue(){return this.mount(),this.input.value}get failureMessage(){return this.feedback?.message??""}focusInput(){this.mount(),this.input.focus({preventScroll:!0})}fail(a,n,u){this.mount(),this.feedback.fail(a,n,u)}clearFailure(){this.mount(),this.feedback.clear()}refreshFailure(a,n){this.mount(),this.feedback.refresh(a,n)}firstUpdated(){this.input=this.renderRoot.querySelector("#source-input"),this.feedback=new bt(this.renderRoot)}render(){return o`
      <p class="field-help source-description" part="description">Source is staged until Apply. Invalid drafts stay available without replacing accepted music.</p>
      <label class="visually-hidden" for="source-input">Musical HTML source</label>
      <textarea id="source-input" name="source-input" part="input" rows="15" spellcheck="false"
        autocapitalize="off" autocomplete="off" aria-describedby="source-status source-error"
        .readOnly=${this.view.readOnly} @input=${this.changeSource}></textarea>
      <p id="source-error" class="source-error" part="error" role="alert" tabindex="-1" hidden></p>
      <p id="source-status" class="field-help" part="status" role="status">${this.view.status}</p>
      <div class="button-row source-actions" part="actions">
        <button id="source-apply" class="primary-button" part="apply" type="button" .disabled=${this.view.readOnly} @click=${this.applySource}>${e(r,"Apply source")}</button>
        <button id="source-revert" part="revert" type="button" .disabled=${this.view.readOnly} @click=${this.revertSource}>${e(b,"Revert to accepted score")}</button>
      </div>
    `}};ue.styles=w`
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 9px;
      min-width: 0;
      min-height: 0;
      color: var(--ink, var(--author-control-ink, #303942));
      font: inherit;
    }
    :host([hidden]), [hidden] { display: none !important; }
    *, *::before, *::after { box-sizing: border-box; }
    p { margin: 0; }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
    .field-help {
      color: var(--muted, var(--author-muted, #56616d));
      font-size: 0.73rem;
      font-weight: 400;
      line-height: 1.45;
    }
    textarea {
      flex: 1;
      width: 100%;
      min-width: 0;
      min-height: 150px;
      max-width: 100%;
      margin: 0;
      padding: 11px;
      border: 1px solid var(--author-divider, #c8cfd6);
      border-radius: 7px;
      background: var(--author-surface, #f7f8fa);
      color: var(--author-control-ink, #303942);
      font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace;
      font-size: 0.82rem;
      line-height: 1.5;
      tab-size: 2;
      white-space: pre;
      overflow-wrap: normal;
      overflow-x: auto;
      resize: none;
    }
    #source-error {
      flex: none;
      min-width: 0;
      max-height: none;
      overflow: visible;
      padding: 8px 10px;
      border-inline-start: 2px solid var(--author-warning, #a86a4b);
      background: var(--author-warning-surface, #fff2df);
      color: var(--error, #7d3027);
      font-size: 0.77rem;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    #source-status { font-size: 0.71rem; }
    .source-actions { display: flex; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; }
    button {
      min-width: 44px;
      min-height: var(--author-control-size, 44px);
      max-width: 100%;
      padding: 8px 13px;
      border: 1px solid var(--author-border, #798794);
      border-radius: 6px;
      background: var(--surface, var(--author-surface, #f7f8fa));
      color: var(--ink, var(--author-control-ink, #303942));
      font: inherit;
      font-size: 0.84rem;
      font-weight: 550;
      line-height: 1.35;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--accent-soft, #dce3ea); }
    button:disabled { color: var(--author-muted, #56616d); cursor: not-allowed; background: var(--author-surface, #f7f8fa); }
    .primary-button { border-color: var(--accent, #325a3d); background: var(--accent, #325a3d); color: #fff; }
    .primary-button:hover:not(:disabled) { border-color: var(--accent-hover, #24462d); background: var(--accent-hover, #24462d); }
    .primary-button:disabled { border-color: var(--author-divider, #aab4a7); background: var(--author-divider, #aab4a7); color: #fff; }
    button:focus-visible, textarea:focus-visible, [tabindex]:focus-visible {
      outline: 3px solid var(--focus, var(--author-focus, #7037a0));
      outline-offset: 3px;
    }
    @media (max-width: 760px) { textarea { font-size: 0.84rem; } }
    @media (max-height: 480px) {
      :host { gap: 8px; }
      textarea { min-height: 90px; }
      .source-description { display: none; }
    }
    @media (forced-colors: active) {
      textarea, button { border-color: ButtonText; background: Canvas; color: CanvasText; }
      #source-error { border-color: CanvasText; background: Canvas; color: CanvasText; }
      button:disabled, .primary-button:disabled { border-color: GrayText; background: Canvas; color: GrayText; }
      .primary-button { border-color: Highlight; background: Canvas; color: ButtonText; }
      button:focus-visible, textarea:focus-visible, [tabindex]:focus-visible { outline-color: Highlight; }
    }
    @media print { :host { display: none !important; } }
  `;let oe=ue;customElements.get("music-source-editor")||customElements.define("music-source-editor",oe);function Mt(){return o`
    <section id="document-menu" class="document-menu surface-popover nonprinting" popover="auto" aria-labelledby="document-menu-heading">
      <div class="document-menu-heading">
        <h2 id="document-menu-heading">Document</h2>
        <button id="close-document-menu" class="document-menu-close quiet-button" type="button" popovertarget="document-menu" popovertargetaction="hide">${e(l,"Close",{layout:"inline"})}</button>
      </div>
      <div class="document-menu-content popover-body">
        <label class="field" for="project-title">Composition title<input id="project-title" name="project-title" type="text" value="" maxlength="240" placeholder="Untitled composition" autocomplete="off" />
        </label>
        <label class="field" for="project-composer">Composer<input id="project-composer" name="project-composer" type="text" value="" maxlength="160" placeholder="Composer" autocomplete="off" />
        </label>
        <label class="field" for="project-subtitle">Subtitle<input id="project-subtitle" name="project-subtitle" type="text" maxlength="240" placeholder="Optional performance note">
        </label>
        <button id="score-setup-trigger" type="button" popovertarget="score-setup">${e(M,"Score setup…",{layout:"inline"})}</button>
        <div class="menu-divider"></div>
        <label class="field" for="new-template">Start with
          <select id="new-template" name="new-template" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="blank">Single staff</option>
            <option value="rhythm">Single-line rhythm staff</option>
            <option value="three-roads">3 roads music</option>
            <option value="lead">Lead sheet study</option>
            <option value="piano">Piano</option>
            <option value="ensemble">Ensemble</option>
          </select>
        </label>
        <button id="new-project" type="button">${e(ht,"New composition",{layout:"inline"})}</button>
        <button id="open-project" type="button">${e(vt,"Open project or musical HTML…",{layout:"inline"})}</button>
        <input id="project-file" type="file" accept=".json,.html,.htm,application/json,text/html" hidden="">
        <button id="download-project" type="button">${e(De,"Download project",{layout:"inline"})}</button>
        <button id="export-html" type="button">${e(ae,"Export musical HTML",{layout:"inline"})}</button>
        <p class="field-help">Local recovery stays on this device. Download a project for a portable copy.</p>
        <details class="install-help">
          <summary>Install Music Notes</summary>
          <p class="field-help">On iPad or iPhone, open this page in Safari, choose Share → Add to Home Screen, leave Open as Web App on if shown, then tap Add. Launch Music Notes from that icon for a workspace without browser tabs or an address bar.</p>
          <p class="field-help">On other devices, use your browser’s Install app command if available. To move existing work from Safari, Download project here, then use Open project in the installed app.</p>
          <p class="field-help">Open the installed app online once and wait for offline setup below. Then you can reopen, compose, listen, and export without a connection. Keep downloaded project backups; the system can clear website storage.</p>
          <music-offline-status class="field-help"></music-offline-status>
        </details>
      </div>
    </section>
  `}function It(){return o`
    <section id="score-setup" class="surface-popover score-setup nonprinting" popover="auto" aria-labelledby="score-setup-heading">
      <div class="popover-heading">
        <h2 id="score-setup-heading">Score setup</h2>
        <button id="close-score-setup" type="button" class="quiet-button" popovertarget="score-setup" popovertargetaction="hide">${e(l,"Close",{layout:"inline"})}</button>
      </div>
      <div class="popover-body">
        <section id="staff-inspector" class="setup-section" aria-label="Staves and parts">
          <div class="panel-heading">
            <h2>Staves</h2>
            <p>Keep players together. Parts may include several staves; pitches stay as authored.</p>
          </div>
          <div class="draft-notice">
            <p id="staff-draft-status" class="draft-status" role="status" aria-live="polite"></p>
            <div class="draft-actions">
              <button id="discard-staff-draft" type="button" class="quiet-button" hidden="">${e(b,o`<span id="discard-staff-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
              <button id="return-staff-draft" type="button" class="quiet-button" hidden="">${e(p,o`<span id="return-staff-draft-label" data-control-label>Return to target</span>`)}</button>
              <button id="review-staff-draft" type="button" class="quiet-button" hidden="">${e(J,"Review current changes")}</button>
            </div>
          </div>
          <div class="field-grid">
            <label class="field" for="staff-label">Staff label<input id="staff-label" name="staff-label" type="text" placeholder="Flute, piano upper…">
            </label>
            <label class="field" for="staff-notation">Notation<select id="staff-notation" name="staff-notation" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="pitched">Pitched · five lines</option>
                <option value="rhythm">Rhythm · one line</option>
                <option value="three-roads">3 roads music · three lines</option>
              </select>
            </label>
            <label class="field" for="staff-clef">Initial clef<select id="staff-clef" name="staff-clef" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                ${t({value:"treble",label:"Treble",icon:se})}
                ${t({value:"bass",label:"Bass",icon:Ne})}
                ${t({value:"alto",label:"Alto",icon:O})}
                ${t({value:"tenor",label:"Tenor",icon:O})}
              </select>
            </label>
            <label class="field" for="staff-key">Initial key<input id="staff-key" name="staff-key" type="text" value="C">
            </label>
          </div>
          <p id="staff-notation-help" class="field-help">Rhythm uses one line; 3 roads uses three lines for higher, same, or lower than the previous main pitch. Both omit clef and key. Changing notation does not convert existing events. For pitched ↔ rhythm, use rhythmic slashes to preserve prescribed attacks; remove incompatible attached marks deliberately. 3 roads needs authored directions, not inferred pitches.</p>
          <div class="button-row">
            <button id="apply-staff" type="button">${e(r,"Apply to current staff")}</button>
            <button id="add-staff" type="button">${e(h,"Add new staff")}</button>
          </div>
          <div class="subsection">
            <div class="draft-notice">
              <p id="part-draft-status" class="draft-status" role="status" aria-live="polite"></p>
              <div class="draft-actions">
                <button id="discard-part-draft" type="button" class="quiet-button" hidden="">${e(b,o`<span id="discard-part-draft-label" data-control-label>Discard &amp; reload</span>`)}</button>
                <button id="return-part-draft" type="button" class="quiet-button" hidden="">${e(p,o`<span id="return-part-draft-label" data-control-label>Return to target</span>`)}</button>
                <button id="review-part-draft" type="button" class="quiet-button" hidden="">${e(J,"Review current changes")}</button>
              </div>
            </div>
            <h3>Parts</h3>
            <label class="field" for="part-label">Part name<input id="part-label" name="part-label" type="text" placeholder="Piano, rhythm section…">
            </label>
            <fieldset class="plain-fieldset">
              <legend>Staves in this part</legend>
              <div id="part-staves" class="check-row"></div>
            </fieldset>
            <div class="button-row">
              <button id="add-part" type="button" class="primary-button">${e(h,"Create part")}</button>
              <button id="update-part" type="button">${e(r,"Update selected part")}</button>
              <button id="remove-part" type="button" class="danger-button">${e(T,"Remove part")}</button>
            </div>
          </div>
        </section>
      </div>
    </section>
  `}function Ft(){return o`
    <section id="source-panel" class="surface-popover source-panel nonprinting" popover="auto" aria-labelledby="source-heading">
      <music-panel-frame>
        <div slot="header" class="popover-heading">
          <h2 id="source-heading">Musical HTML</h2>
          <button id="close-source" type="button" class="quiet-button" popovertarget="source-panel" popovertargetaction="hide">${e(l,"Close",{layout:"inline"})}</button>
        </div>
        <div slot="body" class="source-content popover-body">
          <music-source-editor id="source-editor"></music-source-editor>
        </div>
      </music-panel-frame>
    </section>
  `}function Ot(){return o`
    <section id="location-panel" class="surface-popover location-panel nonprinting" popover="auto" aria-labelledby="location-heading">
      <div class="popover-heading">
        <h2 id="location-heading">Location & actions</h2>
        <button id="close-location" type="button" class="quiet-button" popovertarget="location-panel" popovertargetaction="hide">${e(l,"Close",{layout:"inline"})}</button>
      </div>
      <div class="popover-body">
        <p id="location-context" class="target-context">Actions use the selected staff, bar, and voice.</p>
        <p class="field-help" id="entry-mode-reason" hidden>Your previous writing location was removed or changed. Choose Start writing here to use the location shown, or choose another staff, measure, or voice below.</p>
        <span id="entry-destination" class="entry-destination target-context" hidden></span>
        <span id="remaining-time" class="remaining-time" role="status"></span>
        <div class="local-action-grid">
          <button id="next-measure" type="button" >${e(d,"Next measure")}</button>
          <button id="add-measure" type="button" class="quiet-button">${e(h,o`<span id="add-measure-label" data-control-label>Add measure</span>`)}</button>
          <button id="add-chord-symbol" type="button" class="primary-button">${e(Te,"Add chord symbol")}</button>
          <button id="start-entry-here" type="button" >${e(N,"Start writing here")}</button>
          <button id="resume-entry" type="button" class="quiet-button" hidden>${e(N,o`<span id="resume-entry-label" data-control-label>Resume writing</span>`)}</button>
          <button id="selection-review" type="button" class="quiet-button" popovertarget="workspace-review" hidden>${e(J,"Review")}</button>
          <button id="continue-piece" type="button" hidden>${e(d,"Continue this piece…")}</button>
          <button id="return-to-selection" type="button" class="quiet-button" aria-label="Return to selection" hidden>${e(p,"Return to selection")}</button>
          <button id="selection-review-history" type="button" class="quiet-button" popovertarget="workspace-review" hidden>${e(Me,"Review last editing problem")}</button>
        </div>
        <label class="field part-picker" for="part-select">Viewing
          <select id="part-select" name="part-select" class="author-select">
            <button type="button"><selectedcontent></selectedcontent></button>
            <option value="score">Full score</option>
          </select>
          <span class="field-help">Pitched parts keep their authored pitches; 3 roads parts keep their directions.</span>
        </label>
        <div id="selection-toolbar" class="selection-toolbar">
          <div class="cursor-controls">
            <label class="field" for="staff-select">Staff<select id="staff-select" name="staff-select" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="">Choose a staff</option>
              </select>
            </label>
            <label class="field" for="measure-select">Measure<select id="measure-select" name="measure-select" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="">Choose a measure</option>
              </select>
            </label>
            <label class="field" for="event-voice">Voice<select id="event-voice" name="event-voice" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="0">Voice 1</option>
              </select>
            </label>
          </div>
        </div>
        <p class="field-help">Add measure inserts an aligned bar across all staves, including hidden parts.</p>
      </div>
    </section>
  `}function Ut(){return o`
    <section id="entry-settings" class="surface-popover entry-settings nonprinting" popover="auto" aria-labelledby="entry-settings-heading">
      <div class="popover-heading">
        <h2 id="entry-settings-heading">New-note options</h2>
        <button id="close-entry-settings" type="button" class="quiet-button" popovertarget="entry-settings" popovertargetaction="hide">${e(l,"Close")}</button>
      </div>
      <div class="popover-body">
        <p id="entry-options-help" class="field-help">These options belong to new music. Selecting or correcting an event leaves them unchanged.</p>
        <label class="field" for="event-kind">Event type<select id="event-kind" name="event-kind" class="author-select" >
            <button type="button"><selectedcontent></selectedcontent></button>
            ${t({value:"note",label:"Note",icon:c})}
            ${t({value:"chord",label:"Chord",icon:Se})}
            ${t({value:"rhythm",label:"Rhythm note (no pitch)",icon:c})}
            ${t({value:"road",label:"3 roads note",icon:Z})}
            ${t({value:"rest",label:"Rest",icon:le})}
            ${t({value:"rhythmic-slash",label:"Rhythmic slash",icon:Z})}
            ${t({value:"slash",label:"Open slash",icon:Z})}
          </select>
        </label>
        <p id="entry-placement-help" class="field-help">Choose a value, then point at the staff to place a single pitched note or an ordinary rest. Rest placement also works on rhythm and 3 roads staves. Insert here or Enter uses the exact writing destination; a full-measure rest remains an explicit whole-voice choice.</p>
        <label id="direction-field" class="field inline-road-direction" for="event-direction" hidden>Pitch direction<select id="event-direction" name="event-direction" class="author-select" aria-describedby="direction-help">
            <button type="button"><selectedcontent></selectedcontent></button>
            ${t({value:"higher",label:"Higher (top)",icon:I})}
            ${t({value:"same",label:"Same (middle)",icon:d,selected:!0})}
            ${t({value:"lower",label:"Lower (bottom)",icon:F})}
            ${y("same")}
          </select>
        </label>
        <div class="field-grid two-fields">
          <label id="pitch-field" class="field pitch-field" for="event-pitch">Pitch &amp; octave<input id="event-pitch" name="event-pitch" type="text" value="C4" spellcheck="false" autocomplete="off" aria-describedby="pitch-help event-alteration-status">
          </label>
          <label id="pitches-field" class="field pitches-field" for="event-pitches" hidden="">Chord pitches<input id="event-pitches" name="event-pitches" type="text" value="C4 E4 G4" spellcheck="false" autocomplete="off" aria-describedby="pitch-help">
          </label>
          <label id="event-alteration-field" class="field" for="event-alteration">Pitch alteration<select id="event-alteration" name="event-alteration" class="author-select" aria-describedby="pitch-help event-alteration-status">
              <button type="button"><selectedcontent></selectedcontent></button>
              ${t({value:"-2",label:"Double flat · −2 semitones",icon:j})}
              ${t({value:"-1.5",label:"Three-quarter flat · −1.5 semitones",icon:Q})}
              ${t({value:"-1",label:"Flat · −1 semitone",icon:E})}
              ${t({value:"-0.5",label:"Quarter flat · −0.5 semitone",icon:G})}
              ${t({value:"0",label:"Natural · 0 semitones",icon:D,selected:!0})}
              ${t({value:"0.5",label:"Quarter sharp · +0.5 semitone",icon:K})}
              ${t({value:"1",label:"Sharp · +1 semitone",icon:g})}
              ${t({value:"1.5",label:"Three-quarter sharp · +1.5 semitones",icon:V})}
              ${t({value:"2",label:"Double sharp · +2 semitones",icon:Y})}
              ${y("0")}
            </select>
          </label>
          <label class="field" for="insert-position">Position
            <select id="insert-position" name="insert-position" class="author-select" aria-describedby="position-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="after">After target</option>
              <option value="before">Before target</option>
              <option value="replace">Replace target</option>
            </select>
          </label>
        </div>
        <p id="event-alteration-status" class="field-help entry-alteration-status" role="status" aria-live="polite"></p>
        <p id="direction-help" class="field-help" hidden>Choose any starting pitch on Same (middle). Higher, same, and lower then refer to the previous main pitch in this voice, including across rests and barlines. Harmony and ornament notes do not change that reference. Tied continuations use Same (middle).</p>
        <p id="entry-keyboard-help" class="field-help">With the score focused in Write notes, Enter inserts the exact current recipe. A–G writes natural pitches on pitched staves; it does not keep the chosen alteration. Fields and buttons keep their normal keys.</p>
        <p id="pitch-help" class="field-help">Spell pitches explicitly: F4 is natural, F#4 sharp, Fqs4 quarter-sharp, Fqf4 quarter-flat. Use tqf or tqs for three-quarter tones.</p>
        <p id="position-help" class="field-help">On the staff, point to the target. Insert uses your writing destination, which can differ from the selected music.</p>
        <label id="slash-field" class="check-field" for="event-rhythmic" hidden="">
          <input id="event-rhythmic" name="event-rhythmic" type="checkbox"> Write the rhythm with stems</label>
        <label class="check-field" for="event-measure-rest">
          <input id="event-measure-rest" name="event-measure-rest" type="checkbox"> Full-measure rest, rather than a written duration</label>
        <details class="sub-disclosure"><summary>New-event engraving</summary>
          <div class="field-grid two-fields">
            <label class="field" for="event-accidental-display">Show accidental<select id="event-accidental-display" name="event-accidental-display" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">When needed</option>
                <option value="always">Always</option>
                <option value="courtesy">Courtesy (parentheses)</option>
              </select>
              <span class="field-help">Changes the printed sign, not the pitch.</span>
            </label>
            <label class="field" for="event-stem">Stem<select id="event-stem" name="event-stem" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">Automatic</option>
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </label>
            <label class="field" for="event-beam">Beam<select id="event-beam" name="event-beam" class="author-select">
                <button type="button"><selectedcontent></selectedcontent></button>
                <option value="auto">Follow beat groups</option>
                <option value="start">Start beam</option>
                <option value="continue">Continue beam</option>
                <option value="end">End beam</option>
                <option value="none">No beam</option>
              </select>
            </label>
          </div>
        </details>
        <section class="subsection prepared-drag-options" aria-labelledby="entry-drag-heading">
          <h3 id="entry-drag-heading">Another way to place a note</h3>
          <p id="entry-drag-help" class="field-help">Prepare the drag handle, then drag it to a staff. It does not change the written value or infer an alteration. Escape or Done returns to ordinary writing.</p>
          <div class="button-row">
            <button id="prepare-entry-drag" type="button" aria-describedby="entry-drag-help">${e(Ee,o`<span data-control-label>Prepare note drag</span>`)}</button>
          </div>
        </section>
        <div class="subsection">
          <p class="field-help">Inserting notes continues into later bars automatically. Following notes move in order, and new measures are added when needed. One Undo restores the insertion and any moved music.</p>
        </div>
      </div>
    </section>
  `}function Ht(){return o`
    <section id="entry-value-chooser" class="surface-popover selection-chooser entry-value-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="entry-value-heading" aria-describedby="entry-destination">
      <div class="popover-heading">
        <h2 id="entry-value-heading">Value for new notes</h2>
        <button id="close-entry-value" type="button" class="quiet-button" popovertarget="entry-value-chooser" popovertargetaction="hide">${e(l,"Close")}</button>
      </div>
      <div class="popover-body">
        <div class="field-grid two-fields">
          <label class="field" for="event-duration">
            <span id="entry-value-field-label">Written value</span>
            <select id="event-duration" name="event-duration" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              ${t({value:"breve",label:"Breve",icon:$})}
              ${t({value:"whole",label:"Whole",icon:k})}
              ${t({value:"half",label:"Half",icon:x})}
              ${t({value:"quarter",label:"Quarter",icon:c,selected:!0})}
              ${t({value:"eighth",label:"Eighth",icon:S})}
              ${t({value:"sixteenth",label:"Sixteenth",icon:C})}
              ${t({value:"thirty-second",label:"32nd",icon:q})}
              ${t({value:"sixty-fourth",label:"64th",icon:A})}
              ${t({value:"128th",label:"128th",icon:R})}
              ${y("quarter")}
            </select>
          </label>
          <label class="field dots-field" for="event-dots">Dots
            <select id="event-dots" name="event-dots" class="author-select">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="0">None</option>
              <option value="1">1 dot</option>
              <option value="2">2 dots</option>
              <option value="3">3 dots</option>
            </select>
          </label>
        </div>
        <p id="entry-value-help" class="field-help">These choices affect the next event, not selected music. Full-measure rests follow the meter; an open slash uses a nominal span without prescribing attacks.</p>
      </div>
    </section>
  `}function Lt(){return o`
    <section id="entry-direction-chooser" class="surface-popover selection-chooser entry-direction-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="entry-direction-heading" aria-describedby="direction-help entry-destination">
      <div class="popover-heading">
        <h2 id="entry-direction-heading">Direction for the next note</h2>
        <button id="close-entry-direction" type="button" class="quiet-button" popovertarget="entry-direction-chooser" popovertargetaction="hide">${e(l,"Close")}</button>
      </div>
      <div class="popover-body">
        <div class="entry-direction-choices" role="group" aria-label="Choose a relative pitch direction">
          <button id="entry-direction-higher" type="button" aria-pressed="false" data-direction="higher">${e(I,"Higher (top)")}</button>
          <button id="entry-direction-same" type="button" aria-pressed="true" data-direction="same">${e(d,"Same (middle)")}</button>
          <button id="entry-direction-lower" type="button" aria-pressed="false" data-direction="lower">${e(F,"Lower (bottom)")}</button>
        </div>
        <p class="field-help">Relative to the previous main pitch in this voice, including across rests and barlines. A tied continuation stays Same.</p>
        <button id="entry-direction-options" type="button" class="quiet-button" popovertarget="entry-settings">${e(M,"Other note options…")}</button>
      </div>
    </section>
  `}function Wt(){return o`
    <section id="selection-value-chooser" class="surface-popover selection-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="selection-value-heading" aria-describedby="selection-controls-context">
      <div class="popover-heading">
        <h2 id="selection-value-heading">Written value</h2>
        <button id="close-selection-value" type="button" class="quiet-button" popovertarget="selection-value-chooser" popovertargetaction="hide">${e(l,"Close")}</button>
      </div>
      <div class="popover-body">
        <div class="field-grid two-fields">
          <label class="field" for="selection-duration">Note value<select id="selection-duration" name="selection-duration" class="author-select" aria-describedby="selection-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              ${t({value:"breve",label:"Breve",icon:$})}
              ${t({value:"whole",label:"Whole",icon:k})}
              ${t({value:"half",label:"Half",icon:x})}
              ${t({value:"quarter",label:"Quarter",icon:c})}
              ${t({value:"eighth",label:"Eighth",icon:S})}
              ${t({value:"sixteenth",label:"Sixteenth",icon:C})}
              ${t({value:"thirty-second",label:"32nd",icon:q})}
              ${t({value:"sixty-fourth",label:"64th",icon:A})}
              ${t({value:"128th",label:"128th",icon:R})}
            </select>
          </label>
          <label class="field" for="selection-dots">Dots<select id="selection-dots" name="selection-dots" class="author-select" aria-describedby="selection-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              <option value="0">None</option>
              <option value="1">1 dot</option>
              <option value="2">2 dots</option>
              <option value="3">3 dots</option>
            </select>
          </label>
        </div>
        <p id="selection-rhythm-help" class="field-help">Written values and augmentation dots retain their separate meanings. Changing one preserves the other and the next-entry recipe.</p>
        <p id="selection-value-error" class="selection-chooser-error" role="alert" tabindex="-1" hidden></p>
        <p class="field-help">Changes apply immediately. Undo restores each accepted change.</p>
      </div>
    </section>
  `}function Bt(){return o`
    <section id="selection-pitch-chooser" class="surface-popover selection-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="selection-pitch-heading" aria-describedby="selection-controls-context">
      <div class="popover-heading">
        <h2 id="selection-pitch-heading">Pitch &amp; direction</h2>
        <button id="close-selection-pitch" type="button" class="quiet-button" popovertarget="selection-pitch-chooser" popovertargetaction="hide">${e(l,"Close")}</button>
      </div>
      <div class="popover-body">
        <div class="field-grid two-fields selection-pitch-components">
          <label id="selection-note-step-field" class="field" for="selection-note-step" hidden>Pitch letter<select id="selection-note-step" name="selection-note-step" class="author-select" aria-describedby="selection-pitch-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="C">C</option>
              <option value="D">D</option>
              <option value="E">E</option>
              <option value="F">F</option>
              <option value="G">G</option>
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
          </label>
          <label id="selection-note-octave-field" class="field" for="selection-note-octave" hidden>Octave<select id="selection-note-octave" name="selection-note-octave" class="author-select" aria-describedby="selection-pitch-help" .value=${"4"}>
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="-1">-1</option>
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4" selected>4</option>
              <option value="5">5</option>
              <option value="6">6</option>
              <option value="7">7</option>
              <option value="8">8</option>
              <option value="9">9</option>
            </select>
          </label>
        </div>
        <div id="selection-chooser-accidentals" role="group" aria-label="Set absolute accidental" aria-describedby="selection-pitch-help" hidden>
          <button id="selection-chooser-flat" type="button" aria-pressed="false">${e(E,"Flat")}</button>
          <button id="selection-chooser-natural" type="button" aria-pressed="false">${e(D,"Natural")}</button>
          <button id="selection-chooser-sharp" type="button" aria-pressed="false">${e(g,"Sharp")}</button>
        </div>
        <div class="field-grid">
          <label id="selection-alteration-field" class="field" for="selection-alteration">Absolute alteration<select id="selection-alteration" name="selection-alteration" class="author-select" aria-describedby="selection-pitch-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              ${t({value:"-2",label:"Double flat · −2 semitones",icon:j})}
              ${t({value:"-1.5",label:"Three-quarter flat · −1.5 semitones",icon:Q})}
              ${t({value:"-1",label:"Flat · −1 semitone",icon:E})}
              ${t({value:"-0.5",label:"Quarter flat · −0.5 semitone",icon:G})}
              ${t({value:"0",label:"Natural · 0 semitones",icon:D})}
              ${t({value:"0.5",label:"Quarter sharp · +0.5 semitone",icon:K})}
              ${t({value:"1",label:"Sharp · +1 semitone",icon:g})}
              ${t({value:"1.5",label:"Three-quarter sharp · +1.5 semitones",icon:V})}
              ${t({value:"2",label:"Double sharp · +2 semitones",icon:Y})}
            </select>
          </label>
          <label id="selection-direction-field" class="field" for="selection-direction">Relative pitch direction<select id="selection-direction" name="selection-direction" class="author-select" aria-describedby="selection-pitch-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              ${t({value:"higher",label:"Higher (top)",icon:I})}
              ${t({value:"same",label:"Same (middle)",icon:d})}
              ${t({value:"lower",label:"Lower (bottom)",icon:F})}
            </select>
          </label>
        </div>
        <p id="selection-pitch-help" class="field-help">Alterations are relative to the natural letter, not increments. Road directions refer to this voice’s previous main pitch.</p>
        <p id="selection-pitch-error" class="selection-chooser-error" role="alert" tabindex="-1" hidden></p>
        <p class="field-help">Changes apply immediately. Undo restores each accepted change.</p>
      </div>
    </section>
  `}function zt(){return o`
    <section id="selection-shared-chooser" class="surface-popover selection-chooser nonprinting" popover="auto" role="dialog" aria-labelledby="selection-shared-heading" aria-describedby="selection-controls-context">
      <div class="popover-heading">
        <h2 id="selection-shared-heading">Shared properties</h2>
        <button id="close-selection-shared" type="button" class="quiet-button" popovertarget="selection-shared-chooser" popovertargetaction="hide">${e(l,"Close")}</button>
      </div>
      <div class="popover-body">
        <div class="field-grid two-fields">
          <label class="field" for="selection-shared-duration">Note value<select id="selection-shared-duration" name="selection-shared-duration" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              ${t({value:"breve",label:"Breve",icon:$})}
              ${t({value:"whole",label:"Whole",icon:k})}
              ${t({value:"half",label:"Half",icon:x})}
              ${t({value:"quarter",label:"Quarter",icon:c})}
              ${t({value:"eighth",label:"Eighth",icon:S})}
              ${t({value:"sixteenth",label:"Sixteenth",icon:C})}
              ${t({value:"thirty-second",label:"32nd",icon:q})}
              ${t({value:"sixty-fourth",label:"64th",icon:A})}
              ${t({value:"128th",label:"128th",icon:R})}
            </select>
          </label>
          <label class="field" for="selection-shared-dots">Dots<select id="selection-shared-dots" name="selection-shared-dots" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              <option value="0">None</option>
              <option value="1">1 dot</option>
              <option value="2">2 dots</option>
              <option value="3">3 dots</option>
            </select>
          </label>
          <label class="field" for="selection-stem">Stem policy<select id="selection-stem" name="selection-stem" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              <option value="auto">Automatic</option>
              <option value="up">Up</option>
              <option value="down">Down</option>
            </select>
          </label>
          <label class="field" for="selection-accidental-display">Show accidental<select id="selection-accidental-display" name="selection-accidental-display" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              <option value="auto">When needed</option>
              <option value="always">Always</option>
              <option value="courtesy">Courtesy (parentheses)</option>
            </select>
          </label>
          <label class="field" for="selection-shared-alteration">Absolute alteration<select id="selection-shared-alteration" name="selection-shared-alteration" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Mixed</option>
              ${t({value:"-2",label:"Double flat · −2 semitones",icon:j})}
              ${t({value:"-1.5",label:"Three-quarter flat · −1.5 semitones",icon:Q})}
              ${t({value:"-1",label:"Flat · −1 semitone",icon:E})}
              ${t({value:"-0.5",label:"Quarter flat · −0.5 semitone",icon:G})}
              ${t({value:"0",label:"Natural · 0 semitones",icon:D})}
              ${t({value:"0.5",label:"Quarter sharp · +0.5 semitone",icon:K})}
              ${t({value:"1",label:"Sharp · +1 semitone",icon:g})}
              ${t({value:"1.5",label:"Three-quarter sharp · +1.5 semitones",icon:V})}
              ${t({value:"2",label:"Double sharp · +2 semitones",icon:Y})}
            </select>
          </label>
        </div>
        <p id="selection-shared-help" class="field-help">Mixed means the selected events differ. An eligible change applies to the exact selection in one Undo, or changes nothing.</p>
        <div class="subsection">
          <h3>Articulation presence</h3>
          <label class="field" for="selection-articulation">Articulation<select id="selection-articulation" name="selection-articulation" class="author-select" aria-describedby="selection-shared-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              ${t({value:"accent",label:"Accent",icon:z})}
              ${t({value:"staccato",label:"Staccato",icon:mt})}
              ${t({value:"tenuto",label:"Tenuto",icon:ft})}
              ${t({value:"marcato",label:"Marcato",icon:gt})}
              ${t({value:"staccatissimo",label:"Staccatissimo",icon:yt})}
              ${t({value:"fermata",label:"Fermata",icon:wt})}
            </select>
          </label>
          <div class="button-row">
            <button id="selection-add-articulation" type="button">${e(h,o`<span data-control-label>Add to selection</span>`)}</button>
            <button id="selection-remove-articulation" type="button">${e($t,o`<span data-control-label>Remove from selection</span>`)}</button>
          </div>
          <p class="field-help">Add only missing marks; preserve existing identities. Placement follows the drawn stem automatically.</p>
        </div>
        <p id="selection-shared-error" class="selection-chooser-error" role="alert" tabindex="-1" hidden></p>
        <p class="field-help">Changes apply immediately. Undo restores each accepted change.</p>
      </div>
    </section>
  `}function jt(){return o`
    <section id="note-editor" class="note-editor nonprinting" popover="auto" aria-labelledby="note-editor-heading" aria-describedby="note-editor-context" hidden>
      <div class="note-editor-heading">
        <h2 id="note-editor-heading">Edit note</h2>
        <button id="close-note-editor" type="button" class="quiet-button" popovertarget="note-editor" popovertargetaction="hide">${e(l,"Close")}</button>
      </div>
      <div class="note-editor-body">
        <p id="note-editor-context" class="note-editor-context">Select a note on the staff.</p>
        <label id="note-direction-field" class="field" for="note-direction" hidden>Pitch direction<select id="note-direction" name="note-direction" class="author-select" aria-describedby="note-direction-help">
            <button type="button"><selectedcontent></selectedcontent></button>
            ${t({value:"higher",label:"Higher (top)",icon:I})}
            ${t({value:"same",label:"Same (middle)",icon:d,selected:!0})}
            ${t({value:"lower",label:"Lower (bottom)",icon:F})}
            ${y("same")}
          </select>
        </label>
        <div class="note-rhythm-fields">
          <label class="field" for="note-duration">Note value<select id="note-duration" name="note-duration" class="author-select" aria-describedby="note-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              ${t({value:"breve",label:"Breve",icon:$})}
              ${t({value:"whole",label:"Whole",icon:k})}
              ${t({value:"half",label:"Half",icon:x})}
              ${t({value:"quarter",label:"Quarter",icon:c})}
              ${t({value:"eighth",label:"Eighth",icon:S})}
              ${t({value:"sixteenth",label:"Sixteenth",icon:C})}
              ${t({value:"thirty-second",label:"32nd",icon:q})}
              ${t({value:"sixty-fourth",label:"64th",icon:A})}
              ${t({value:"128th",label:"128th",icon:R})}
            </select>
          </label>
          <label class="field" for="note-dots">Dots<select id="note-dots" name="note-dots" class="author-select" aria-describedby="note-rhythm-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="0">None</option>
              <option value="1">1 dot</option>
              <option value="2">2 dots</option>
              <option value="3">3 dots</option>
            </select>
          </label>
        </div>
        <div id="note-pitch-controls" class="note-pitch-controls">
          <fieldset class="note-accidentals" aria-describedby="note-accidental-help">
            <legend>Set accidental</legend>
            <div class="accidental-choices">
              <button id="note-double-flat" type="button" aria-pressed="false">${e(j,o`<span>Double flat</span>`)}</button>
              <button id="note-flat" type="button" aria-pressed="false">${e(E,o`<span>Flat</span>`)}</button>
              <button id="note-natural" type="button" aria-pressed="false">${e(D,o`<span>Natural</span>`)}</button>
              <button id="note-sharp" type="button" aria-pressed="false">${e(g,o`<span>Sharp</span>`)}</button>
              <button id="note-double-sharp" type="button" aria-pressed="false">${e(Y,o`<span>Double sharp</span>`)}</button>
            </div>
          </fieldset>
          <label class="field" for="note-microtone">Quarter-tone accidental<select id="note-microtone" name="note-microtone" class="author-select" aria-describedby="note-accidental-help">
              <button type="button"><selectedcontent></selectedcontent></button>
              <option value="">Choose a quarter-tone alteration…</option>
              ${t({value:"-1.5",label:"Three-quarter flat · −1.5 semitones",icon:Q})}
              ${t({value:"-0.5",label:"Quarter flat · −0.5 semitone",icon:G})}
              ${t({value:"0.5",label:"Quarter sharp · +0.5 semitone",icon:K})}
              ${t({value:"1.5",label:"Three-quarter sharp · +1.5 semitones",icon:V})}
            </select>
          </label>
          <p id="note-accidental-help" class="field-help">Sets the spelling; the printed sign follows the key and engraving settings.</p>
        </div>
        <p id="note-editor-error" class="note-editor-error" role="alert" hidden=""></p>
        <p id="note-editor-feedback" class="note-editor-feedback" role="status" aria-live="polite" aria-atomic="true"></p>
        <div class="note-editor-routes">
          <button id="note-attached-marks" type="button">${e(z,o`<span data-control-label>Attached marks…</span>`)}</button>
          <button id="note-advanced-edit" type="button" class="quiet-button">${e(M,o`<span data-control-label>Advanced properties…</span>`)}</button>
        </div>
        <p id="note-direction-help" class="field-help" hidden>Higher, same, and lower refer to this voice’s previous main pitch. Tied continuations stay on Same. Direction changes preserve written rhythm and attached marks.</p>
        <p id="note-rhythm-help" class="field-help">Written values move following notes within this voice. No rests are added automatically.</p>
      </div>
      <div class="note-editor-footer">
        <button id="note-editor-undo" type="button" disabled="">${e(p,"Undo change")}</button>
        <p class="field-help">Changes apply immediately.<br>Undo restores each change.</p>
      </div>
    </section>
  `}function Qt(){return o`
    <dialog id="author-confirmation" class="author-confirmation nonprinting" aria-labelledby="author-confirmation-title" aria-describedby="author-confirmation-message">
      <div class="confirmation-heading">
        <h2 id="author-confirmation-title">Review this change</h2>
      </div>
      <div class="confirmation-body">
        <p id="author-confirmation-message"></p>
        <p id="author-confirmation-status" role="alert" hidden></p>
      </div>
      <div class="confirmation-actions">
        <button id="author-confirmation-cancel" type="button" class="quiet-button">${e(l,o`<span id="author-confirmation-cancel-label" data-control-label>Cancel</span>`)}</button>
        <button id="author-confirmation-confirm" type="button" class="primary-button">${e(r,o`<span id="author-confirmation-confirm-label" data-control-label>Confirm</span>`)}</button>
      </div>
    </dialog>
  `}function Gt(){return o`
    <section id="workspace-review" class="surface-popover workspace-review nonprinting" popover="auto" aria-labelledby="workspace-review-heading">
      <div class="popover-heading">
        <h2 id="workspace-review-heading">Workspace review</h2>
        <button id="close-workspace-review" type="button" class="quiet-button" popovertarget="workspace-review" popovertargetaction="hide">${e(l,"Close",{layout:"inline"})}</button>
      </div>
      <div class="popover-body">
        <div id="workspace-notices" class="workspace-notices nonprinting">
          <div class="workspace-notice-summary">
            <div id="source-draft-notice" class="source-draft-notice" hidden>Source unapplied · editing and printing paused.</div>
            <div id="inspector-draft-status" class="inspector-draft-status"></div>
            <div id="workspace-review-summary" class="workspace-review-summary" hidden></div>
          </div>
        </div>
        <div id="author-status" class="author-status nonprinting"></div>
        <p id="workspace-recovery-detail" class="workspace-recovery-detail" hidden></p>
        <button id="review-download-project" type="button" class="primary-button" hidden>${e(De,"Download project")}</button>
        <section id="notation-review" aria-labelledby="notation-review-heading" hidden>
          <h3 id="notation-review-heading">Notation notices</h3>
          <ul id="notation-review-list"></ul>
        </section>
        <p id="pointer-status" class="pointer-status selection-feedback"></p>
        <p id="selection-controls-feedback" class="visually-hidden"></p>
        <p id="selection-controls-error" class="selection-feedback selection-error" hidden></p>
        <div id="author-errors" class="author-errors" tabindex="0" aria-label="Editing problem" hidden></div>
        <div class="button-row review-actions">
          <button id="review-source" type="button" popovertarget="source-panel" hidden>${e(ae,"Review Source")}</button>
          <button id="review-drafts" type="button" hidden>${e(Me,o`<span id="review-drafts-label" data-control-label>Review unsaved forms</span>`)}</button>
          <button id="review-incompatible-mark" type="button" hidden>${e(N,o`<span id="review-incompatible-mark-label" data-control-label>Edit attached mark…</span>`)}</button>
        </div>
      </div>
    </section>
  `}function Kt(){return o`
    <section id="continuation-review" class="surface-popover confirmation-popover nonprinting" popover="auto" aria-labelledby="continuation-review-heading">
      <div class="popover-heading">
        <h2 id="continuation-review-heading">Continue this piece</h2>
        <button id="close-continuation-review" type="button" class="quiet-button" popovertarget="continuation-review" popovertargetaction="hide">${e(l,"Close",{layout:"inline"})}</button>
      </div>
      <div class="popover-body">
        <p id="continuation-review-context" class="target-context"></p>
        <p class="field-help">Review the named staves and ending before changing it. The whole action has one Undo.</p>
        <button id="confirm-continue-piece" type="button" class="primary-button">${e(r,"Change final barlines and insert")}</button>
      </div>
    </section>
  `}function Vt(){return o`
    <section id="pointer-recovery" class="surface-popover confirmation-popover nonprinting" popover="auto" aria-labelledby="pointer-recovery-heading">
      <div class="popover-heading">
        <h2 id="pointer-recovery-heading">Place in a new measure</h2>
        <button id="close-pointer-recovery" type="button" class="quiet-button" popovertarget="pointer-recovery" popovertargetaction="hide">${e(l,"Close",{layout:"inline"})}</button>
      </div>
      <div class="popover-body">
        <p id="pointer-recovery-context" class="target-context"></p>
        <p class="field-help">The earlier gesture changed nothing. This confirms a new destination.</p>
        <button id="confirm-pointer-recovery" type="button" class="primary-button">${e(h,o`<span id="confirm-pointer-recovery-label" data-control-label>Add measure and place note</span>`)}</button>
      </div>
    </section>
  `}const ye="music-workspace-frame, music-panel-frame, music-view-switch, music-score-viewport, music-source-editor, music-toggle-button-group";function Yt(i="write"){return o`
    ${kt(i)}
    <main class="author-workspace">
      <music-workspace-frame id="author-workbench" class="author-workbench" .mode=${i} tools-presentation="closed">
        ${qt()}
        ${Et()}
        ${St()}
        ${xt()}
        ${Dt()}
      </music-workspace-frame>
      <div id="page-host" class="page-host" aria-label="Physical page preview" hidden></div>
      ${Ct()}
    </main>
    ${Qt()}
    ${Gt()}
    ${Mt()}
    ${Ot()}
    ${Ut()}
    ${Ht()}
    ${Lt()}
    ${It()}
    ${Ft()}
    ${Wt()}
    ${Bt()}
    ${zt()}
    ${jt()}
    ${Kt()}
    ${Vt()}
  `}const pe=class pe extends m{constructor(){super(...arguments),this.mode=new He(this,()=>this.viewState?.signals.mode.get()??"write")}createRenderRoot(){return this}willUpdate(a){a.has("viewState")&&this.mode.refresh()}render(){return Yt(this.mode.value)}async getUpdateComplete(){const a=await super.getUpdateComplete();return await Promise.all([...this.querySelectorAll(ye)].map(n=>n.updateComplete)),a}mount(){this.performUpdate();for(const a of this.querySelectorAll(ye))a.mount()}};pe.properties={viewState:{attribute:!1}};let H=pe;function eo(i=document.body){customElements.get("music-author-shell")||customElements.define("music-author-shell",H);const a=i.querySelector("music-author-shell");let n;return a instanceof H?n=a:(n=document.createElement("music-author-shell"),a?a.replaceWith(n):i.prepend(n)),n.mount(),n}const we=new WeakSet;function to(i,a){we.has(i)||(i.replaceChildren(),we.add(i)),ke(P(a,n=>JSON.stringify([n.code,n.sourceId,n.measureId,n.message]),n=>o`
    <li data-source-id=${n.sourceId} data-diagnostic-code=${n.code}>${n.message} [${n.sourceId}]</li>
  `),i)}export{_t as a,eo as m,to as r};

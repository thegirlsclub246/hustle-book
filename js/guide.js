/* Hustle Book guide: "Add to Home Screen" steps and a tap-through walkthrough.
   Self-contained: injects its own styles and works in both the online app and the on-phone copy.
   Usage:
     HBGuide.init({ tour: [ {sel:"#id", title:"...", text:"...", before(){...}} ] });
     HBGuide.firstRun();    // shows the home-screen steps once, then offers the tour
     HBGuide.showInstall(); // reopen the home-screen steps any time
     HBGuide.startTour();   // reopen the walkthrough any time
*/
(function(){
  const SEEN="hustlebook.guide.seen";
  let tour=[], deferredPrompt=null, step=0;
  const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;const b=document.getElementById("hbgInstallNow");if(b)b.hidden=false});
  window.addEventListener("appinstalled",()=>{deferredPrompt=null;close()});

  function standalone(){return window.matchMedia("(display-mode: standalone)").matches||window.navigator.standalone===true}
  function platform(){
    const ua=navigator.userAgent||"";
    const ios=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1);
    if(ios)return /CriOS|FxiOS|EdgiOS/.test(ua)?"ios-other":"ios";
    if(/Android/.test(ua))return /SamsungBrowser/.test(ua)?"samsung":"android";
    return "desktop";
  }

  const css=`
  .hbg-back{position:fixed;inset:0;background:rgba(10,16,30,.55);z-index:50;display:flex;align-items:flex-end;justify-content:center}
  .hbg-sheet{background:var(--surface,#fff);color:var(--ink,#0f1a2e);width:100%;max-width:520px;border-radius:18px 18px 0 0;padding:20px max(18px,env(safe-area-inset-left,0px)) calc(20px + env(safe-area-inset-bottom,0px)) max(18px,env(safe-area-inset-right,0px));display:flex;flex-direction:column;gap:12px;max-height:88vh;overflow:auto;box-shadow:0 -8px 30px rgba(0,0,0,.25)}
  .hbg-sheet h2{font-family:var(--display,inherit);font-size:21px;margin:0}
  .hbg-sheet p{margin:0;color:var(--muted,#5b6578);font-size:14px}
  .hbg-head{display:flex;gap:12px;align-items:center}
  .hbg-head img{width:48px;height:48px;border-radius:12px;flex:none}
  .hbg-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:10px;counter-reset:s}
  .hbg-steps li{display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:start;font-size:15px;counter-increment:s}
  .hbg-steps li::before{content:counter(s);width:28px;height:28px;border-radius:50%;background:var(--gold,#f0b400);color:var(--gold-ink,#3a2a00);display:grid;place-items:center;font-weight:700;font-size:14px}
  .hbg-ico{display:inline-grid;place-items:center;vertical-align:-5px;width:22px;height:22px;border:1px solid var(--line,#dfe4ee);border-radius:6px;background:var(--bg,#f3f5f9);margin:0 2px}
  .hbg-ico svg{width:14px;height:14px}
  .hbg-btns{display:flex;gap:8px;flex-wrap:wrap}
  .hbg-btns button{flex:1 1 140px;padding:11px;font-size:14px}
  .hbg-tabs{display:flex;gap:6px;flex-wrap:wrap}
  .hbg-tabs button{padding:6px 10px;font-size:12.5px}
  .hbg-tabs button[aria-pressed="true"]{background:var(--ink,#0f1a2e);color:var(--bg,#fff);border-color:var(--ink,#0f1a2e)}
  .hbg-hi{position:relative;z-index:51;outline:3px solid var(--gold,#f0b400)!important;outline-offset:4px;border-radius:12px;box-shadow:0 0 0 9999px rgba(10,16,30,.45)}
  .hbg-card{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));width:calc(100% - 32px);max-width:480px;z-index:52;background:var(--surface,#fff);color:var(--ink,#0f1a2e);border-radius:14px;padding:14px 16px;box-shadow:0 10px 30px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:8px}
  .hbg-card.top{bottom:auto;top:calc(16px + env(safe-area-inset-top,0px))}
  .hbg-card strong{font-family:var(--display,inherit);font-size:17px}
  .hbg-card p{margin:0;font-size:14px;color:var(--muted,#5b6578)}
  .hbg-card .hbg-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
  .hbg-card .hbg-btns{flex-wrap:nowrap}
  .hbg-card .hbg-btns button{flex:0 0 auto;padding:8px 16px}
  .hbg-dots{font-size:12px;color:var(--muted,#5b6578)}
  @media (prefers-reduced-motion:no-preference){.hbg-sheet{animation:hbgUp .25s ease-out}@keyframes hbgUp{from{transform:translateY(30px);opacity:.4}}}`;
  function addCss(){if(document.getElementById("hbg-css"))return;const s=document.createElement("style");s.id="hbg-css";s.textContent=css;document.head.appendChild(s)}

  const ICON_SHARE='<span class="hbg-ico" aria-label="Share"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/></svg></span>';
  const ICON_DOTS='<span class="hbg-ico" aria-label="menu"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></span>';
  const ICON_PLUS='<span class="hbg-ico" aria-label="plus"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></svg></span>';
  const STEPS={
    ios:{label:"iPhone or iPad",steps:[`Tap the Share button ${ICON_SHARE} at the bottom of Safari. On iPad it's at the top.`,`Scroll down and tap <b>Add to Home Screen</b> ${ICON_PLUS}.`,`Tap <b>Add</b>. Hustle Book is now on your home screen.`]},
    "ios-other":{label:"iPhone (Chrome)",steps:[`Tap the Share button ${ICON_SHARE} next to the address bar.`,`Tap <b>Add to Home Screen</b> ${ICON_PLUS}. If you don't see it, open this page in Safari instead.`,`Tap <b>Add</b>.`]},
    android:{label:"Android",steps:[`Tap the menu ${ICON_DOTS} at the top right of Chrome.`,`Tap <b>Add to Home screen</b> or <b>Install app</b>.`,`Tap <b>Install</b> or <b>Add</b>.`]},
    samsung:{label:"Samsung Internet",steps:[`Tap the menu (three lines) at the bottom right.`,`Tap <b>Add page to</b>, then <b>Home screen</b>.`,`Tap <b>Add</b>.`]},
    desktop:{label:"Computer",steps:[`In Chrome or Edge, click the install icon at the right end of the address bar.`,`Click <b>Install</b>. Hustle Book opens in its own window.`,`On a phone? Open this same link there to add it to your home screen.`]}
  };

  let back=null;
  function close(){if(back){back.remove();back=null}}
  function showInstall(opts={}){
    addCss();close();
    let plat=platform();
    back=document.createElement("div");back.className="hbg-back";back.setAttribute("role","dialog");back.setAttribute("aria-modal","true");back.setAttribute("aria-labelledby","hbgTitle");
    const icon=document.querySelector('link[rel="apple-touch-icon"]');
    const render=()=>{
      const s=STEPS[plat];
      back.innerHTML=`<div class="hbg-sheet">
        <div class="hbg-head">${icon?`<img src="${icon.href}" alt="">`:""}<div><h2 id="hbgTitle">${standalone()?"You're all set":plat==="desktop"?"Install Hustle Book on this computer":"Put Hustle Book on your home screen"}</h2><p>${standalone()?"Hustle Book is already installed.":plat==="desktop"?"It opens in its own window like a normal program. You can also open it on your phone any time by signing in.":"It opens full screen like a normal app, in one tap."}</p></div></div>
        ${standalone()?"":`<div class="hbg-tabs" role="group" aria-label="Your phone">${Object.entries(STEPS).map(([k,v])=>`<button type="button" data-plat="${k}" aria-pressed="${k===plat}">${v.label}</button>`).join("")}</div>
        <ol class="hbg-steps">${s.steps.map(x=>`<li><span>${x}</span></li>`).join("")}</ol>
        <button type="button" class="primary" id="hbgInstallNow" ${deferredPrompt?"":"hidden"}>Install now</button>`}
        <div class="hbg-btns">${tour.length&&opts.offerTour!==false?`<button type="button" class="primary" id="hbgTour">Show me around</button>`:""}<button type="button" id="hbgLater">${opts.offerTour!==false&&tour.length?"Maybe later":"Close"}</button></div>
        ${opts.offerTour!==false&&tour.length?`<p>You can find these steps and the walkthrough again in Setup.</p>`:""}
      </div>`;
    };
    render();document.body.appendChild(back);
    back.addEventListener("click",async e=>{
      if(e.target===back){close();return}
      const b=e.target.closest("button");if(!b)return;
      if(b.dataset.plat){plat=b.dataset.plat;render();return}
      if(b.id==="hbgInstallNow"&&deferredPrompt){deferredPrompt.prompt();try{await deferredPrompt.userChoice}catch(x){}deferredPrompt=null;close();return}
      if(b.id==="hbgTour"){close();startTour();return}
      if(b.id==="hbgLater")close();
    });
    const first=back.querySelector("button.primary,button");if(first)first.focus();
  }

  let card=null,hi=null;
  function clearHi(){if(hi){hi.classList.remove("hbg-hi");hi=null}}
  function endTour(){clearHi();if(card){card.remove();card=null}}
  function startTour(){if(!tour.length)return;addCss();step=0;showStep()}
  function showStep(){
    clearHi();const t=tour[step];if(!t){endTour();return}
    if(t.before)try{t.before()}catch(e){}
    const el=t.sel?document.querySelector(t.sel):null;
    if(!card){card=document.createElement("div");card.className="hbg-card";card.setAttribute("role","dialog");card.setAttribute("aria-live","polite");document.body.appendChild(card);
      card.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;if(b.dataset.go==="next"){step++;step<tour.length?showStep():endTour()}else if(b.dataset.go==="back"){step=Math.max(0,step-1);showStep()}else endTour()})}
    card.innerHTML=`<strong>${t.title}</strong><p>${t.text}</p><div class="hbg-row"><span class="hbg-dots">${step+1} of ${tour.length}</span><div class="hbg-btns" style="flex:0 0 auto">${step?`<button type="button" data-go="back">Back</button>`:`<button type="button" data-go="end">Skip</button>`}<button type="button" class="primary" data-go="next">${step===tour.length-1?"Finish":"Next"}</button></div></div>`;
    if(el&&el.offsetParent!==null){
      hi=el;el.classList.add("hbg-hi");
      el.scrollIntoView({block:"center",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
      setTimeout(()=>{if(!card)return;const r=el.getBoundingClientRect();card.classList.toggle("top",r.top+r.height/2>window.innerHeight*0.55)},350);
    }else card.classList.remove("top");
    const nb=card.querySelector('[data-go="next"]');if(nb)nb.focus({preventScroll:true});
  }
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(card)endTour();else close()}});

  window.HBGuide={
    init(o){tour=(o&&o.tour)||[]},
    showInstall,startTour,
    firstRun(){if(store.get(SEEN))return;store.set(SEEN,"1");if(standalone()){if(tour.length)startTour()}else showInstall()}
  };

  // Nothing is cached on the device: remove any offline copy an earlier version saved.
if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister())).catch(()=>{});if(window.caches)caches.keys().then(ks=>ks.forEach(k=>caches.delete(k))).catch(()=>{})}
})();

// Owner app: sign-in check, onboarding, saving to Supabase, and booking requests from customers.
// The screens and features themselves live in app-core.js (ported from the prototype).
var BOOK_LINK = "";
const TABKEY = "hustlebook.tab", CACHE = "hustlebook.cache";
let uid = 1, business = null, saveTimer = null, saving = false, dirty = false;

// ---------- saving ----------
function setSync(text, st){const el=$("sync");if(el){el.textContent=text;el.dataset.state=st||""}}
function save(){
  if(!business)return true;
  dirty=true;clearTimeout(saveTimer);setSync("Saving…","busy");
  try{localStorage.setItem(CACHE,JSON.stringify({id:business.id,state}))}catch(e){}
  saveTimer=setTimeout(flush,700);
  return true;
}
async function flush(){
  if(saving){saveTimer=setTimeout(flush,500);return}
  saving=true;dirty=false;
  const {settings,services,specials,items,clients,queue}=state;
  const {error}=await sb.from("businesses").update({profile:{settings,services,specials},data:{items,clients,queue},updated_at:new Date().toISOString()}).eq("id",business.id);
  saving=false;
  if(error){dirty=true;setSync("Not saved yet. Retrying…","err");saveTimer=setTimeout(flush,5000);return}
  if(!dirty)setSync("All changes saved","ok");
}
window.addEventListener("beforeunload",e=>{if(dirty||saving){e.preventDefault();e.returnValue=""}});
window.addEventListener("online",()=>{if(dirty)flush()});

// ---------- start ----------
async function boot(){
  if(!HB_READY){showNotReady($("onboard"));$("onboard").hidden=false;return}
  const {data:{session}}=await sb.auth.getSession();
  if(!session){location.replace("index.html");return}
  $("acctEmail").textContent="Signed in as "+session.user.email;
  const {data,error}=await sb.from("businesses").select("*").eq("owner_id",session.user.id).maybeSingle();
  if(error){
    // Fall back to the copy saved on this device so the owner can still see today's bookings.
    let cached=null;try{cached=JSON.parse(localStorage.getItem(CACHE))}catch(e){}
    if(cached&&cached.state){toast("You're offline. Showing the last copy saved on this phone.");}
    $("onboard").hidden=false;$("onboard").innerHTML=`<div class="card"><h2>Couldn't load your book</h2><p class="note full">Check your internet connection, then refresh this page.</p></div>`;
    return;
  }
  if(!data){onboarding(session);return}
  start(data);
}
function start(row){
  business=row;const p=row.profile||{},d=row.data||{};
  state={settings:{...DEFAULT_SETTINGS,...(p.settings||{})},services:p.services||[],specials:p.specials||[],items:d.items||[],clients:d.clients||[],queue:d.queue||[]};
  uid=Math.max(0,...state.items.map(i=>+i.id||0))+1;
  setLink(row.slug);
  $("onboard").hidden=true;$("ownerView").hidden=false;
  $("today").textContent=now.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
  $("invDay").value=TODAY;$("invFrom").value=iso(new Date(now.getFullYear(),now.getMonth(),1));$("invTo").value=TODAY;
  fillSettings();renderServices();render();resetForm();
  let tab="today";try{tab=localStorage.getItem(TABKEY)||"today"}catch(e){}
  showTab(["today","clients","money","setup"].includes(tab)?tab:"today");spKindUI();
  setSync("All changes saved","ok");
  setTimeout(()=>HBGuide.firstRun(),700);
  offerImport();
  loadRequests();setInterval(loadRequests,60000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)loadRequests()});
}
function setLink(slug){
  BOOK_LINK=new URL("book.html?b="+encodeURIComponent(slug),location.href).href;
  $("bookLink").textContent=BOOK_LINK;$("previewBook").href=BOOK_LINK;$("setSlug").value=slug;
}

// ---------- bring over data from the on-phone version ----------
function offerImport(){
  let old=null;try{old=JSON.parse(localStorage.getItem("hustlebook.v2"))}catch(e){}
  if(!old||old.sample||old.imported)return;
  const n=(old.items||[]).length,c=(old.clients||[]).length;if(!n&&!c)return;
  const box=document.createElement("section");box.className="card";box.id="importCard";
  box.innerHTML=`<h2>Bring over your bookings?</h2><p class="note">We found ${n} booking${n===1?"":"s"} and ${c} client${c===1?"":"s"} saved on this phone from the earlier Hustle Book. Add them to your account so they're safe and on every device.</p><button type="button" class="primary" id="impYes">Bring them over</button><button type="button" id="impNo">Not now</button>`;
  $("pane-today").prepend(box);
  $("impNo").addEventListener("click",()=>box.remove());
  $("impYes").addEventListener("click",()=>{
    const known=new Set(state.items.map(i=>i.date+i.time+norm(i.name)));
    (old.items||[]).forEach(i=>{if(!known.has(i.date+i.time+norm(i.name)))state.items.push({...i,id:uid++})});
    (old.clients||[]).forEach(c=>{const have=findClient(c.name);if(!have)state.clients.push(c);else{if(!have.notes&&c.notes)have.notes=c.notes;if(!have.photo&&c.photo)have.photo=c.photo;if(!have.phone&&c.phone)have.phone=c.phone}});
    if(!state.specials.length&&old.specials)state.specials=old.specials;
    old.imported=true;try{localStorage.setItem("hustlebook.v2",JSON.stringify(old))}catch(e){}
    save();render();box.remove();toast(`Brought over ${n} bookings and ${c} clients`);
  });
}

// ---------- first-time setup ----------
function onboarding(session){
  const el=$("onboard");el.hidden=false;
  el.innerHTML=`<header><h1>Hustle <span>Book</span></h1></header>
  <p class="lede">Welcome. Tell us about your business to set up your book. You can change all of this later.</p>
  <form id="obForm">
    <label class="full">Business name<input id="obName" required maxlength="60" placeholder="e.g. Nails by Keisha"></label>
    <label class="full">Type of business<select id="obType">${Object.entries(TYPES).map(([k,t])=>`<option value="${k}">${t.label}</option>`).join("")}</select></label>
    <label class="full">Booking link name<input id="obSlug" required maxlength="40" pattern="[a-z0-9\\-]{3,40}" autocomplete="off" spellcheck="false"></label>
    <p class="note full" id="obLink"></p>
    <label class="full">WhatsApp number<input id="obWa" inputmode="tel" placeholder="246 555 0000"></label>
    <p class="err full" id="obErr" hidden></p>
    <button class="primary full" type="submit" id="obBtn">Create my book</button>
  </form>`;
  let slugTouched=false;
  const showLink=()=>$("obLink").textContent="Customers will book at "+new URL("book.html?b="+($("obSlug").value||"your-name"),location.href).href;
  $("obName").addEventListener("input",()=>{if(!slugTouched){$("obSlug").value=slugify($("obName").value);showLink()}});
  $("obSlug").addEventListener("input",()=>{slugTouched=true;$("obSlug").value=slugify($("obSlug").value);showLink()});
  showLink();
  $("obForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const type=$("obType").value,name=$("obName").value.trim(),slug=slugify($("obSlug").value);
    if(slug.length<3){showErr("Make the booking link name at least 3 letters or numbers.");return}
    $("obBtn").disabled=true;$("obBtn").textContent="Setting up…";
    const settings={...DEFAULT_SETTINGS,type,name,whatsapp:$("obWa").value.trim()};
    const row={owner_id:session.user.id,slug,profile:{settings,services:TYPES[type].services.map(s=>({...s})),specials:[]},data:{items:[],clients:[],queue:[]}};
    const {data,error}=await sb.from("businesses").insert(row).select().single();
    $("obBtn").disabled=false;$("obBtn").textContent="Create my book";
    if(error){showErr(error.code==="23505"?"That booking link name is already taken. Try another one.":"Couldn't create your book: "+error.message);return}
    start(data);toast("Your book is ready. Check the prices in Setup.");
  });
  function showErr(m){$("obErr").textContent=m;$("obErr").hidden=false}
}

// ---------- account ----------
$("signOut").addEventListener("click",async()=>{if(dirty)await flush();await sb.auth.signOut();try{localStorage.removeItem(CACHE)}catch(e){}location.replace("index.html")});
$("saveSlug").addEventListener("click",async()=>{
  const slug=slugify($("setSlug").value);if(slug.length<3){toast("Use at least 3 letters or numbers");return}
  if(slug===business.slug){toast("That's already your link");return}
  const {error}=await sb.from("businesses").update({slug}).eq("id",business.id);
  if(error){toast(error.code==="23505"?"That name is taken. Try another.":"Couldn't change it: "+error.message);$("setSlug").value=business.slug;return}
  business.slug=slug;setLink(slug);toast("Booking link changed");
});

// ---------- booking requests from customers ----------
let requests=[];
async function loadRequests(){
  if(!business)return;
  const {data,error}=await sb.from("booking_requests").select("*").eq("business_id",business.id).eq("status","new").order("date").order("time");
  if(error)return;
  const handled=requests.filter(r=>r._done);
  requests=handled.concat(data.filter(r=>!handled.some(h=>h.id===r.id)));
  renderRequests();
}
function clashWith(r){
  const start=toMin(r.time),end=start+minsOf(r.service);
  return state.items.find(i=>i.date===r.date&&i.status==="booked"&&toMin(i.time)<end&&start<toMin(i.time)+minsOf(i.service));
}
const toMin=t=>{const [h,m]=String(t).split(":").map(Number);return h*60+(m||0)};
function confirmMsg(r){
  let t=`Hi ${first(r.name)}, you're booked with ${state.settings.name} on ${prettyDate(r.date)} at ${to12(r.time)} for a ${r.service.toLowerCase()} (${money(r.price)}).`;
  const dep=+state.settings.deposit;if(dep)t+=` To hold your slot, please send the ${money(dep)} deposit by bank transfer.`;
  return t+" See you then!";
}
function declineMsg(r){return `Hi ${first(r.name)}, thanks for booking with ${state.settings.name}. Sorry, I can't do ${prettyDate(r.date)} at ${to12(r.time)}. Can you pick another time here? ${BOOK_LINK}`}
function renderRequests(){
  const fresh=requests.filter(r=>!r._done).length;
  $("reqSection").hidden=!requests.length;
  $("reqCount").textContent=fresh?`${fresh} waiting`:"";
  $("reqBadge").textContent=fresh;$("reqBadge").hidden=!fresh;
  $("reqList").innerHTML=requests.map(r=>{
    if(r._done){const text=r._done==="accepted"?confirmMsg(r):declineMsg(r);const wa=waNumber(r.phone);
      return `<div class="row" style="grid-template-columns:1fr"><div class="who"><strong>${r._done==="accepted"?"Added":"Declined"}: ${esc(r.name)}</strong><span>${esc(r.service)} · ${prettyDate(r.date)} at ${to12(r.time)}</span></div>
      <div class="actions">${wa?`<a class="btnlink primary" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(text)}">Send ${r._done==="accepted"?"confirmation":"message"} on WhatsApp</a>`:""}<button data-req="copy" data-id="${r.id}">Copy message</button><button data-req="dismiss" data-id="${r.id}">Done</button></div><div class="msg" hidden></div></div>`}
    const c=clashWith(r);
    return `<div class="row"><div class="time">${prettyDate(r.date).split(" ").slice(0,2).join(" ")}<br>${to12(r.time)}</div><div class="who"><strong>${esc(r.name)}</strong><span>${esc(r.service)}${r.phone?" · "+esc(r.phone):""}</span>${r.note?`<em class="cnote">${esc(r.note)}</em>`:""}</div>
    <div class="right"><span class="price">${money(r.price)}</span><span class="pill p-owed">New</span></div>
    <div class="tags">${r.special?`<span class="tag">${esc(r.special)}</span>`:""}${c?`<span class="tag gold">Clashes with ${esc(c.name)} at ${to12(c.time)}</span>`:""}</div>
    <div class="actions"><button class="primary" data-req="accept" data-id="${r.id}">Accept</button><button class="danger" data-req="decline" data-id="${r.id}">Decline</button></div></div>`}).join("");
}
$("reqList").addEventListener("click",async e=>{
  const b=e.target.closest("[data-req]");if(!b)return;
  const r=requests.find(x=>x.id===b.dataset.id);if(!r)return;
  const act=b.dataset.req;
  if(act==="dismiss"){requests=requests.filter(x=>x!==r);renderRequests();return}
  if(act==="copy"){copyText(r._done==="accepted"?confirmMsg(r):declineMsg(r),b.closest(".row").querySelector(".msg"));return}
  b.disabled=true;
  const status=act==="accept"?"accepted":"declined";
  const {error}=await sb.from("booking_requests").update({status}).eq("id",r.id);
  if(error){b.disabled=false;toast("Couldn't update that request. Check your internet and try again.");return}
  if(status==="accepted"){
    const base=priceOf(r.service)||+r.price||0,price=r.price!=null?+r.price:base;
    upsertClient(r.name,r.phone||"");
    state.items.push({id:uid++,name:r.name,phone:r.phone||"",service:r.service,base,price,discount:Math.max(0,base-price),special:r.special||"",reward:false,deposit:0,date:r.date,time:r.time,status:"booked",method:null});
    save();render();toast(`${r.name} added to your book`);
  }else toast("Request declined");
  r._done=status;renderRequests();
});

boot();

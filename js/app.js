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
  saveTimer=setTimeout(flush,700);
  return true;
}
async function flush(){
  if(saving){saveTimer=setTimeout(flush,500);return}
  saving=true;dirty=false;
  const {settings,services,specials,gallery,items,clients,queue}=state;
  const {error}=await sb.from("businesses").update({profile:{settings,services,specials,gallery},data:{items,clients,queue},updated_at:new Date().toISOString()}).eq("id",business.id);
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
  if(!(await checkSubscription(session)))return;
  const {data,error}=await sb.from("businesses").select("*").eq("owner_id",session.user.id).maybeSingle();
  if(error){
    // Fall back to the copy saved on this device so the owner can still see today's bookings.
    $("onboard").hidden=false;$("onboard").innerHTML=`<div class="card"><h2>Couldn't load your book</h2><p class="note full">Check your internet connection, then refresh this page.</p></div>`;
    return;
  }
  if(!data){onboarding(session);return}
  start(data);
}
// Hustle Book is for paying Hustle Kit subscribers. The database enforces this;
// this only explains it nicely. If the check itself fails, carry on and let the database decide.
const STORE_URL=new URL("../#hustle-book",location.href).href;
async function myAccess(){
  const {data,error}=await sb.rpc("my_access");
  return error||!data||!data[0]?null:data[0];
}
async function checkSubscription(session){
  let a=await myAccess();
  if(!a)return true;
  const soon=Date.now()+3*864e5,checked=a.checked_at?Date.parse(a.checked_at):0;
  // Re-check with PayPal when the paid month is nearly over, or at least once a week.
  if(a.status&&a.status!=="free"&&(!a.paid_until||Date.parse(a.paid_until)<soon||Date.now()-checked>7*864e5)){
    try{await sb.functions.invoke("hustle-subscribe",{body:{action:"refresh"}});a=(await myAccess())||a}catch(e){}
  }
  if(a.has_access)return true;
  $("onboard").hidden=false;
  $("onboard").innerHTML=`<div class="card"><h2>${a.status?"Your subscription has ended":"Hustle Book needs a subscription"}</h2>
    <p class="note full">Hustle Book is part of a Hustle Kit subscription, and there isn't an active one for ${esc(session.user.email)}. Your bookings and clients are kept safe. Subscribe again and everything is here waiting for you.</p>
    <a class="btnlink primary full" style="text-align:center" href="${STORE_URL}">Subscribe on the Hustle Kit store</a>
    <p class="note full">Already paid? Message us with your PayPal subscription ID (it starts with I-) and we'll sort it out.</p>
    <button type="button" class="full" id="lapsedOut">Sign out</button></div>`;
  $("lapsedOut").addEventListener("click",async()=>{await sb.auth.signOut();location.replace("index.html")});
  return false;
}
function start(row){
  business=row;const p=row.profile||{},d=row.data||{};
  state={settings:{...DEFAULT_SETTINGS,...(p.settings||{})},services:p.services||[],specials:p.specials||[],gallery:p.gallery||[],items:d.items||[],clients:d.clients||[],queue:d.queue||[]};
  uid=Math.max(0,...state.items.map(i=>+i.id||0))+1;
  setLink(row.slug);
  $("onboard").hidden=true;$("ownerView").hidden=false;
  $("today").textContent=now.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"});
  $("invDay").value=TODAY;$("invFrom").value=iso(new Date(now.getFullYear(),now.getMonth(),1));$("invTo").value=TODAY;
  fillSettings();renderServices();render();resetForm();renderGallery();
  let tab="today";try{tab=localStorage.getItem(TABKEY)||"today"}catch(e){}
  showTab(["today","clients","money","setup"].includes(tab)?tab:"today");spKindUI();
  setSync("All changes saved","ok");
  setTimeout(()=>HBGuide.firstRun(),700);
  offerImport();
  loadRequests();setInterval(loadRequests,60000);loadReviews();
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){loadRequests();loadReviews()}});
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
// New requests wait for Accept, unless instant booking is on. Requests the client cancelled or moved
// take the booking out of the book and show a notice until the owner taps Done.
let requests=[];
async function loadRequests(){
  if(!business)return;
  const {data,error}=await sb.from("booking_requests").select("*").eq("business_id",business.id).in("status",["new","cancelled"]).order("date").order("time");
  if(error)return;
  const handled=requests.filter(r=>r._done),fresh=data.filter(r=>!handled.some(h=>h.id===r.id));
  requests=handled.concat(fresh.filter(r=>r.status==="new"));
  // Cancellations first, so a moved booking frees its old time before the new one is checked for clashes.
  for(const r of fresh.filter(r=>r.status==="cancelled"))await handleCancel(r,data);
  if(state.settings.instant)for(const r of requests.filter(r=>!r._done&&!clashWith(r)))await acceptRequest(r,true);
  renderRequests();
}
async function handleCancel(r,all){
  const {error}=await sb.from("booking_requests").update({status:"cancel_seen"}).eq("id",r.id);
  if(error)return;
  const it=state.items.find(i=>i.req===r.id&&i.status==="booked");
  if(it){if(+it.deposit)it.status="cancelled";else state.items=state.items.filter(i=>i!==it);save();render()}
  const to=all.find(x=>x.moved_from===r.id);
  r._done=to?"moved":"cancelled";r._to=to||null;requests.push(r);
}
function clashWith(r){
  const start=toMin(r.time),end=start+minsOf(r.service);
  return state.items.find(i=>i.date===r.date&&i.status==="booked"&&toMin(i.time)<end&&start<toMin(i.time)+minsOf(i.service));
}
const toMin=t=>{const [h,m]=String(t).split(":").map(Number);return h*60+(m||0)};
function confirmMsg(r){
  const S=state.settings;
  let t=`Hi ${first(r.name)}, you're booked with ${S.name} on ${prettyDate(r.date)} at ${to12(r.time)} for a ${r.service.toLowerCase()} (${money(r.price)}).`;
  const dep=+S.deposit,it=state.items.find(i=>i.req===r.id);
  if(dep&&!(it&&+it.deposit))t+=` To hold your slot, please send the ${money(dep)} deposit ${depositHow(S)}.`;
  return t+` Need to change or cancel? Use this link: ${manageLink(r.id)} See you then!`;
}
function declineMsg(r){return `Hi ${first(r.name)}, thanks for booking with ${state.settings.name}. Sorry, I can't do ${prettyDate(r.date)} at ${to12(r.time)}. Can you pick another time here? ${BOOK_LINK}`}
async function acceptRequest(r,auto){
  const {error}=await sb.from("booking_requests").update({status:"accepted"}).eq("id",r.id);
  if(error)return false;
  const base=priceOf(r.service)||+r.price||0,price=r.price!=null?+r.price:base;
  upsertClient(r.name,r.phone||"");
  // A moved booking keeps the deposit that was paid on the old one.
  let deposit=0;const old=r.moved_from&&state.items.find(i=>i.req===r.moved_from);
  if(old){deposit=+old.deposit||0;state.items=state.items.filter(i=>i!==old)}
  state.items.push({id:uid++,req:r.id,name:r.name,phone:r.phone||"",service:r.service,base,price,discount:Math.max(0,base-price),special:r.special||"",reward:false,deposit,date:r.date,time:r.time,status:"booked",method:null});
  save();render();r._done="accepted";r._auto=!!auto;
  toast(auto?`${r.name} booked ${prettyDate(r.date)} at ${to12(r.time)}`:`${r.name} added to your book`);
  return true;
}
function renderRequests(){
  const fresh=requests.filter(r=>!r._done).length;
  $("reqSection").hidden=!requests.length;
  $("reqCount").textContent=fresh?`${fresh} waiting`:"";
  $("reqBadge").textContent=requests.length;$("reqBadge").hidden=!requests.length;
  $("reqNote").textContent=state.settings.instant?"Clients booked these from your link. They're already in your book. Send each one the confirmation on WhatsApp.":"Customers booked these from your link. Accept to add them to your book, then send the confirmation on WhatsApp.";
  $("reqList").innerHTML=requests.map(r=>{
    if(r._done==="moved"||r._done==="cancelled"){
      const head=r._done==="moved"?`Moved: ${esc(r.name)}`:`Cancelled: ${esc(r.name)}`;
      const sub=`${esc(r.service)} · was ${prettyDate(r.date)} at ${to12(r.time)}`+(r._to?` · now ${prettyDate(r._to.date)} at ${to12(r._to.time)}`:"");
      return `<div class="row" style="grid-template-columns:1fr"><div class="who"><strong>${head}</strong><span>${sub}</span></div><div class="actions"><button data-req="dismiss" data-id="${r.id}">Done</button></div></div>`}
    if(r._done){const text=r._done==="accepted"?confirmMsg(r):declineMsg(r),url=waLink(r.phone,text);
      return `<div class="row" style="grid-template-columns:1fr"><div class="who"><strong>${r._done==="accepted"?(r._auto?"Booked":"Added"):"Declined"}: ${esc(r.name)}</strong><span>${esc(r.service)} · ${prettyDate(r.date)} at ${to12(r.time)}</span></div>
      <div class="actions">${url?`<a class="btnlink primary" target="_blank" rel="noopener" href="${esc(url)}">Send ${r._done==="accepted"?"confirmation":"message"} on WhatsApp</a>`:""}<button data-req="copy" data-id="${r.id}">Copy message</button><button data-req="dismiss" data-id="${r.id}">Done</button></div><div class="msg" hidden></div></div>`}
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
  if(act==="accept"){if(!(await acceptRequest(r,false))){b.disabled=false;toast("Couldn't update that request. Check your internet and try again.")}renderRequests();return}
  const {error}=await sb.from("booking_requests").update({status:"declined"}).eq("id",r.id);
  if(error){b.disabled=false;toast("Couldn't update that request. Check your internet and try again.");return}
  toast("Request declined");r._done="declined";renderRequests();
});

// ---------- photos for the booking page ----------
const MAX_PHOTOS=6;
function renderGallery(){
  const g=state.gallery;
  $("galList").innerHTML=g.length?g.map((src,k)=>`<figure><img src="${src}" alt="Photo ${k+1} of your work"><button type="button" class="danger" data-rmgal="${k}" aria-label="Remove photo ${k+1}">✕</button></figure>`).join(""):`<p class="note">No photos yet.</p>`;
  $("galAdd").disabled=g.length>=MAX_PHOTOS;
}
$("galAdd").addEventListener("change",async e=>{
  const files=[...e.target.files].slice(0,MAX_PHOTOS-state.gallery.length);e.target.value="";
  for(const f of files){try{state.gallery.push(await shrink(f))}catch(err){toast("Couldn't read that photo. Try a JPG or PNG.")}}
  if(files.length){save();renderGallery();toast(files.length>1?"Photos added to your booking page":"Photo added to your booking page")}
  else toast(`You can have up to ${MAX_PHOTOS} photos. Remove one first.`);
});
$("galList").addEventListener("click",e=>{const b=e.target.closest("[data-rmgal]");if(!b)return;state.gallery.splice(+b.dataset.rmgal,1);save();renderGallery();toast("Photo removed")});

// ---------- reviews ----------
let reviews=[];
async function loadReviews(){
  if(!business)return;
  const {data,error}=await sb.from("reviews").select("*").eq("business_id",business.id).order("created_at",{ascending:false}).limit(100);
  if(error)return;reviews=data;renderReviews();
}
function renderReviews(){
  const fresh=reviews.filter(r=>r.status==="new").length,shown=reviews.filter(r=>r.status==="shown");
  $("revBadge").textContent=fresh;$("revBadge").hidden=!fresh;
  $("revCount").textContent=reviews.length?`${shown.length} showing`+(fresh?` · ${fresh} new`:""):"";
  $("revList").innerHTML=reviews.length?reviews.map(r=>`<div class="row" style="grid-template-columns:1fr auto"><div class="who"><strong>${esc(r.name)} <span class="starline" aria-label="${r.stars} out of 5 stars">${stars(r.stars)}</span></strong>${r.body?`<span>${esc(r.body)}</span>`:""}</div>
    <span class="pill ${r.status==="shown"?"p-paid":r.status==="new"?"p-owed":"p-booked"}">${r.status==="shown"?"Showing":r.status==="new"?"New":"Hidden"}</span>
    <div class="actions">${r.status==="shown"?`<button data-rev="hidden" data-id="${r.id}">Hide</button>`:`<button class="primary" data-rev="shown" data-id="${r.id}">Show on my page</button>`}${r.status==="new"?`<button data-rev="hidden" data-id="${r.id}">Hide</button>`:""}<button class="danger" data-rev="del" data-id="${r.id}">Delete</button></div></div>`).join(""):`<div class="empty">No reviews yet.</div>`;
}
$("revList").addEventListener("click",async e=>{
  const b=e.target.closest("[data-rev]");if(!b)return;const r=reviews.find(x=>x.id===b.dataset.id);if(!r)return;
  b.disabled=true;const st=b.dataset.rev;
  const {error}=st==="del"?await sb.from("reviews").delete().eq("id",r.id):await sb.from("reviews").update({status:st}).eq("id",r.id);
  if(error){b.disabled=false;toast("Couldn't save that. Check your internet and try again.");return}
  if(st==="del")reviews=reviews.filter(x=>x!==r);else r.status=st;
  renderReviews();toast(st==="shown"?"Review is on your booking page":st==="hidden"?"Review hidden":"Review deleted");
});

boot();

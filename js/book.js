// Public booking page: book.html?b=<booking-link-name>
const QS=new URLSearchParams(location.search);
const slug=(QS.get("b")||"").toLowerCase(),RID=QS.get("r"),REVIEW=QS.has("review");
const bk={service:null,date:null,time:null};
let mine=null,moving=false; // the client's own booking, when they open their change-or-cancel link
const MAX_AHEAD=90;let calOffset=0,biz=null,busy=[],busyFor=null,sending=false;
const toMin=t=>{const [h,m]=String(t).split(":").map(Number);return h*60+(m||0)};

function message(html){$("bookMsgView").innerHTML=html;$("bookMsgView").hidden=false;$("bookView").hidden=true}

async function bootBook(){
  if(!HB_READY){showNotReady($("bookMsgView"));return}
  if(!slug){message(`<div class="card"><h2>Link incomplete</h2><p class="note full">This booking link is missing the business name. Ask the business to send you their full link.</p></div>`);return}
  const {data,error}=await sb.rpc("public_business",{p_slug:slug});
  if(error){message(`<div class="card"><h2>Couldn't load</h2><p class="note full">Check your internet connection and refresh the page.</p></div>`);return}
  if(!data||!data.length){message(`<div class="card"><h2>Business not found</h2><p class="note full">We couldn't find a business taking online bookings at this link. It may have changed. Ask them for their new link.</p></div>`);return}
  biz=data[0];const p=biz.profile||{};
  state={settings:{...DEFAULT_SETTINGS,...(p.settings||{})},services:p.services||[],specials:p.specials||[],gallery:p.gallery||[],items:[],clients:[],queue:[]};
  if(REVIEW){showReviewForm();return}
  document.title=state.settings.name+" · Book online";
  $("bookMsgView").hidden=true;$("bookView").hidden=false;
  applyTerms();
  $("bkGallery").hidden=!state.gallery.length;
  $("bkGallery").innerHTML=state.gallery.map((src,k)=>`<img src="${src}" alt="${esc(state.settings.name)} work, photo ${k+1}" loading="lazy">`).join("");
  if(RID)await loadMine();
  renderBook();loadReviews();
}
const linkFor=id=>location.origin+location.pathname+"?b="+encodeURIComponent(slug)+"&r="+id;
function newUuid(){if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=[...b].map(x=>x.toString(16).padStart(2,"0")).join("");return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`}

// ---------- deposit ----------
function payBox(){
  const S=state.settings,dep=+S.deposit,l=safeUrl(S.payLink);if(!dep||(!l&&!S.payDetails))return "";
  return `<div class="paybox"><strong>Pay your ${money(dep)} deposit to hold your slot</strong>${l?`<a class="btnlink primary" target="_blank" rel="noopener" href="${esc(l)}">Pay the deposit</a>`:""}${S.payDetails?`<span>Bank transfer: ${esc(S.payDetails)}</span>`:""}<span class="note">It comes off your bill.</span></div>`;
}

// ---------- the client's own booking: change or cancel ----------
async function loadMine(){
  const {data}=await sb.rpc("my_booking",{p_id:RID});
  mine=data&&data[0]||null;
  if(mine&&mine.status==="cancelled"&&mine.moved_to){location.replace(linkFor(mine.moved_to));return}
  renderMine();
}
function renderMine(){
  const S=state.settings,box=$("bkManage"),wa=waNumber(S.whatsapp);
  const flow=!mine||moving||mine.status==="cancelled"||mine.status==="cancel_seen"||mine.status==="declined";
  ["bkSvcSection","bkDaySection","bkTimeSection","bkForm","bkSpecials"].forEach(id=>{if(!flow)$(id).hidden=true});
  if(!mine){box.hidden=false;box.innerHTML=`<h2>Booking not found</h2><p class="note">We couldn't find that booking. You can book a new time below.</p>`;return}
  box.hidden=false;
  const when=`${dateObj(mine.date).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})} at ${to12(mine.time)}`;
  if(mine.status==="cancelled"||mine.status==="cancel_seen"){box.innerHTML=`<h2>Booking cancelled</h2><p class="note">Your ${esc(mine.service.toLowerCase())} on ${esc(when)} is cancelled. Want a new time? Book below.</p>`;return}
  if(mine.status==="declined"){box.innerHTML=`<h2>That time didn't work</h2><p class="note">${esc(S.name)} couldn't do ${esc(when)}. Pick another time below.</p>`;return}
  if(moving){box.innerHTML=`<h2>Pick a new day and time</h2><p class="note">For your ${esc(mine.service.toLowerCase())}, now on ${esc(when)}.</p><button type="button" id="mvBack">Keep my booking</button>`;return}
  const msg=`Hi ${S.name}, it's about my ${mine.service.toLowerCase()} on ${prettyDate(mine.date)} at ${to12(mine.time)}.`;
  box.innerHTML=`<h2>Your booking</h2>
    <div class="msg" style="user-select:text">${esc(mine.service)} on ${esc(when)} · ${money(mine.price)}<br><b>${mine.status==="accepted"?"Confirmed":`Waiting for ${esc(S.name)} to confirm`}</b></div>
    ${payBox()}
    ${mine.can_change?`<div class="btns"><button type="button" class="primary" id="mvStart">Change day or time</button><button type="button" class="danger" id="mvCancel">Cancel booking</button></div>`
      :`<p class="note">It's too close to your booking to change it here. Message ${esc(S.name)} instead.</p>`}
    ${wa?`<a class="btnlink" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}">Message ${esc(S.name)} on WhatsApp</a>`:""}`;
}
const managing=()=>!!(mine&&["new","accepted"].includes(mine.status)&&!moving);
let cancelArmed=0;
$("bkManage").addEventListener("click",async e=>{
  const b=e.target.closest("button");if(!b)return;
  if(b.id==="mvStart"){moving=true;bk.service=mine.service;bk.date=null;bk.time=null;$("bkSvcSection").hidden=true;["bkDaySection","bkTimeSection","bkForm"].forEach(id=>$(id).hidden=false);renderMine();renderBook();$("bkDaySection").scrollIntoView({behavior:"smooth"});return}
  if(b.id==="mvBack"){moving=false;renderMine();return}
  if(b.id==="mvCancel"){
    if(Date.now()-cancelArmed>4000){cancelArmed=Date.now();b.textContent="Tap again to cancel";setTimeout(()=>{if(b.isConnected)b.textContent="Cancel booking"},4000);return}
    b.disabled=true;const {data,error}=await sb.rpc("cancel_my_booking",{p_id:RID});
    if(error||!data){b.disabled=false;toast(error?"That didn't go through. Check your internet and try again.":"It's too late to cancel online. Message them instead.");await loadMine();return}
    mine.status="cancelled";["bkSvcSection","bkDaySection","bkTimeSection","bkForm"].forEach(id=>$(id).hidden=false);renderMine();renderBook();toast("Booking cancelled");
  }
});

async function loadBusy(date){
  busyFor=date;busy=[];
  const {data}=await sb.rpc("busy_slots",{p_slug:slug,p_date:date});
  if(busyFor===date){busy=data||[];renderBook()}
}
function isTaken(t){
  const s=toMin(t),e=s+(bk.service?minsOf(bk.service):30);
  return busy.some(b=>{const bs=toMin(b.slot_time),be=bs+(+b.mins||30);return bs<e&&s<be});
}

function renderCal(){
  const S=state.settings,m=new Date(now.getFullYear(),now.getMonth()+calOffset,1),last=addDays(MAX_AHEAD);
  $("calLabel").textContent=m.toLocaleDateString("en-GB",{month:"long",year:"numeric"});
  $("calPrev").disabled=calOffset<=0;
  $("calNext").disabled=iso(new Date(m.getFullYear(),m.getMonth()+1,1))>last;
  let h=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<span class="dow">${d}</span>`).join("");
  const lead=(m.getDay()+6)%7;for(let k=0;k<lead;k++)h+="<span></span>";
  const dim=new Date(m.getFullYear(),m.getMonth()+1,0).getDate();
  for(let d=1;d<=dim;d++){const dt=new Date(m.getFullYear(),m.getMonth(),d),ds=iso(dt);
    const closed=!S.openDays.includes(dt.getDay())||!!offOn(S,ds),off=ds<TODAY||ds>last||closed;
    h+=`<button type="button" data-day="${ds}" aria-pressed="${bk.date===ds}"${off?" disabled":""}${ds===TODAY?' class="today"':""} aria-label="${dt.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}${closed?", closed":""}">${d}</button>`}
  $("calGrid").innerHTML=h;
  $("bkDayNote").textContent=bk.date?"You picked "+dateObj(bk.date).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})+".":"Crossed-out days are closed. You can book up to 3 months ahead.";
}
function renderBook(){
  const S=state.settings;
  $("bizName").textContent=S.name;$("bizArea").textContent=S.area;
  const sp=state.specials.filter(live);
  $("bkSpecials").hidden=!sp.length||managing()||moving;
  $("bkSpecials").innerHTML=`<strong>Specials</strong>`+sp.map(s=>`<span><b>${esc(s.name)}:</b> ${esc(specialText(s))}</span>`).join("");
  $("bkServices").innerHTML=allServices().filter(s=>+s.price>0).map(s=>`<button type="button" class="choice" data-sv="${esc(s.name)}" aria-pressed="${bk.service===s.name}"><span>${esc(s.name)}</span><b>${money(s.price)}</b><small>${s.bundle?esc(s.includes.join(" + ")):s.mins+" min"}</small></button>`).join("")||`<p class="note">This business hasn't added any services yet.</p>`;
  renderCal();
  const len=bk.service?minsOf(bk.service):30,nowM=now.getHours()*60+now.getMinutes();
  const busyM=busy.map(b=>({start:toMin(b.slot_time),mins:+b.mins||30}));
  // Grid times show even when taken (crossed out); extra times after a booking only show when free.
  const grid=bk.date?startTimes({...S,breakFrom:0,breakTo:0},dateObj(bk.date).getDay(),len,[]):[];
  const times=!bk.date?[]:startTimes(S,dateObj(bk.date).getDay(),len,busyM).filter(m=>!(bk.date===TODAY&&m<=nowM)).map(m=>pad(Math.floor(m/60))+":"+pad(m%60)).filter(t=>grid.includes(toMin(t))||!isTaken(t));
  if(bk.time&&(isTaken(bk.time)||!times.includes(bk.time)))bk.time=null;
  const loading=bk.date&&busyFor===bk.date&&!busy.length&&false;
  $("bkTimes").innerHTML=!bk.date?`<span class="note">Pick a day first.</span>`:times.length?times.map(t=>{const taken=isTaken(t);return `<button type="button" class="chip" data-time="${t}" aria-pressed="${bk.time===t}"${taken?` disabled aria-label="${to12(t)}, taken"`:""}>${to12(t)}</button>`}).join(""):`<span class="note">No times left on this day. Try another day.</span>`;
  $("bkTimeNote").textContent=bk.date&&busy.length?"Crossed-out times are already booked.":"";
  const dep=+S.deposit;
  $("bkFoot").textContent=moving?"Your old time is let go once you move.":(S.instant?`You're booked as soon as you tap the button. ${S.name} will message you on WhatsApp.`:`${S.name} will confirm on WhatsApp.`)+(dep?` A ${money(dep)} deposit holds your slot and comes off your bill.`:"");
  $("bkFormTitle").textContent=moving?"4. Move your booking":"4. Your details";$("bkDetails").hidden=moving;
  if(!sending)$("bkSend").textContent=moving?"Move my booking":S.instant?"Book now":"Request this booking";
  updateMsg();
}
function quote(){const base=priceOf(bk.service),sp=bestSpecial(bk.service,bk.date);return{base,sp,price:sp?base-discAmt(sp,base):base}}
function updateMsg(){
  const ready=bk.service&&bk.date&&bk.time;
  if(!ready){$("bkMsg").textContent="Pick a service, day and time.";$("bkSend").disabled=true;return}
  if(moving){$("bkMsg").textContent=`Move to ${dateObj(bk.date).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})} at ${to12(bk.time)}. Price stays ${money(mine.price)}.`;$("bkSend").disabled=false;return}
  const q=quote();
  $("bkMsg").textContent=`${bk.service} on ${dateObj(bk.date).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})} at ${to12(bk.time)}. Price: ${money(q.price)}${q.sp?` with the ${q.sp.name} special (normally ${money(q.base)})`:""}.`;
  $("bkSend").disabled=false;
}
$("bookView").addEventListener("click",e=>{
  const b=e.target.closest("button");if(!b||b.disabled)return;
  if(b.dataset.sv)bk.service=b.dataset.sv;
  else if(b.dataset.day){bk.date=b.dataset.day;bk.time=null;renderBook();loadBusy(bk.date);return}
  else if(b.dataset.time)bk.time=b.dataset.time;
  else return;
  renderBook();
});
$("calPrev").addEventListener("click",()=>{if(calOffset>0){calOffset--;renderCal()}});
$("calNext").addEventListener("click",()=>{calOffset++;renderCal()});
$("bkSend").addEventListener("click",async()=>{
  if(sending)return;
  const name=$("bkName").value.trim(),phone=$("bkPhone").value.trim(),note=$("bkNote").value.trim();
  const err=m=>{$("bkErr").textContent=m;$("bkErr").hidden=!m};
  if(moving){
    sending=true;$("bkSend").disabled=true;$("bkSend").textContent="Moving…";
    const {data,error}=await sb.rpc("move_my_booking",{p_id:RID,p_date:bk.date,p_time:bk.time});
    sending=false;$("bkSend").disabled=false;
    if(error||!data){err(error?"That didn't go through. Check your internet and try again.":"It's too late to change this booking online. Message them instead.");renderBook();return}
    location.replace(linkFor(data));return;
  }
  if(!name){err("Add your name so they know who's booking.");$("bkName").focus();return}
  if(waNumber(phone).length<7){err("Add your WhatsApp number so they can confirm.");$("bkPhone").focus();return}
  err("");sending=true;$("bkSend").disabled=true;$("bkSend").textContent="Sending…";
  const q=quote(),id=newUuid();
  const {error}=await sb.from("booking_requests").insert({id,business_id:biz.id,name,phone,service:bk.service,date:bk.date,time:bk.time,price:q.price,special:q.sp?q.sp.name:null,note:note||null});
  sending=false;$("bkSend").textContent=state.settings.instant?"Book now":"Request this booking";
  if(error){$("bkSend").disabled=false;err("That didn't go through. Check your internet and try again.");return}
  const S=state.settings,when=`${prettyDate(bk.date)} at ${to12(bk.time)}`;
  const text=`Hi ${S.name}, I just ${S.instant?"booked":"requested"} a ${bk.service.toLowerCase()} on ${when} through your booking link. My name is ${name}.`;
  const wa=waNumber(S.whatsapp),mlink=linkFor(id);
  $("bkForm").hidden=true;
  $("bkDone").hidden=false;
  $("bkDone").innerHTML=`<strong>${S.instant?"You're booked":"Request sent"}</strong><span>${esc(bk.service)} on ${esc(when)}. ${S.instant?`${esc(S.name)} will message you on WhatsApp.`:`${esc(S.name)} will confirm with you on WhatsApp.`}</span>${payBox()}
  <span class="note">Need to change or cancel later? Save this link: <a href="${esc(mlink)}">${esc(mlink)}</a></span>
  ${wa?`<a class="btnlink${payBox()?"":" primary"}" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(text)}">Message ${esc(S.name)} on WhatsApp</a>`:""}<button type="button" id="bkAgain">Book something else</button>`;
  $("bkAgain").addEventListener("click",()=>{bk.service=bk.date=bk.time=null;$("bkDone").hidden=true;$("bkForm").hidden=false;renderBook();window.scrollTo(0,0)});
  $("bkDone").scrollIntoView({behavior:"smooth",block:"center"});
});

// ---------- reviews ----------
let allReviews=[];
async function loadReviews(){
  const {data,error}=await sb.rpc("public_reviews",{p_slug:slug});
  if(error||!data||!data.length)return;
  allReviews=data;const avg=sum(data,r=>r.stars)/data.length;
  $("bizStars").hidden=false;$("bizStars").textContent=`★ ${avg.toFixed(1)} from ${data.length} review${data.length>1?"s":""}`;
  renderReviews(5);
}
function renderReviews(n){
  $("bkReviews").hidden=false;
  $("revList").innerHTML=allReviews.slice(0,n).map(r=>`<div class="rev"><span class="starline" aria-label="${r.stars} out of 5 stars">${stars(r.stars)}</span>${r.body?`<span>${esc(r.body)}</span>`:""}<b>${esc(r.name)}</b></div>`).join("");
  $("revMore").hidden=allReviews.length<=n;
}
$("revMore").addEventListener("click",()=>renderReviews(allReviews.length));

let revStars=0,revSending=false;
function showReviewForm(){
  document.title="Review "+state.settings.name;
  $("bookMsgView").hidden=true;$("reviewView").hidden=false;
  $("revBiz").textContent=state.settings.name;
  $("revBook").href=location.pathname+"?b="+encodeURIComponent(slug);
}
$("revStars").addEventListener("click",e=>{const b=e.target.closest("[data-star]");if(!b)return;revStars=+b.dataset.star;$("revStars").querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",+x.dataset.star<=revStars))});
$("revSend").addEventListener("click",async()=>{
  if(revSending)return;
  const name=$("revName").value.trim(),body=$("revBody").value.trim(),err=m=>{$("revErr").textContent=m;$("revErr").hidden=!m};
  if(!revStars){err("Tap the stars to give a rating.");return}
  if(!name){err("Add your first name.");$("revName").focus();return}
  err("");revSending=true;$("revSend").disabled=true;$("revSend").textContent="Sending…";
  const {error}=await sb.from("reviews").insert({business_id:biz.id,name,stars:revStars,body:body||null});
  revSending=false;$("revSend").disabled=false;$("revSend").textContent="Send my review";
  if(error){err("That didn't go through. Check your internet and try again.");return}
  $("revForm").hidden=true;$("revDone").hidden=false;
});

bootBook();

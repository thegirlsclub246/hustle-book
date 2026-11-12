// Public booking page: book.html?b=<booking-link-name>
const slug=(new URLSearchParams(location.search).get("b")||"").toLowerCase();
const bk={service:null,date:null,time:null};
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
  state={settings:{...DEFAULT_SETTINGS,...(p.settings||{})},services:p.services||[],specials:p.specials||[],items:[],clients:[],queue:[]};
  document.title=state.settings.name+" · Book online";
  $("bookMsgView").hidden=true;$("bookView").hidden=false;
  applyTerms();renderBook();
}

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
    const closed=!S.openDays.includes(dt.getDay()),off=ds<TODAY||ds>last||closed;
    h+=`<button type="button" data-day="${ds}" aria-pressed="${bk.date===ds}"${off?" disabled":""}${ds===TODAY?' class="today"':""} aria-label="${dt.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})}${closed?", closed":""}">${d}</button>`}
  $("calGrid").innerHTML=h;
  $("bkDayNote").textContent=bk.date?"You picked "+dateObj(bk.date).toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})+".":"Crossed-out days are closed. You can book up to 3 months ahead.";
}
function renderBook(){
  const S=state.settings;
  $("bizName").textContent=S.name;$("bizArea").textContent=S.area;
  const sp=state.specials.filter(live);
  $("bkSpecials").hidden=!sp.length;
  $("bkSpecials").innerHTML=`<strong>Specials</strong>`+sp.map(s=>`<span><b>${esc(s.name)}:</b> ${esc(specialText(s))}</span>`).join("");
  $("bkServices").innerHTML=allServices().filter(s=>+s.price>0).map(s=>`<button type="button" class="choice" data-sv="${esc(s.name)}" aria-pressed="${bk.service===s.name}"><span>${esc(s.name)}</span><b>${money(s.price)}</b><small>${s.bundle?esc(s.includes.join(" + ")):s.mins+" min"}</small></button>`).join("")||`<p class="note">This business hasn't added any services yet.</p>`;
  renderCal();
  const times=[];
  const [o,c]=bk.date?hoursOn(S,dateObj(bk.date).getDay()):[+S.open,+S.close],len=bk.service?minsOf(bk.service):30;
  for(let m=o*60;m+Math.min(len,c*60-o*60)<=c*60;m+=30){if(bk.date===TODAY&&m<=now.getHours()*60+now.getMinutes())continue;times.push(pad(Math.floor(m/60))+":"+pad(m%60))}
  if(bk.time&&(isTaken(bk.time)||!times.includes(bk.time)))bk.time=null;
  const loading=bk.date&&busyFor===bk.date&&!busy.length&&false;
  $("bkTimes").innerHTML=!bk.date?`<span class="note">Pick a day first.</span>`:times.length?times.map(t=>{const taken=isTaken(t);return `<button type="button" class="chip" data-time="${t}" aria-pressed="${bk.time===t}"${taken?` disabled aria-label="${to12(t)}, taken"`:""}>${to12(t)}</button>`}).join(""):`<span class="note">No times left today. Try another day.</span>`;
  $("bkTimeNote").textContent=bk.date&&busy.length?"Crossed-out times are already booked.":"";
  const dep=+S.deposit;
  $("bkFoot").textContent=`${S.name} will confirm on WhatsApp.`+(dep?` A ${money(dep)} deposit by bank transfer holds your slot and comes off your bill.`:"");
  updateMsg();
}
function quote(){const base=priceOf(bk.service),sp=bestSpecial(bk.service,bk.date);return{base,sp,price:sp?base-discAmt(sp,base):base}}
function updateMsg(){
  const ready=bk.service&&bk.date&&bk.time;
  if(!ready){$("bkMsg").textContent="Pick a service, day and time.";$("bkSend").disabled=true;return}
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
  if(!name){err("Add your name so they know who's booking.");$("bkName").focus();return}
  if(waNumber(phone).length<7){err("Add your WhatsApp number so they can confirm.");$("bkPhone").focus();return}
  err("");sending=true;$("bkSend").disabled=true;$("bkSend").textContent="Sending…";
  const q=quote();
  const {error}=await sb.from("booking_requests").insert({business_id:biz.id,name,phone,service:bk.service,date:bk.date,time:bk.time,price:q.price,special:q.sp?q.sp.name:null,note:note||null});
  sending=false;$("bkSend").textContent="Request this booking";
  if(error){$("bkSend").disabled=false;err("That didn't go through. Check your internet and try again.");return}
  const S=state.settings,when=`${prettyDate(bk.date)} at ${to12(bk.time)}`;
  const text=`Hi ${S.name}, I just requested a ${bk.service.toLowerCase()} on ${when} through your booking link. My name is ${name}.`;
  const wa=waNumber(S.whatsapp);
  $("bkForm").hidden=true;
  $("bkDone").hidden=false;
  $("bkDone").innerHTML=`<strong>Request sent</strong><span>${esc(bk.service)} on ${esc(when)}. ${esc(S.name)} will confirm with you on WhatsApp.</span>${wa?`<a class="btnlink primary" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${encodeURIComponent(text)}">Message ${esc(S.name)} on WhatsApp</a>`:""}<button type="button" id="bkAgain">Book something else</button>`;
  $("bkAgain").addEventListener("click",()=>{bk.service=bk.date=bk.time=null;$("bkDone").hidden=true;$("bkForm").hidden=false;renderBook();window.scrollTo(0,0)});
  $("bkDone").scrollIntoView({behavior:"smooth",block:"center"});
});

bootBook();

// ---------- messages ----------
function copyText(text,box){
  if(box){box.textContent=text;box.hidden=false}
  try{navigator.clipboard.writeText(text).then(()=>toast("Message copied. Paste it in WhatsApp."),()=>toast("Select the message and copy it"))}catch(e){toast("Select the message and copy it")}
}
// Opens WhatsApp with the message ready to send. Falls back to copying when there's no number.
function sendWa(phone,text,box){
  const url=waLink(phone,text);
  if(!url){copyText(text,box);return false}
  if(box)box.hidden=true;
  window.open(url,"_blank","noopener");return true;
}
const phoneOf=b=>b.phone||(findClient(b.name)||{}).phone||"";
const manageLink=id=>BOOK_LINK+"&r="+id;
const reviewLink=()=>BOOK_LINK+"&review=1";
function bookingReminder(b){
  const when=b.date===TODAY?"today":b.date===addDays(1)?"tomorrow":"on "+prettyDate(b.date);
  let t=`Hi ${first(b.name)}, just a reminder you're booked with ${state.settings.name} ${when} at ${to12(b.time)} for a ${b.service.toLowerCase()} (${money(b.price)}).`;
  const dep=+state.settings.deposit;if(dep&&!b.deposit)t+=` To hold your slot, please send the ${money(dep)} deposit ${depositHow(state.settings)}.`;
  return t+(b.req?` Need to change or cancel? Use this link: ${manageLink(b.req)}`:" Reply if you need to change the time.")+" See you then!";
}
function paymentReminder(b){return `Hi ${first(b.name)}, hope you good. Just a reminder about the ${money(owedAmt(b))} for the ${b.service.toLowerCase()} on ${prettyDate(b.date)}. You can send it ${depositHow(state.settings)}, or bring cash next time. Thanks!`}
function reviewMsg(b){return `Hi ${first(b.name)}, thanks for coming to ${state.settings.name}! If you have a minute, a quick review really helps my business: ${reviewLink()}`}
function comeBackMsg(c,s){
  const days=daysBetween(s.last,TODAY),w=Math.round(days/7);
  let t=`Hi ${first(c.name)}, it's been ${w>=2?w+" weeks":days+" days"} since your last ${(s.usual||"visit").toLowerCase()} at ${state.settings.name}. Want me to hold a spot for you this week? Pick a time here: ${BOOK_LINK}`;
  const l=loyalty(c);if(l&&l.due)t+=` Your next visit is ${rewardWord()} with your loyalty card.`;else if(l&&l.need-l.stamps<=2)t+=` You're ${l.need-l.stamps} visit${l.need-l.stamps>1?"s":""} away from a ${rewardWord()} one.`;
  return t;
}

// ---------- rendering ----------
const STATUS={booked:["Booked","p-booked"],paid:["Paid","p-paid"],owed:["Owes","p-owed"],noshow:["No-show","p-noshow"],cancelled:["Cancelled","p-noshow"]};
function rowHTML(b,opts={}){
  let [lbl,cls]=STATUS[b.status];
  if(b.status==="paid"&&b.method)lbl+=" · "+b.method;
  const tags=[];
  if(b.special)tags.push(`<span class="tag">${esc(b.special)}</span>`);
  if(b.reward)tags.push(`<span class="tag gold">Loyalty reward</span>`);
  if(b.deposit)tags.push(`<span class="tag">${b.status==="noshow"?"Deposit kept":"Deposit in"} ${money(b.deposit)}</span>`);
  if(b.status==="owed"&&b.deposit)tags.push(`<span class="tag gold">Balance ${money(owedAmt(b))}</span>`);
  if(b.status==="booked"&&b.reminded)tags.push(`<span class="tag">Reminded</span>`);
  if(b.status==="cancelled")tags.push(`<span class="tag gold">Client cancelled</span>`);
  let a="";const id=b.id,wa=waNumber(phoneOf(b)).length>=10;
  if(b.status==="booked"){
    a=`<button data-a="paid" data-id="${id}">Paid</button><button data-a="owed" data-id="${id}">Done, owes</button><button data-a="noshow" data-id="${id}">No-show</button>`;
    if(+state.settings.deposit&&!b.deposit)a+=`<button data-a="dep" data-id="${id}">Deposit in</button>`;
    if(b.date>=TODAY)a+=`<button data-a="remind" data-id="${id}"${b.date===addDays(1)&&!b.reminded?' class="primary"':""}>${wa?"Remind on WhatsApp":"Reminder"}</button>`;
  }else if(b.status==="owed")a=`<button data-a="paid" data-id="${id}">Mark paid</button><button data-a="payrem" data-id="${id}">${wa?"Payment reminder on WhatsApp":"Payment reminder"}</button>`;
  else if(b.status==="paid")a=METHODS.map(m=>`<button class="chip" data-a="method" data-m="${m}" data-id="${id}" aria-pressed="${b.method===m}">${m}</button>`).join("")+`<button data-a="review" data-id="${id}">${b.reviewAsked?"Asked for review ✓":"Ask for a review"}</button><button data-a="booked" data-id="${id}">Undo</button>`;
  else a=`<button data-a="booked" data-id="${id}">Undo</button>`;
  a+=`<button data-a="del" data-id="${id}" class="danger">Remove</button>`;
  const c=findClient(b.name);
  const note=c&&c.notes&&!opts.showDate?`<em class="cnote">${esc(c.notes)}</em>`:"";
  return `<div class="row${opts.showDate&&b.date===addDays(1)&&b.status==="booked"?" tomorrow":""}"><div class="time">${opts.showDate?(b.date===addDays(1)?"Tmrw":prettyDate(b.date).split(" ").slice(0,2).join(" ")):to12(b.time)}</div>
  <div class="who"><strong>${esc(b.name)}</strong><span>${esc(b.service)}${opts.showDate?" · "+to12(b.time):""}</span>${note}</div>
  <div class="right"><span class="price">${b.discount?`<s>${money(b.base)}</s>`:""}${money(b.price)}</span><span class="pill ${cls}">${lbl}</span></div>
  ${tags.length?`<div class="tags">${tags.join("")}</div>`:""}<div class="actions">${a}</div><div class="msg" hidden></div></div>`;
}
const sorted=()=>state.items.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
function weekStart(){const d=new Date(now);d.setDate(d.getDate()-(d.getDay()+6)%7);return iso(d)}

function serviceOptions(withBundles=true){
  let h=state.services.map(s=>`<option value="${esc(s.name)}">${esc(s.name)} · ${money(s.price)}</option>`).join("");
  const b=bundles();if(withBundles&&b.length)h+=`<optgroup label="Bundles">${b.map(s=>`<option value="${esc(s.name)}">${esc(s.name)} · ${money(s.price)}</option>`).join("")}</optgroup>`;
  return h;
}
function fillSelect(el,html){const v=el.value;el.innerHTML=html;if([...el.options].some(o=>o.value===v))el.value=v}

function renderToday(){
  const items=sorted(),ws=weekStart();
  const wk=items.filter(i=>i.date>=ws&&i.date<=TODAY);
  $("sEarn").textContent=money(sum(wk,collected));
  $("sOwed").textContent=money(sum(items,owedAmt));
  $("sNs").textContent=wk.filter(i=>i.status==="noshow").length;
  // queue
  let wait=0;
  $("qList").innerHTML=state.queue.length?state.queue.map((q,k)=>{const w=wait;wait+=minsOf(q.service);const c=findClient(q.name);
    return `<div class="row"><div class="time">#${k+1}</div><div class="who"><strong>${esc(q.name)}</strong><span>${esc(q.service)} · ${k===0?"next up":"about "+w+" min wait"}</span>${c&&c.notes?`<em class="cnote">${esc(c.notes)}</em>`:""}</div><div class="right"><span class="price">${money(priceOf(q.service))}</span></div>
    <div class="actions"><button class="primary" data-q="start" data-id="${q.id}">Start now</button><button data-q="up" data-id="${q.id}"${k===0?" disabled":""}>Move up</button><button data-q="rm" data-id="${q.id}" class="danger">Left</button></div></div>`}).join(""):`<div class="empty">Nobody waiting. Add walk-ins below.</div>`;
  $("qWait").textContent=state.queue.length?`${state.queue.length} waiting · about ${wait} min of work`:"";
  // tomorrow's reminders
  const tm=items.filter(i=>i.date===addDays(1)&&i.status==="booked"),sent=tm.filter(i=>i.reminded).length;
  $("remSection").hidden=!tm.length;
  $("remCount").textContent=tm.length?`${sent} of ${tm.length} reminded`:"";
  $("remList").innerHTML=tm.map(b=>{const ph=phoneOf(b),ok=waNumber(ph).length>=10;
    return `<div class="row"><div class="time">${to12(b.time)}</div><div class="who"><strong>${esc(b.name)}</strong><span>${esc(b.service)}${ok?"":" · no WhatsApp number saved"}</span></div>
    <div class="right">${b.reminded?`<span class="pill p-paid">Sent</span>`:""}</div>
    <div class="actions"><button data-a="remind" data-id="${b.id}"${b.reminded?"":' class="primary"'}>${b.reminded?"Send again":ok?"Send on WhatsApp":"Copy reminder"}</button></div><div class="msg" hidden></div></div>`}).join("");
  const t=items.filter(i=>i.date===TODAY);
  $("todayCount").textContent=t.length?`${t.length} booking${t.length>1?"s":""} · ${money(sum(t.filter(i=>i.status!=="noshow"),i=>i.price))} if all pay`:"";
  $("todayList").innerHTML=t.length?t.map(b=>rowHTML(b)).join(""):`<div class="empty">Nothing booked today. Add one below.</div>`;
  const u=items.filter(i=>i.date>TODAY);
  $("upList").innerHTML=u.length?u.map(b=>rowHTML(b,{showDate:true})).join(""):`<div class="empty">No future bookings yet.</div>`;
  $("fDepWrap").hidden=!+state.settings.deposit;
  $("fDepText").textContent=`Deposit of ${money(state.settings.deposit)} received`;
}

function dueBack(){
  const d=+state.settings.comeBack||21;
  return state.clients.map(c=>({c,s:clientStats(c)})).filter(({s})=>s.last&&daysBetween(s.last,TODAY)>=d&&!s.upcoming).sort((a,b)=>a.s.last.localeCompare(b.s.last));
}
let openClient=null;
function renderClients(){
  const due=dueBack();
  $("dueBadge").textContent=due.length;$("dueBadge").hidden=!due.length;
  $("dueNote").textContent=`${state.settings.comeBack}+ days`;
  $("dueList").innerHTML=due.length?due.map(({c,s})=>`<div class="row" style="grid-template-columns:40px 1fr auto">${avatar(c)}<div class="who"><strong>${esc(c.name)}</strong><span>Last in ${daysBetween(s.last,TODAY)} days ago${s.usual?" · usually "+esc(s.usual.toLowerCase()):""}</span></div><button class="primary" data-due="${c.id}">Message</button><div class="msg" hidden></div></div>`).join(""):`<div class="empty">Everyone's been in recently. Nice.</div>`;
  const q=norm($("clientSearch").value),qd=q.replace(/\D/g,"");
  const cs=state.clients.slice().sort((a,b)=>a.name.localeCompare(b.name)).filter(c=>!q||norm(c.name).includes(q)||(qd&&(c.phone||"").replace(/\D/g,"").includes(qd)));
  $("clientCount").textContent=state.clients.length+" saved";
  $("clientNames").innerHTML=state.clients.map(c=>`<option value="${esc(c.name)}"></option>`).join("");
  $("clientList").innerHTML=cs.length?cs.map(c=>{const s=clientStats(c),l=loyalty(c),open=openClient===c.id;
    return `<div><button type="button" class="crow" data-open="${c.id}" aria-expanded="${open}">${avatar(c)}<span class="who"><strong>${esc(c.name)}</strong><span>${s.visits} visit${s.visits===1?"":"s"}${s.usual?" · usually "+esc(s.usual.toLowerCase()):""}${l&&l.due?" · reward due":""}</span></span></button>
    ${open?`<div class="cdetail">
      <div class="note">${c.phone?esc(c.phone)+" · ":""}${money(s.spent)} paid in total${s.last?" · last visit "+prettyDate(s.last):""}${s.noshows?" · "+s.noshows+" no-show"+(s.noshows>1?"s":""):""}</div>
      ${l?`<div class="hint">${stampsHTML(l)}<span>${l.due?`Next visit is <strong>${rewardWord()}</strong>`:`${l.need-l.stamps} more to a ${rewardWord()} visit`}</span></div>`:""}
      <label>Notes<textarea id="note-${c.id}" data-note="${c.id}" rows="3" placeholder="e.g. Low fade, #2 on top, sensitive skin">${esc(c.notes)}</textarea></label>
      ${c.photo?`<img class="cphoto" src="${c.photo}" alt="Photo for ${esc(c.name)}">`:""}
      <div class="btns"><label class="filebtn">${c.photo?"Change photo":"Add photo"}<input type="file" accept="image/*" data-photo="${c.id}" hidden></label>${c.photo?`<button type="button" data-rmphoto="${c.id}">Remove photo</button>`:""}<button type="button" class="primary" data-bookagain="${c.id}">Book again</button><button type="button" data-invoice="${c.id}">Invoice</button></div>
    </div>`:""}</div>`}).join(""):`<div class="empty">${q?"No client matches that.":"Clients you book are saved here automatically."}</div>`;
}

let monthOffset=0;
function bars(el,map){const ks=Object.keys(map).sort((a,b)=>map[b]-map[a]);const max=Math.max(1,...ks.map(k=>map[k]));
  el.innerHTML=ks.length?ks.map(k=>`<div class="bar"><span>${esc(k)}</span><b>${money(map[k])}</b><div class="track"><div class="fill" style="width:${Math.round(map[k]/max*100)}%"></div></div></div>`).join(""):`<div class="note">Nothing collected this month yet.</div>`}
function renderMoney(){
  const d=new Date(now.getFullYear(),now.getMonth()+monthOffset,1);
  const key=d.getFullYear()+"-"+pad(d.getMonth()+1),label=d.toLocaleDateString("en-GB",{month:"long",year:"numeric"});
  $("mLabel").textContent=label;$("mNext").disabled=monthOffset>=0;
  const m=state.items.filter(i=>i.date.startsWith(key));
  const coll=sum(m,collected),visits=m.filter(done).length,ns=m.filter(i=>i.status==="noshow").length,kept=sum(m.filter(i=>i.status==="noshow"),i=>i.deposit),disc=sum(m.filter(done),i=>i.discount),owed=sum(m,owedAmt);
  $("mColl").textContent=money(coll);$("mVisits").textContent=visits;$("mOwed").textContent=money(owed);$("mNs").textContent=ns;$("mKept").textContent=money(kept);$("mDisc").textContent=money(disc);
  const byM={},byS={};
  m.forEach(i=>{const c=collected(i);if(!c)return;
    if(i.status==="paid"){const k=i.method||"Not recorded";byM[k]=(byM[k]||0)+c}else{byM["Deposits"]=(byM["Deposits"]||0)+c}
    byS[i.service]=(byS[i.service]||0)+c});
  bars($("mMethods"),byM);bars($("mServices"),byS);
  const lines=[`${state.settings.name} · ${label}`,`Collected: ${money(coll)} from ${visits} visit${visits===1?"":"s"}`];
  Object.keys(byM).forEach(k=>lines.push(`  ${k}: ${money(byM[k])}`));
  lines.push(`Still owed: ${money(owed)}`,`No-shows: ${ns} (deposits kept ${money(kept)})`,`Discounts and rewards given: ${money(disc)}`);
  $("mText").textContent=lines.join("\n");$("mText").style.whiteSpace="pre-wrap";
  const o=sorted().filter(i=>i.status==="owed");
  $("owedList").innerHTML=o.length?o.map(b=>rowHTML(b,{showDate:true})).join(""):`<div class="empty">Nobody owes you. Nice.</div>`;
}

function renderServices(){
  $("svcList").innerHTML=state.services.map((s,k)=>`<div class="svcrow"><input aria-label="Service name" data-svc="${k}" data-f="name" value="${esc(s.name)}"><input aria-label="Price" type="number" min="0" data-svc="${k}" data-f="price" value="${s.price}"><input aria-label="Minutes" type="number" min="5" step="5" data-svc="${k}" data-f="mins" value="${s.mins}"><button type="button" class="danger" data-rmsvc="${k}" aria-label="Remove ${esc(s.name)}">✕</button></div>`).join("");
}
function renderSpecials(){
  $("spList").innerHTML=state.specials.length?state.specials.map(s=>`<div class="row" style="grid-template-columns:1fr auto"><div class="who"><strong>${esc(s.name)}</strong><span>${esc(specialText(s))}</span></div><span class="pill ${live(s)?"p-paid":"p-booked"}">${s.active?(live(s)?"On":"Ended"):"Off"}</span>
    <div class="actions"><button data-sp="toggle" data-id="${s.id}">${s.active?"Turn off":"Turn on"}</button><button data-sp="del" data-id="${s.id}" class="danger">Delete</button></div></div>`).join(""):`<div class="empty">No specials yet. Add one below.</div>`;
  fillSelect($("spService"),`<option value="">All services</option>`+state.services.map(s=>`<option value="${esc(s.name)}">${esc(s.name)}</option>`).join(""));
  const chosen=[...$("spIncl").querySelectorAll("input:checked")].map(x=>x.value);
  $("spIncl").innerHTML=state.services.map(s=>`<label class="check"><input type="checkbox" value="${esc(s.name)}"${chosen.includes(s.name)?" checked":""}>${esc(s.name)}</label>`).join("");
}
function fillSettings(){
  const s=state.settings;
  $("setType").innerHTML=Object.entries(TYPES).map(([k,t])=>`<option value="${k}">${t.label}</option>`).join("");$("setType").value=s.type||"barber";
  $("setName").value=s.name;$("setArea").value=s.area;$("setWa").value=s.whatsapp;$("setDep").value=s.deposit;$("setPayLink").value=s.payLink||"";$("setPayDetails").value=s.payDetails||"";$("setInstant").checked=!!s.instant;$("setChange").value=s.changeHours;renderHours();
  $("setLoy").value=s.loyaltyEvery;$("setLoyR").value=s.loyaltyReward;$("setCome").value=s.comeBack;
  $("bookLink").textContent=BOOK_LINK;
}
function renderHours(){
  const s=state.settings;
  const opts=v=>{let h="";for(let m=300;m<=1440;m+=30){const x=m/60;h+=`<option value="${x}"${Math.abs(+v-x)<.01?" selected":""}>${m===1440?"Midnight":to12(hm(x))}</option>`}return h};
  $("setHours").innerHTML=[1,2,3,4,5,6,0].map(d=>{const on=s.openDays.includes(d),[o,c]=hoursOn(s,d),day=DAYNAMES[d].slice(0,-1);
    return `<div class="hrow"><label class="check"><input type="checkbox" data-hday="${d}" data-hf="on"${on?" checked":""} aria-label="Open on ${day}">${day.slice(0,3)}</label><select data-hday="${d}" data-hf="o" aria-label="${day} opens at"${on?"":" disabled"}>${opts(o)}</select><span class="note">to</span><select data-hday="${d}" data-hf="c" aria-label="${day} closes at"${on?"":" disabled"}>${opts(c)}</select></div>`}).join("");
}
function render(){
  fillSelect($("fService"),serviceOptions());fillSelect($("qService"),serviceOptions());
  fillSelect($("invClient"),`<option value="">All clients (statement)</option>`+state.clients.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join(""));
  renderToday();renderClients();renderMoney();renderSpecials();renderInvoice();applyTerms();
}

function toast(m){const t=$("toast");t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2200)}

// ---------- tabs ----------
let tab="today";try{tab=localStorage.getItem(TABKEY)||"today"}catch(e){}
function showTab(t){tab=t;document.querySelectorAll("[data-tab]").forEach(b=>b.setAttribute("aria-selected",b.dataset.tab===t));["today","clients","money","setup"].forEach(k=>$("pane-"+k).hidden=k!==t);try{localStorage.setItem(TABKEY,t)}catch(e){}}
document.querySelector(".tabs").addEventListener("click",e=>{const b=e.target.closest("[data-tab]");if(b){showTab(b.dataset.tab);window.scrollTo(0,0)}});

// ---------- booking actions ----------
document.addEventListener("click",e=>{
  const btn=e.target.closest("button[data-a]");if(!btn)return;
  const id=+btn.dataset.id,a=btn.dataset.a,b=state.items.find(i=>i.id===id);if(!b)return;
  const box=btn.closest(".row").querySelector(".msg");
  if(a==="del"){state.items=state.items.filter(i=>i.id!==id);save();render();toast("Booking removed");return}
  if(a==="remind"){sendWa(phoneOf(b),bookingReminder(b),box);b.reminded=true;save();setTimeout(render,300);return}
  if(a==="payrem"){sendWa(phoneOf(b),paymentReminder(b),box);return}
  if(a==="review"){sendWa(phoneOf(b),reviewMsg(b),box);b.reviewAsked=true;save();setTimeout(render,300);return}
  if(a==="dep"){b.deposit=+state.settings.deposit;save();render();toast(`Deposit of ${money(b.deposit)} recorded`);return}
  if(a==="method"){b.method=b.method===btn.dataset.m?null:btn.dataset.m;save();render();toast(b.method?"Paid by "+b.method.toLowerCase():"Payment method cleared");return}
  if(a==="booked")b.method=null;
  b.status=a;save();render();
  toast({paid:"Marked paid. Tap how they paid if you like.",owed:"Added to who owes you",noshow:b.deposit?"Marked no-show. Deposit kept.":"Marked no-show",booked:"Back to booked"}[a]);
});


// ---------- add booking form ----------
const sel=$("fService"),price=$("fPrice"),fName=$("fName");
function fillSpecials(){
  const list=discountsFor(sel.value,$("fDate").value),cur=$("fSpecial").value,b=bestSpecial(sel.value,$("fDate").value);
  $("fSpecial").innerHTML=`<option value="">No special</option>`+list.map(s=>`<option value="${s.id}">${esc(s.name)} (${s.kind==="percent"?s.value+"% off":money(s.value)+" off"})</option>`).join("");
  $("fSpecial").value=list.some(s=>s.id===cur)?cur:(b?b.id:"");
  $("fSpecialWrap").hidden=!list.length;
}
function recalc(){
  const base=priceOf(sel.value);let p=base;
  if(!$("fRewardWrap").hidden&&$("fReward").checked)p=rewardPrice(base);
  else{const sp=state.specials.find(s=>s.id===$("fSpecial").value);if(sp)p=base-discAmt(sp,base)}
  price.value=p;
}
function onClientName(){
  const c=findClient(fName.value),h=$("fHint");
  $("fRewardWrap").hidden=true;$("fReward").checked=false;
  if(!c){h.hidden=true;fillSpecials();recalc();return}
  const s=clientStats(c),l=loyalty(c);
  if(!$("fPhone").value&&c.phone)$("fPhone").value=c.phone;
  if(s.usual&&allServices().some(x=>x.name===s.usual))sel.value=s.usual;
  h.innerHTML=`${avatar(c)}<span><strong>Returning client</strong> · ${s.visits} visit${s.visits===1?"":"s"}${l?" · "+l.stamps+"/"+l.need+" stamps":""}${c.notes?"<br>"+esc(c.notes):""}</span>`;h.hidden=false;
  if(l&&l.due){$("fRewardWrap").hidden=false;$("fReward").checked=true;$("fRewardText").textContent=`Use loyalty reward: this visit is ${rewardWord()}`}
  fillSpecials();recalc();
}
fName.addEventListener("input",onClientName);
sel.addEventListener("change",()=>{fillSpecials();recalc()});
$("fDate").addEventListener("change",()=>{fillSpecials();recalc()});
$("fSpecial").addEventListener("change",recalc);
$("fReward").addEventListener("change",recalc);
function resetForm(){$("addForm").reset();$("fDate").value=TODAY;$("fHint").hidden=true;$("fRewardWrap").hidden=true;fillSpecials();recalc()}
$("addForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=fName.value.trim(),phone=$("fPhone").value.trim(),base=priceOf(sel.value),p=+price.value||0;
  const reward=!$("fRewardWrap").hidden&&$("fReward").checked,sp=state.specials.find(s=>s.id===$("fSpecial").value);
  upsertClient(name,phone);
  state.items.push({id:uid++,name,phone,service:sel.value,base,price:p,discount:Math.max(0,base-p),special:reward?"":(sp&&p<base?sp.name:(bundles().some(b=>b.name===sel.value)?sel.value:"")),reward,deposit:$("fDep").checked&&!$("fDepWrap").hidden?+state.settings.deposit:0,date:$("fDate").value,time:$("fTime").value,status:"booked",method:null});
  save();render();resetForm();toast("Booking added");
});

// ---------- walk-in queue ----------
$("qForm").addEventListener("submit",e=>{e.preventDefault();state.queue.push({id:newId("q"),name:$("qName").value.trim(),service:$("qService").value});$("qName").value="";save();render();toast("Added to the queue")});
$("qList").addEventListener("click",e=>{
  const b=e.target.closest("[data-q]");if(!b)return;const k=state.queue.findIndex(q=>q.id===b.dataset.id);if(k<0)return;const q=state.queue[k];
  if(b.dataset.q==="rm"){state.queue.splice(k,1);toast(`${q.name} removed from the queue`)}
  else if(b.dataset.q==="up"&&k>0){state.queue.splice(k,1);state.queue.splice(k-1,0,q)}
  else if(b.dataset.q==="start"){
    const base=priceOf(q.service),c=findClient(q.name),l=c?loyalty(c):null,sp=bestSpecial(q.service,TODAY);
    let p=base,special="",reward=false;if(l&&l.due){p=rewardPrice(base);reward=true}else if(sp){p=base-discAmt(sp,base);special=sp.name}
    upsertClient(q.name,"");
    state.items.push({id:uid++,name:q.name,phone:c?c.phone:"",service:q.service,base,price:p,discount:base-p,special,reward,deposit:0,date:TODAY,time:pad(now.getHours())+":"+pad(now.getMinutes()),status:"booked",method:null});
    state.queue.splice(k,1);toast(`${q.name} is in the chair`+(reward?" (loyalty reward applied)":""));
  }
  save();render();
});

// ---------- clients ----------
$("dueList").addEventListener("click",e=>{const b=e.target.closest("[data-due]");if(!b)return;const c=state.clients.find(x=>x.id===b.dataset.due);if(c)sendWa(c.phone,comeBackMsg(c,clientStats(c)),b.closest(".row").querySelector(".msg"))});
function shrink(file){return new Promise((res,rej)=>{const r=new FileReader();r.onerror=rej;r.onload=()=>{const img=new Image();img.onerror=rej;img.onload=()=>{const k=Math.min(1,600/Math.max(img.width,img.height));const cv=document.createElement("canvas");cv.width=Math.round(img.width*k);cv.height=Math.round(img.height*k);cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);res(cv.toDataURL("image/jpeg",0.72))};img.src=r.result};r.readAsDataURL(file)})}
$("clientList").addEventListener("click",e=>{const t=e.target.closest("[data-open],[data-rmphoto],[data-bookagain],[data-invoice]");if(!t)return;
  if(t.dataset.invoice){showTab("money");$("invClient").value=t.dataset.invoice;$("invPeriod").value="month";renderInvoice();$("invForm").scrollIntoView({behavior:"smooth",block:"start"});return}
  if(t.dataset.open){openClient=openClient===t.dataset.open?null:t.dataset.open;renderClients();return}
  const c=state.clients.find(x=>x.id===(t.dataset.rmphoto||t.dataset.bookagain));if(!c)return;
  if(t.dataset.rmphoto){c.photo=null;save();render();toast("Photo removed");return}
  showTab("today");fName.value=c.name;$("fPhone").value=c.phone||"";onClientName();$("addForm").scrollIntoView({behavior:"smooth",block:"start"});
});
$("clientList").addEventListener("change",e=>{const t=e.target;
  if(t.dataset.note){const c=state.clients.find(x=>x.id===t.dataset.note);if(c){c.notes=t.value.trim();save();toast("Notes saved");render()}return}
  if(t.dataset.photo&&t.files&&t.files[0]){const c=state.clients.find(x=>x.id===t.dataset.photo);if(!c)return;shrink(t.files[0]).then(url=>{const old=c.photo;c.photo=url;if(!save()){c.photo=old;toast("Not enough space on this device for that photo")}else toast("Photo saved");render()}).catch(()=>toast("Couldn't read that photo. Try a JPG or PNG."))}
});
$("clientSearch").addEventListener("input",renderClients);

// ---------- money ----------
$("mPrev").addEventListener("click",()=>{monthOffset--;renderMoney()});
$("mNext").addEventListener("click",()=>{if(monthOffset<0){monthOffset++;renderMoney()}});
$("mCopy").addEventListener("click",()=>{const t=$("mText").textContent;try{navigator.clipboard.writeText(t).then(()=>toast("Summary copied"),()=>toast("Select the summary and copy it"))}catch(e){toast("Select the summary and copy it")}});

// ---------- setup ----------
const NUMERIC=["deposit","comeBack","loyaltyEvery","open","close","changeHours"];
$("pane-setup").addEventListener("change",e=>{
  const t=e.target;
  if(t.dataset.hday!==undefined){const d=+t.dataset.hday,s=state.settings;
    if(t.dataset.hf==="on")s.openDays=t.checked?[...new Set(s.openDays.concat(d))].sort((a,b)=>a-b):s.openDays.filter(x=>x!==d);
    else{const cur=hoursOn(s,d);cur[t.dataset.hf==="o"?0:1]=+t.value;if(cur[1]<=cur[0]){toast("Closing time has to be after opening time");renderHours();return}s.dayHours={...(s.dayHours||{}),[d]:cur}}
    save();renderHours();toast("Saved");return}
  if(t.dataset.set){const k=t.dataset.set;
    if(k==="payLink"&&t.value.trim()&&!safeUrl(t.value)){toast("Paste the full link, starting with https://");return}
    state.settings[k]=t.type==="checkbox"?t.checked:NUMERIC.includes(k)?Math.max(0,+t.value||0):t.value.trim();save();render();toast("Saved");return}
  if(t.dataset.svc!==undefined){const s=state.services[+t.dataset.svc],f=t.dataset.f;if(!s)return;
    if(f==="name"){const old=s.name,nv=t.value.trim();if(!nv){t.value=old;return}s.name=nv;state.specials.forEach(sp=>{if(sp.service===old)sp.service=nv;if(sp.includes)sp.includes=sp.includes.map(n=>n===old?nv:n)})}
    else s[f]=Math.max(0,+t.value||0);
    save();render();toast("Saved")}
});
$("pane-setup").addEventListener("click",e=>{
  const r=e.target.closest("[data-rmsvc]");if(r){state.services.splice(+r.dataset.rmsvc,1);save();renderServices();render();toast("Service removed");return}
  const s=e.target.closest("[data-sp]");if(s){const k=state.specials.findIndex(x=>x.id===s.dataset.id);if(k<0)return;
    if(s.dataset.sp==="del"){const n=state.specials[k].name;state.specials.splice(k,1);toast(`${n} deleted`)}else{state.specials[k].active=!state.specials[k].active;toast(state.specials[k].active?"Special turned on":"Special turned off")}
    save();render()}
});
$("addSvc").addEventListener("click",()=>{state.services.push({name:"New service "+(state.services.length+1),price:0,mins:30});save();renderServices();render();const ins=$("svcList").querySelectorAll("input[data-f=name]");ins[ins.length-1].select()});
function spKindUI(){const k=$("spKind").value;$("spValueLabel").textContent=k==="percent"?"Percent off":k==="amount"?"Dollars off":"Bundle price ($)";$("spServiceWrap").hidden=k==="bundle";$("spInclWrap").hidden=k!=="bundle"}
$("spKind").addEventListener("change",spKindUI);
$("spForm").addEventListener("submit",e=>{
  e.preventDefault();const kind=$("spKind").value,value=+$("spValue").value;
  const sp={id:newId("s"),name:$("spName").value.trim(),kind,day:+$("spDay").value,ends:$("spEnds").value||"",active:true};
  if(kind==="bundle"){const inc=[...$("spIncl").querySelectorAll("input:checked")].map(x=>x.value);if(inc.length<2){toast("Pick at least two services for a bundle");return}sp.includes=inc;sp.price=value}
  else{if(kind==="percent"&&value>100){toast("Percent off can't be more than 100");return}sp.value=value;sp.service=$("spService").value}
  state.specials.push(sp);save();$("spForm").reset();spKindUI();render();toast("Special added. Clients see it on your booking page.");
});
let wipeArmed=0;
$("wipe").addEventListener("click",()=>{
  if(Date.now()-wipeArmed>4000){wipeArmed=Date.now();$("wipe").textContent="Tap again to clear all bookings and clients";setTimeout(()=>$("wipe").textContent="Clear all bookings and clients",4000);return}
  state.items=[];state.clients=[];state.queue=[];save();render();$("wipe").textContent="Clear all bookings and clients";toast("Bookings and clients cleared");
});
$("copyLink").addEventListener("click",()=>{try{navigator.clipboard.writeText(BOOK_LINK).then(()=>toast("Link copied"),()=>toast("Select the link and copy it"))}catch(e){toast("Select the link and copy it")}});

let typeArmed=0;const TYPE_BTN="Load starter services and prices for this type";
$("typeLoad").addEventListener("click",()=>{
  if(Date.now()-typeArmed>4000){typeArmed=Date.now();$("typeLoad").textContent="Tap again to replace your services list";setTimeout(()=>$("typeLoad").textContent=TYPE_BTN,4000);return}
  typeArmed=0;state.services=T().services.map(s=>({...s}));save();renderServices();render();$("typeLoad").textContent=TYPE_BTN;toast(`Loaded starter prices for ${T().label.toLowerCase()}. Change them to match yours.`);
});

// ---------- invoices ----------
const charge=i=>i.status==="noshow"?(+i.deposit||0):+i.price;
const paidOn=i=>i.status==="paid"?+i.price:Math.min(+i.deposit||0,charge(i));
function invRange(){
  const p=$("invPeriod").value;let from,to;
  if(p==="day"){from=to=$("invDay").value||TODAY}
  else if(p==="month"){from=iso(new Date(now.getFullYear(),now.getMonth(),1));to=iso(new Date(now.getFullYear(),now.getMonth()+1,0))}
  else if(p==="last"){from=iso(new Date(now.getFullYear(),now.getMonth()-1,1));to=iso(new Date(now.getFullYear(),now.getMonth(),0))}
  else{from=$("invFrom").value||TODAY;to=$("invTo").value||TODAY;if(to<from)[from,to]=[to,from]}
  $("invDayWrap").hidden=p!=="day";$("invFromWrap").hidden=$("invToWrap").hidden=p!=="custom";
  return{from,to};
}
function invoiceData(){
  const {from,to}=invRange(),c=state.clients.find(x=>x.id===$("invClient").value)||null;
  let lines=state.items.filter(i=>i.date>=from&&i.date<=to&&(done(i)||(i.status==="noshow"&&+i.deposit))&&(!c||norm(i.name)===norm(c.name)));
  if($("invUnpaid").checked)lines=lines.filter(i=>charge(i)-paidOn(i)>0);
  lines.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const total=sum(lines,charge),paid=sum(lines,paidOn);
  return{c,from,to,lines,total,paid,due:total-paid,disc:sum(lines.filter(done),i=>i.discount),no:`INV-${to.replace(/-/g,"")}-${c?initials(c.name):"ALL"}`};
}
const periodText=d=>d.from===d.to?prettyDate(d.from):prettyDate(d.from)+" to "+prettyDate(d.to);
function lineDesc(i){let s=i.service;if(i.status==="noshow")s+=" (missed, deposit kept)";else if(i.reward)s+=" (loyalty reward)";else if(i.special&&i.special!==i.service)s+=` (${i.special})`;return s}
function renderInvoice(){
  const d=invoiceData(),S=state.settings;
  $("invPreview").innerHTML=`<div class="invhead"><div><div class="brand">${esc(S.name)}</div><div class="note">${esc(S.area)}${S.whatsapp?"<br>WhatsApp "+esc(S.whatsapp):""}</div></div><div style="text-align:right"><div class="kind">${d.c?"INVOICE":"STATEMENT"}</div><div class="note">${d.no}<br>Issued ${prettyDate(TODAY)}</div></div></div>
  <div><div class="note">${d.c?"Bill to":"Covers"}</div><strong>${d.c?esc(d.c.name):"All clients"}</strong>${d.c&&d.c.phone?`<div class="note">${esc(d.c.phone)}</div>`:""}<div class="note">Period: ${periodText(d)}</div></div>
  <div style="overflow-x:auto"><table><thead><tr><th>Date</th>${d.c?"":"<th>Client</th>"}<th>Description</th><th class="num">Amount</th><th class="num">Paid</th></tr></thead><tbody>${d.lines.length?d.lines.map(i=>`<tr><td>${prettyDate(i.date)}</td>${d.c?"":`<td>${esc(i.name)}</td>`}<td>${esc(lineDesc(i))}</td><td class="num">${money(charge(i))}</td><td class="num">${money(paidOn(i))}</td></tr>`).join(""):`<tr><td colspan="5" class="note">Nothing to bill in this period.</td></tr>`}</tbody></table></div>
  <div class="invtotals"><span>Total</span><b>${money(d.total)}</b>${d.disc?`<span class="note">Discounts included</span><span class="note">${money(d.disc)}</span>`:""}<span>Paid</span><b>${money(d.paid)}</b><span class="due">Balance due</span><span class="due">${money(d.due)}</span></div>`;
  return d;
}
function invoiceText(d){
  const S=state.settings,L=[S.name,`${d.c?"Invoice":"Statement"} ${d.no}`,d.c?"For: "+d.c.name:"All clients",`Period: ${periodText(d)}`,""];
  d.lines.forEach(i=>{const pd=paidOn(i),ch=charge(i);L.push(`${prettyDate(i.date)}${d.c?"":" - "+i.name} - ${lineDesc(i)} - ${money(ch)}${pd>=ch?" (paid)":pd?" (paid "+money(pd)+")":" (unpaid)"}`)});
  L.push("",`Total: ${money(d.total)}`,`Paid: ${money(d.paid)}`,`Balance due: ${money(d.due)}`);
  if(d.due>0)L.push("","You can pay by bank transfer or cash. Thank you!");
  return L.join("\n");
}
function invoicePdf(d){
  const {jsPDF}=window.jspdf,doc=new jsPDF({unit:"pt",format:"a4"}),S=state.settings,Lx=48,R=547;let y=60;
  doc.setFont("helvetica","bold");doc.setFontSize(20);doc.text(S.name,Lx,y);doc.setFontSize(15);doc.text(d.c?"INVOICE":"STATEMENT",R,y,{align:"right"});
  doc.setFont("helvetica","normal");doc.setFontSize(10);y+=18;if(S.area)doc.text(S.area,Lx,y);doc.text(d.no,R,y,{align:"right"});
  y+=14;if(S.whatsapp)doc.text("WhatsApp "+S.whatsapp,Lx,y);doc.text("Issued "+prettyDate(TODAY),R,y,{align:"right"});
  y+=34;doc.setTextColor(110);doc.text(d.c?"BILL TO":"COVERS",Lx,y);doc.setTextColor(0);
  y+=16;doc.setFont("helvetica","bold");doc.setFontSize(12);doc.text(d.c?d.c.name:"All clients",Lx,y);doc.setFont("helvetica","normal");doc.setFontSize(10);
  if(d.c&&d.c.phone){y+=14;doc.text(d.c.phone,Lx,y)}y+=14;doc.text("Period: "+periodText(d),Lx,y);
  const cols=d.c?{date:Lx,desc:Lx+90}:{date:Lx,client:Lx+80,desc:Lx+190};
  const head=()=>{y+=30;doc.setFontSize(9);doc.setTextColor(110);doc.text("DATE",cols.date,y);if(cols.client)doc.text("CLIENT",cols.client,y);doc.text("DESCRIPTION",cols.desc,y);doc.text("AMOUNT",R-70,y,{align:"right"});doc.text("PAID",R,y,{align:"right"});doc.setTextColor(0);doc.setFontSize(10);y+=6;doc.setDrawColor(200);doc.line(Lx,y,R,y)};
  head();
  const descW=(R-130)-cols.desc;
  d.lines.forEach(i=>{const desc=doc.splitTextToSize(lineDesc(i),descW);const h=14*desc.length+6;if(y+h>780){doc.addPage();y=40;head()}
    y+=16;doc.text(prettyDate(i.date),cols.date,y);if(cols.client)doc.text(doc.splitTextToSize(i.name,100)[0],cols.client,y);doc.text(desc,cols.desc,y);doc.text(money(charge(i)),R-70,y,{align:"right"});doc.text(money(paidOn(i)),R,y,{align:"right"});y+=14*(desc.length-1)+6;doc.line(Lx,y,R,y)});
  if(!d.lines.length){y+=18;doc.text("Nothing to bill in this period.",Lx,y)}
  if(y>700){doc.addPage();y=40}
  y+=26;const tl=R-150;doc.text("Total",tl,y);doc.text(money(d.total),R,y,{align:"right"});
  if(d.disc){y+=15;doc.setTextColor(110);doc.text("Discounts included",tl,y);doc.text(money(d.disc),R,y,{align:"right"});doc.setTextColor(0)}
  y+=15;doc.text("Paid",tl,y);doc.text(money(d.paid),R,y,{align:"right"});
  y+=20;doc.setFont("helvetica","bold");doc.setFontSize(13);doc.text("Balance due",tl,y);doc.text(money(d.due),R,y,{align:"right"});
  doc.setFont("helvetica","normal");doc.setFontSize(10);if(d.due>0){y+=34;doc.text("You can pay by bank transfer or cash. Thank you!",Lx,y)}
  return doc.output("blob");
}
["invClient","invPeriod","invDay","invFrom","invTo","invUnpaid"].forEach(id=>$(id).addEventListener("change",renderInvoice));
$("invForm").addEventListener("submit",e=>e.preventDefault());
$("invCopy").addEventListener("click",()=>{const t=invoiceText(invoiceData());$("invText").textContent=t;$("invText").style.whiteSpace="pre-wrap";$("invText").hidden=false;try{navigator.clipboard.writeText(t).then(()=>toast("Invoice copied. Paste it in WhatsApp."),()=>toast("Select the invoice text and copy it"))}catch(e){toast("Select the invoice text and copy it")}});
if(window.jspdf)$("invPdf").hidden=false;
$("invPdf").addEventListener("click",()=>{
  const d=invoiceData();let blob;try{blob=invoicePdf(d)}catch(e){toast("Couldn't build the PDF. Use Copy as text instead.");return}
  const name=`${d.no}${d.c?"-"+d.c.name.replace(/[^A-Za-z0-9]+/g,"-"):""}.pdf`;
  if(navigator.canShare&&navigator.share){const f=new File([blob],name,{type:"application/pdf"});if(navigator.canShare({files:[f]})){navigator.share({files:[f],title:name}).catch(()=>{});return}}
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);toast("Invoice saved");
});

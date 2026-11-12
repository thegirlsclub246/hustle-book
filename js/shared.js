// Shared helpers used by the owner app (app.html) and the public booking page (book.html).
var state = null; // {settings, services, specials, items, clients, queue}
const $=id=>document.getElementById(id);
const METHODS=["Cash","Bank transfer","BiMPay","FirstPay","Card"];
const DAYNAMES=["Sundays","Mondays","Tuesdays","Wednesdays","Thursdays","Fridays","Saturdays"];
const pad=n=>String(n).padStart(2,"0");
const iso=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const now=new Date(), TODAY=iso(now);
const addDays=n=>{const d=new Date(now);d.setDate(d.getDate()+n);return iso(d)};
const dateObj=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const daysBetween=(a,b)=>Math.round((dateObj(b)-dateObj(a))/864e5);
const money=n=>"$"+Math.round(Number(n)||0).toLocaleString("en-US");
const norm=n=>String(n||"").trim().toLowerCase();
const sum=(arr,f)=>arr.reduce((a,x)=>a+(+f(x)||0),0);
function esc(s){return String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function prettyDate(s){return dateObj(s).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"})}
function to12(t){let [h,m]=t.split(":").map(Number);const ap=h>=12?"pm":"am";h=h%12||12;return h+":"+pad(m)+ap}
const first=n=>String(n).trim().split(/\s+/)[0];
const newId=p=>p+Date.now().toString(36)+Math.random().toString(36).slice(2,6);

// Opening hours for a day of the week (0 = Sunday). dayHours overrides the default open/close for that day.
// Hours are decimals, so 16.5 means 4:30pm.
function hoursOn(S,dow){const h=S.dayHours&&S.dayHours[dow];return h&&h.length===2?[+h[0],+h[1]]:[+S.open,+S.close]}
const hm=x=>pad(Math.floor(x))+":"+pad(Math.round((x%1)*60));

const DEFAULT_SETTINGS={type:"barber",name:"",area:"",whatsapp:"",deposit:0,comeBack:21,loyaltyEvery:10,loyaltyReward:"free",open:9,close:19,openDays:[1,2,3,4,5,6]};

// ---------- services, specials, loyalty ----------
const live=s=>s.active&&(!s.ends||s.ends>=TODAY);
const svc=n=>state.services.find(s=>s.name===n);
function bundles(){return state.specials.filter(s=>s.kind==="bundle"&&live(s)).map(s=>({name:s.name,price:+s.price,mins:sum(s.includes,n=>(svc(n)||{mins:30}).mins),bundle:true,includes:s.includes,full:sum(s.includes,n=>(svc(n)||{price:0}).price)}))}
const allServices=()=>state.services.concat(bundles());
const priceOf=n=>{const s=allServices().find(x=>x.name===n);return s?+s.price:0};
const minsOf=n=>{const s=allServices().find(x=>x.name===n);return s?+s.mins||30:30};
function discountsFor(service,date){
  const dow=date?dateObj(date).getDay():now.getDay();
  const isBundle=bundles().some(b=>b.name===service);
  return state.specials.filter(s=>s.kind!=="bundle"&&live(s)&&(!s.ends||!date||s.ends>=date)&&(s.service?s.service===service:!isBundle)&&(+s.day<0||+s.day===dow));
}
const discAmt=(s,p)=>s.kind==="percent"?Math.round(p*s.value/100):Math.min(+s.value,p);
function bestSpecial(service,date){const p=priceOf(service);let b=null,v=0;discountsFor(service,date).forEach(s=>{const d=discAmt(s,p);if(d>v){v=d;b=s}});return b}
function specialText(s){
  let t;
  if(s.kind==="bundle"){const full=sum(s.includes,n=>(svc(n)||{price:0}).price);t=`${s.includes.join(" + ")} for ${money(s.price)}`+(full>s.price?` (save ${money(full-s.price)})`:"")}
  else t=(s.kind==="percent"?`${s.value}% off`:`${money(s.value)} off`)+" "+(s.service?s.service.toLowerCase():"any service");
  if(+s.day>=0)t+=", "+DAYNAMES[s.day]+" only";
  if(s.ends)t+=", until "+prettyDate(s.ends);
  return t;
}
const findClient=name=>state.clients.find(c=>norm(c.name)===norm(name));
function upsertClient(name,phone){let c=findClient(name);if(!c){c={id:newId("c"),name:name.trim(),phone:phone||"",notes:"",photo:null};state.clients.push(c)}else if(phone&&!c.phone)c.phone=phone;return c}
const visitsOf=c=>state.items.filter(i=>norm(i.name)===norm(c.name));
const done=i=>i.status==="paid"||i.status==="owed";
function usual(list){const m={};list.forEach(s=>m[s]=(m[s]||0)+1);return Object.keys(m).sort((a,b)=>m[b]-m[a])[0]||null}
function clientStats(c){const v=visitsOf(c),d=v.filter(done);return{visits:d.length,spent:sum(v,collected),last:d.map(i=>i.date).filter(x=>x<=TODAY).sort().pop(),usual:usual(d.map(i=>i.service))||usual(v.map(i=>i.service)),noshows:v.filter(i=>i.status==="noshow").length,upcoming:v.some(i=>i.status==="booked"&&i.date>=TODAY)}}
function loyalty(c){
  const N=+state.settings.loyaltyEvery;if(!N||N<2)return null;
  let stamps=0;visitsOf(c).filter(done).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).forEach(i=>{stamps=i.reward?0:stamps+1});
  const need=N-1;return{stamps:Math.min(stamps,need),need,due:stamps>=need};
}
const rewardWord=()=>state.settings.loyaltyReward==="half"?"half price":"free";
const rewardPrice=base=>state.settings.loyaltyReward==="half"?Math.round(base/2):0;
const collected=i=>i.status==="paid"?+i.price:(+i.deposit||0);
const owedAmt=i=>i.status==="owed"?Math.max(0,i.price-(+i.deposit||0)):0;
const initials=n=>String(n).trim().split(/\s+/).map(w=>w[0]).slice(0,2).join("").toUpperCase();
const avatar=c=>c&&c.photo?`<img class="av" src="${c.photo}" alt="">`:`<span class="av">${esc(initials(c?c.name:"?"))}</span>`;
function stampsHTML(l){if(!l)return"";let h="";for(let k=0;k<l.need;k++)h+=`<i class="${k<l.stamps?"on":""}"></i>`;return `<span class="stamps" aria-label="${l.stamps} of ${l.need} stamps">${h}<i class="prize${l.due?" on":""}"></i></span>`}

// ---------- business types ----------
const sv=(name,price,mins)=>({name,price,mins});
const TYPES={
  barber:{label:"Barber",service:"Service",queue:"Walk-in queue",services:[sv("Haircut",45,30),sv("Cut + beard",60,45),sv("Line up",25,15),sv("Kids cut (under 12)",35,30),sv("Beard trim",25,20),sv("Hot towel shave",40,30)]},
  nails:{label:"Nail tech",service:"Service",queue:"Walk-in queue",services:[sv("Gel manicure",70,60),sv("Acrylic full set",140,120),sv("Acrylic fill",90,75),sv("Spa pedicure",85,60),sv("Gel toes",55,45),sv("Nail art (add-on)",20,20)]},
  hair:{label:"Hair stylist or braider",service:"Style",queue:"Walk-in queue",services:[sv("Knotless braids (medium)",350,360),sv("Cornrows (straight back)",80,90),sv("Silk press",150,120),sv("Wash and set",75,75),sv("Loc retwist",120,120),sv("Kids braids",120,150)]},
  beauty:{label:"Lashes, brows or makeup",service:"Service",queue:"Walk-in queue",services:[sv("Classic lash set",140,120),sv("Hybrid lash set",170,150),sv("Lash fill (2 weeks)",80,60),sv("Brow wax and tint",55,30),sv("Full glam makeup",180,75),sv("Bridal makeup",450,120)]},
  detail:{label:"Car wash or detailing",service:"Service",queue:"Cars waiting",services:[sv("Wash and vac",50,60),sv("Wash, vac and wax",90,90),sv("Interior shampoo",160,150),sv("Full detail (car)",250,240),sv("Full detail (SUV or van)",320,300),sv("Engine bay clean",60,45)]},
  repair:{label:"Mechanic, AC or phone repair",service:"Job",queue:"Jobs waiting",services:[sv("Call-out fee",100,60),sv("Diagnostic",120,60),sv("Oil and filter change",150,60),sv("Brake pads (labour)",180,90),sv("AC service (split unit)",200,120),sv("Phone screen repair",250,90)]},
  food:{label:"Cakes, food or catering",service:"Item",queue:"Pick-up line",services:[sv("Birthday cake (8 inch)",150,15),sv("Birthday cake (2 tier)",380,15),sv("Cupcakes (dozen)",72,10),sv("Black cake (9 inch)",180,10),sv("Meal prep (5 meals)",140,10),sv("Party platter (50 pieces)",175,15)]},
  events:{label:"DJ, photography or events",service:"Package",queue:"Waiting list",services:[sv("DJ, 4 hours",800,240),sv("DJ + sound system, 6 hours",1400,360),sv("Photo session, 1 hour",300,60),sv("Event photos, half day",900,240),sv("Wedding photos, full day",2500,480),sv("Photo booth, 3 hours",650,180)]},
  coach:{label:"Tutor or personal trainer",service:"Session",queue:"Waiting list",services:[sv("CSEC maths, 1 hour",60,60),sv("Common Entrance prep, 1 hour",50,60),sv("Group class (up to 4)",30,60),sv("Personal training, 1 hour",80,60),sv("Online session, 1 hour",50,60),sv("8-session package",440,480)]},
  other:{label:"Something else",service:"Service",queue:"Walk-in queue",services:[sv("Standard",50,60),sv("Premium",100,90)]}};
const T=()=>TYPES[state.settings.type]||TYPES.barber;
function applyTerms(){const t=T();document.querySelectorAll("[data-t]").forEach(el=>{el.textContent=el.dataset.t==="servicelc"?t.service.toLowerCase():t[el.dataset.t]})}

// Phone numbers: turn "246 555 1234" or "555-1234" into an international WhatsApp number (Barbados default).
function waNumber(p){let d=String(p||"").replace(/\D/g,"");if(d.length===7)d="1246"+d;else if(d.length===10&&d.startsWith("246"))d="1"+d;return d}
function slugify(s){return String(s||"").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40)}


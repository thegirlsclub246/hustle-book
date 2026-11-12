// Connects to Supabase. Shows a clear message if config.js hasn't been filled in yet.
const HB_READY = !!(window.HB_CONFIG && /^https:\/\/.+\.supabase\.co/.test(HB_CONFIG.url) && HB_CONFIG.anonKey && !HB_CONFIG.anonKey.startsWith("YOUR-"));
const sb = HB_READY ? supabase.createClient(HB_CONFIG.url, HB_CONFIG.anonKey) : null;

function toast(m){const t=document.getElementById("toast");if(!t)return;t.textContent=m;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(()=>t.hidden=true,2600)}
function showNotReady(el){
  el.innerHTML=`<div class="card"><h2>Almost ready</h2><p class="note full">This copy of Hustle Book isn't connected to a database yet. Add your Supabase address and key to <code>js/config.js</code>. The README explains how.</p></div>`;
}

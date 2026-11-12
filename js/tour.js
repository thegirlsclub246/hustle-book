// Walkthrough steps for the owner app. Shared by the online app and the on-phone copy.
HBGuide.init({tour:[
  {before(){showTab("today")},sel:'[data-tab="today"]',title:"Today",text:"Your day at a glance: today's bookings, the walk-in queue, and new requests from your booking link."},
  {before(){showTab("today")},sel:"#todayList",title:"Mark each booking",text:"When a client finishes, tap Paid, Done but owes, or No-show. Then tap how they paid."},
  {before(){showTab("today")},sel:"#addForm",title:"Add a booking",text:"Start typing a name. Returning clients fill in their phone, usual service, notes and loyalty stamps."},
  {before(){showTab("clients")},sel:"#dueList",title:"Time to come back",text:"Clients you haven't seen in a while. Tap Message to copy a friendly WhatsApp nudge."},
  {before(){showTab("clients")},sel:"#clientList",title:"Your clients",text:"Tap a client for notes, a photo of their usual style, loyalty stamps and an invoice button."},
  {before(){showTab("money")},sel:".monthbar",title:"Your money",text:"See what came in each month, how people paid, and who still owes you."},
  {before(){showTab("money")},sel:"#invForm",title:"Invoices",text:"Make an invoice for one visit, a month or any dates. Save it as a PDF or send it on WhatsApp."},
  {before(){showTab("setup")},sel:".linkcard",title:"Your booking link",text:"Put this in your Instagram bio and WhatsApp status. Customers pick a time and you accept."},
  {before(){showTab("setup")},sel:"#svcList",title:"Services and prices",text:"Change your services, prices and how long each takes. Add specials and bundles further down."},
  {before(){showTab("setup")},sel:"#helpTour",title:"You're ready",text:"Find the home-screen steps and this tour again here in Setup any time."}
]});
document.getElementById("helpInstall").addEventListener("click",()=>HBGuide.showInstall({offerTour:false}));
document.getElementById("helpTour").addEventListener("click",()=>HBGuide.startTour());

-- Tiny Apps admin. Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once: it never overwrites your saved edits.

-- Who the admin is. Only one person: the first account to open /admin/ after this runs.
create table if not exists public.admin_owner (
  only_one boolean primary key default true check (only_one),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admin_owner enable row level security;
revoke all on public.admin_owner from anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_owner where user_id = auth.uid());
$$;

-- Makes the signed-in person the admin, but only if nobody is yet. Returns true if they are the admin.
create or replace function public.claim_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  insert into public.admin_owner (user_id) values (auth.uid()) on conflict (only_one) do nothing;
  return public.is_admin();
end $$;

revoke all on function public.is_admin() from public;
revoke all on function public.claim_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.claim_admin() to authenticated;

-- Admin pages (the Instagram kit). Only the admin can read or change them.
create table if not exists public.admin_docs (
  key text primary key,
  body jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.admin_docs enable row level security;
drop policy if exists "admin only" on public.admin_docs;
create policy "admin only" on public.admin_docs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Every earlier version, so a save can be undone.
create table if not exists public.admin_doc_versions (
  id bigint generated always as identity primary key,
  key text not null,
  body jsonb not null,
  saved_at timestamptz not null
);
alter table public.admin_doc_versions enable row level security;
drop policy if exists "admin only" on public.admin_doc_versions;
create policy "admin only" on public.admin_doc_versions for select to authenticated using (public.is_admin());

create or replace function public.admin_docs_keep_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_doc_versions (key, body, saved_at) values (old.key, old.body, old.updated_at);
  delete from public.admin_doc_versions where key = old.key and id not in
    (select id from public.admin_doc_versions where key = old.key order by id desc limit 50);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists admin_docs_keep_version on public.admin_docs;
create trigger admin_docs_keep_version before update on public.admin_docs
  for each row execute function public.admin_docs_keep_version();

-- Store apps. Everyone can read the ones that are switched on; only the admin can change them.
create table if not exists public.store_apps (
  slug text primary key check (slug ~ '^[a-z0-9-]{2,40}$'),
  sort int not null default 0,
  published boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.store_apps enable row level security;
drop policy if exists "anyone sees live apps" on public.store_apps;
create policy "anyone sees live apps" on public.store_apps for select to anon, authenticated
  using (published or public.is_admin());
drop policy if exists "admin changes apps" on public.store_apps;
create policy "admin changes apps" on public.store_apps for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Pictures you add from the admin page.
insert into storage.buckets (id, name, public) values ('kit-images', 'kit-images', true)
  on conflict (id) do nothing;
drop policy if exists "admin adds kit images" on storage.objects;
create policy "admin adds kit images" on storage.objects for insert to authenticated
  with check (bucket_id = 'kit-images' and public.is_admin());
drop policy if exists "admin changes kit images" on storage.objects;
create policy "admin changes kit images" on storage.objects for update to authenticated
  using (bucket_id = 'kit-images' and public.is_admin());
drop policy if exists "admin removes kit images" on storage.objects;
create policy "admin removes kit images" on storage.objects for delete to authenticated
  using (bucket_id = 'kit-images' and public.is_admin());

-- Starting content (skipped if it's already there).
insert into public.admin_docs (key, body) values ('instagram', $kit${
 "title": "Hustle Kit",
 "accent": "Instagram kit",
 "intro": "Everything for @hustlekit.bb in one place: ready-made images, captions to copy, reel scripts, stories, highlights and DM automations, plus a posting plan through Independence Day.",
 "tip": "Use **Download** under any image, or **Download all** for a whole carousel. **Copy** puts a caption on your clipboard, ready to paste into Instagram.",
 "sections": [
  {
   "id": "plan",
   "title": "Posting plan",
   "layout": "one",
   "sub": "About three weeks, one thing a day, ending on Barbados' 60th Independence Day. Post in the evening, around 7 to 9 pm, and repost every feed post and reel to your story.",
   "table": {
    "cols": [
     "Day",
     "What",
     "Post"
    ],
    "rows": [
     [
      "Thu 12 Nov",
      "Feed post",
      "Launch post: “Hustle Book is here” + link story"
     ],
     [
      "Fri 13 Nov",
      "Reel",
      "Reel 1: Friday reach. Who owe me?"
     ],
     [
      "Sat 14 Nov",
      "Carousel",
      "Carousel A: Who still owe you money?"
     ],
     [
      "Sun 15 Nov",
      "Story",
      "Story 1: bookings poll"
     ],
     [
      "Mon 16 Nov",
      "Reel",
      "Reel 2: Stop shouting “who next?”"
     ],
     [
      "Tue 17 Nov",
      "Feed post",
      "“I'll pay you Friday.”"
     ],
     [
      "Wed 18 Nov",
      "Carousel",
      "Carousel C: Get Hustle Book in 3 steps"
     ],
     [
      "Thu 19 Nov",
      "Reel",
      "Reel 5: No app store. 3 taps."
     ],
     [
      "Fri 20 Nov",
      "Feed post",
      "Built for barbers, detailers, mechanics…"
     ],
     [
      "Sat 21 Nov",
      "Story",
      "Story 2: What's your hustle? + Story 4: Cash or BiMPay"
     ],
     [
      "Mon 23 Nov",
      "Carousel",
      "Carousel B: 5 signs your hustle needs a booking book"
     ],
     [
      "Tue 24 Nov",
      "Reel",
      "Reel 3: What did your hustle make in November?"
     ],
     [
      "Thu 26 Nov",
      "Reel",
      "Reel 4: Set up in 30 seconds"
     ],
     [
      "Mon 30 Nov",
      "Feed post",
      "Independence Day: Made in Barbados (caption below, use the launch image or a photo of you)"
     ]
    ]
   },
   "cards": []
  },
  {
   "id": "carousels",
   "title": "Carousels",
   "layout": "one",
   "sub": "Upload all the slides of one carousel in a single post, in order. Swipe-through posts get saved and shared more than single images.",
   "cards": [
    {
     "title": "Carousel A: Who still owe you money?",
     "meta": [
      "6 slides, upload in order",
      "Post: Sat 14 Nov"
     ],
     "images": [
      {
       "src": "img/a1.png"
      },
      {
       "src": "img/a2.png"
      },
      {
       "src": "img/a3.png"
      },
      {
       "src": "img/a4.png"
      },
      {
       "src": "img/a5.png"
      },
      {
       "src": "img/a6.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "Bro, who still owe you money? 👀\nIf you had to stop and think about it, that's the problem.\n\nHustle Book keeps every booking, payment and balance in one place, so you know who paid and who owes before Friday reach.\n\nCash, BiMPay, FirstPay, bank transfer. All tracked, in BBD.\n\nUS$12 a month. Cancel any time. Comment BOOK and we'll send you the link.\n\n#barbados #246 #bajanbusiness #sidehustle #barber246"
      }
     ]
    },
    {
     "title": "Carousel B: 5 signs your hustle needs a booking book",
     "meta": [
      "7 slides, upload in order",
      "Post: Mon 23 Nov"
     ],
     "images": [
      {
       "src": "img/b1.png"
      },
      {
       "src": "img/b2.png"
      },
      {
       "src": "img/b3.png"
      },
      {
       "src": "img/b4.png"
      },
      {
       "src": "img/b5.png"
      },
      {
       "src": "img/b6.png"
      },
      {
       "src": "img/b7.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "How many of these is you? Be honest 😅\n\n1. Double-booked a Saturday\n2. “I paid you already” and you can't check\n3. No-shows and no deposits\n4. Regulars disappear and you don't notice\n5. No idea what you made last month\n\nHustle Book fixes all 5. Link in bio.\nTag a hustler who needs this 👇\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    },
    {
     "title": "Carousel C: Get Hustle Book in 3 steps",
     "meta": [
      "5 slides, upload in order",
      "Post: Wed 18 Nov"
     ],
     "images": [
      {
       "src": "img/c1.png"
      },
      {
       "src": "img/c2.png"
      },
      {
       "src": "img/c3.png"
      },
      {
       "src": "img/c4.png"
      },
      {
       "src": "img/c5.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "No app store. No big setup. Three steps:\n\n1. Tap the link in our bio\n2. Subscribe with PayPal or a card (US$12 a month)\n3. Add it to your home screen\n\nThat's it. Your bookings, clients and money, one tap away 📲\nQuestions? DM us the word BOOK.\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    }
   ]
  },
  {
   "id": "posts",
   "title": "Feed posts",
   "layout": "grid",
   "sub": "Single images for the days between carousels and reels.",
   "cards": [
    {
     "title": "Launch: Hustle Book is here",
     "meta": [
      "Post: Thu 12 Nov"
     ],
     "images": [
      {
       "src": "img/f1.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "Still keeping bookings in your notes app and chasing people for money in DMs? 👀\n\nHustle Book puts your whole day on your phone: who's booked, who's waiting, who paid and who still owes you. Your clients can even book themselves.\n\nMade in Barbados 🇧🇧 for barbers, detailers, mechanics, DJs, food sellers and every hustle in between.\n\nUS$12 a month. Cancel any time. Link in bio.\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    },
    {
     "title": "“I'll pay you Friday.”",
     "meta": [
      "Post: Tue 17 Nov"
     ],
     "images": [
      {
       "src": "img/f3.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "“I'll pay you Friday.” 🙃\nEvery hustler done hear that one.\n\nHustle Book keeps the balance on the booking and has a payment reminder ready to send on WhatsApp. No awkward chasing, no forgetting.\n\nLink in bio.\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    },
    {
     "title": "Built for every hustle",
     "meta": [
      "Post: Fri 20 Nov"
     ],
     "images": [
      {
       "src": "img/f2.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "Barber. Detailer. Mechanic. DJ. Food seller. Tutor. 💪🏾\nIf you take bookings or chase payments, Hustle Book is for you.\n\nPick your hustle in Setup and your services load in, already priced in BBD.\n\nWhat's your hustle? Comment below 👇\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    },
    {
     "title": "Independence Day (no image needed)",
     "meta": [
      "Post: Mon 30 Nov"
     ],
     "images": [],
     "copies": [
      {
       "label": "Caption",
       "text": "60 years of Independence 🇧🇧\n\nHappy Independence to every Bajan building something on the side: cutting hair after work, washing cars on a Saturday, cooking for orders, spinning at fetes.\n\nHustle Kit was made right here for you. Proud to be Made in Barbados.\n\n#barbados #independence #bajan #madeinbarbados #246"
      }
     ]
    }
   ]
  },
  {
   "id": "reels",
   "title": "Reels",
   "layout": "grid",
   "sub": "Reels reach the most new people. Each one is a short screen recording of Hustle Book with bold text on top. Record on your phone: on iPhone, swipe down for Control Centre and tap the record button; on Android, swipe down twice and tap Screen recorder. Open Hustle Book at **hustlekit-c60.pages.dev/hustle-book/**. Its sample barbershop data looks good on camera.",
   "cards": [
    {
     "title": "Reel 1: Friday reach. Who owe me?",
     "meta": [
      "10–15 seconds",
      "Post: Fri 13 Nov"
     ],
     "tall": true,
     "list": [
      "**0–2s:** You looking at your phone, frustrated. Text: FRIDAY REACH. WHO OWE ME?",
      "**2–8s:** Screen recording of Today's bookings. Scroll to Kemar: “Owes”, “Balance $35”.",
      "**8–12s:** Tap **Payment reminder** and show the message ready for WhatsApp.",
      "**12–15s:** Text: HUSTLE BOOK. LINK IN BIO."
     ],
     "box": "**Sound:** A trending comedy or “suspense” sound with the ↗ arrow. Cut to the beat drop when the balance shows.",
     "images": [
      {
       "src": "img/r1.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "Friday reach and you can't remember who owe you 😩\nHustle Book remembers. Balance on the booking, reminder ready for WhatsApp.\nComment BOOK for the link.\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    },
    {
     "title": "Reel 2: Stop shouting “who next?”",
     "meta": [
      "10–15 seconds",
      "Post: Mon 16 Nov"
     ],
     "tall": true,
     "list": [
      "**0–3s:** A busy barbershop with people waiting (ask a barber friend to film). Text: STOP SHOUTING “WHO NEXT?”",
      "**3–10s:** Screen recording of the Walk-in queue: add a name, tap **Start now**, tap **Move up**.",
      "**10–15s:** Barber cutting, client in the chair. Text: THE QUEUE RUN ITSELF."
     ],
     "box": "**Sound:** A trending dancehall or soca instrumental with the ↗ arrow. Upbeat, no lyrics if you add a voice-over.",
     "images": [
      {
       "src": "img/r2.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "Barbers, how you running your walk-ins? 💈\nHustle Book keeps the queue for you: who's next, how long the wait is, and who left.\nLink in bio.\n\n#barbados #246 #barber246 #bajanbarber #sidehustle"
      }
     ]
    },
    {
     "title": "Reel 3: What did your hustle make in November?",
     "meta": [
      "8–12 seconds",
      "Post: Tue 24 Nov"
     ],
     "tall": true,
     "list": [
      "**0–2s:** Text over your face or a plain background: WHAT DID YOUR HUSTLE MAKE IN NOVEMBER?",
      "**2–8s:** Screen recording of the **Money** tab: collected, still owed, how you got paid.",
      "**8–12s:** Text: NOW YOU KNOW. LINK IN BIO."
     ],
     "box": "**Sound:** A trending “money” or confident trap-style sound with the ↗ arrow.",
     "images": [
      {
       "src": "img/r3.png"
      }
     ],
     "copies": [
      {
       "label": "Caption",
       "text": "Do you actually know what your hustle made this month? 💰\nHustle Book adds it up for you: collected, still owed, deposits and no-shows, in BBD.\nLink in bio.\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    },
    {
     "title": "Reel 4: Set up in 30 seconds",
     "meta": [
      "15–20 seconds",
      "Post: Thu 26 Nov"
     ],
     "list": [
      "**0–2s:** Text: SET UP YOUR HUSTLE IN 30 SECONDS.",
      "**2–15s:** Screen recording of **Setup**: pick your hustle type and show the services loading in with BBD prices. Speed it up 2x.",
      "**15–20s:** Back to **Today**, ready to book. Text: DONE. LINK IN BIO."
     ],
     "box": "**Sound:** A fast trending sound with the ↗ arrow. Cut each tap to the beat.",
     "images": [],
     "copies": [
      {
       "label": "Caption",
       "text": "Detailer, mechanic, nail tech, DJ… pick your hustle and Hustle Book loads your services, priced in BBD. Set up in 30 seconds ⏱️\nLink in bio.\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    },
    {
     "title": "Reel 5: No app store. 3 taps.",
     "meta": [
      "8–12 seconds",
      "Post: Thu 19 Nov"
     ],
     "list": [
      "**0–2s:** Text: NO APP STORE. 3 TAPS.",
      "**2–9s:** Screen recording on iPhone: open the link, tap Share, tap **Add to Home Screen**, tap Add.",
      "**9–12s:** Show the Hustle Book icon on your home screen and tap it open."
     ],
     "box": "**Sound:** A trending “satisfying” or transition sound with the ↗ arrow.",
     "images": [],
     "copies": [
      {
       "label": "Caption",
       "text": "No download. No app store. Three taps and Hustle Book is on your home screen 📲\nLink in bio.\n\n#barbados #246 #bajanbusiness #sidehustle #smallbusinessbarbados"
      }
     ]
    }
   ]
  },
  {
   "id": "stories",
   "title": "Stories",
   "layout": "grid",
   "sub": "Each story image leaves space for a sticker. Add the image, then tap the sticker icon and place the sticker in the empty area.",
   "cards": [
    {
     "title": "Story 1: Bookings poll",
     "tall": true,
     "images": [
      {
       "src": "img/s1.png"
      }
     ],
     "text": [
      "Add a **Poll** sticker with 4 options: Notes app / WhatsApp / Copybook / My head 😅. Next day, share the results with a link sticker."
     ]
    },
    {
     "title": "Story 2: What's your hustle?",
     "tall": true,
     "images": [
      {
       "src": "img/s2.png"
      }
     ],
     "text": [
      "Add a **Questions** sticker. Reply to each answer in a new story showing how Hustle Book works for that hustle."
     ]
    },
    {
     "title": "Story 3: Link story",
     "tall": true,
     "images": [
      {
       "src": "img/s3.png"
      }
     ],
     "text": [
      "Add a **Link** sticker to **https://hustlekit-c60.pages.dev** with the text “Try Hustle Book”. Put it in the space at the bottom."
     ]
    },
    {
     "title": "Story 4: Cash or BiMPay?",
     "tall": true,
     "images": [
      {
       "src": "img/s4.png"
      }
     ],
     "text": [
      "Add a **Poll** sticker under the two colours: Cash / BiMPay. Then post: “Hustle Book tracks both.”"
     ]
    },
    {
     "title": "Every day",
     "steps": true,
     "list": [
      "Share each new post and reel to your story with a link sticker to **https://hustlekit-c60.pages.dev**.",
      "Show a real moment: a client booking, a payment coming in, a busy Saturday.",
      "When someone subscribes or says something good, ask if you can share it and repost it. Save those to a “Reviews” highlight."
     ]
    }
   ]
  },
  {
   "id": "highlights",
   "title": "Highlights",
   "layout": "one",
   "sub": "Post each cover as a story, add the stories listed, then on your profile tap **New**, pick them, and choose the cover with **Edit cover**.",
   "cards": [
    {
     "title": "Highlight covers",
     "tall": true,
     "images": [
      {
       "src": "img/h1.png"
      },
      {
       "src": "img/h2.png"
      },
      {
       "src": "img/h3.png"
      },
      {
       "src": "img/h4.png"
      }
     ],
     "text": [
      "**How it works:** Carousel C slides, shared to story.",
      "**Hustle Book:** your reels and app screen recordings.",
      "**Prices:** “US$12 a month. Pay with PayPal or a card. Cancel any time.”",
      "**FAQ:** “No download needed”, “Works on iPhone and Android”, “DM us BOOK”."
     ]
    }
   ]
  },
  {
   "id": "automations",
   "title": "Automations",
   "layout": "one",
   "sub": "Answer the same questions without typing them every time. Start with the free Instagram tools, then add the Meta Business Suite ones. Menu names move around in updates, so if a step looks different, search the setting name in Instagram's settings.",
   "cards": [
    {
     "title": "1. FAQ buttons in DMs",
     "steps": true,
     "list": [
      "Profile → ☰ menu → **Business tools and controls** → **Frequently asked questions**.",
      "Turn it on and add these four questions. They show as buttons when someone opens a chat with you."
     ],
     "copies": [
      {
       "label": "How much is Hustle Book?",
       "text": "US$12 a month through PayPal or a card. Cancel any time in PayPal. Here's the link: https://hustlekit-c60.pages.dev"
      },
      {
       "label": "Do I need to download anything?",
       "text": "No. It opens from a link in your phone's browser. Add it to your home screen and it works like any other app."
      },
      {
       "label": "Does it work for my hustle?",
       "text": "Yes. Barbers, detailers, mechanics, nail techs, DJs, food sellers, tutors and more. Pick your hustle in Setup and your services load in, priced in BBD."
      },
      {
       "label": "How do I get it?",
       "text": "Tap the link in our bio, subscribe with PayPal, then tap Open Hustle Book. That's it."
      }
     ]
    },
    {
     "title": "2. Saved replies",
     "steps": true,
     "list": [
      "Same menu → **Saved replies** → **+**.",
      "Give each one a shortcut word. In a chat, type the word and tap the reply that pops up."
     ],
     "copies": [
      {
       "label": "Shortcut: link",
       "text": "Here you go: https://hustlekit-c60.pages.dev 📲 Pick Hustle Book, subscribe with PayPal and it opens straight away."
      },
      {
       "label": "Shortcut: price",
       "text": "Hustle Book is US$12 a month through PayPal or a card. No contract, cancel any time."
      },
      {
       "label": "Shortcut: home",
       "text": "To put it on your home screen: iPhone, open the link in Safari, tap Share, then Add to Home Screen. Android, open it in Chrome, tap ⋮, then Add to Home screen."
      },
      {
       "label": "Shortcut: cancel",
       "text": "You can cancel any time in PayPal: Settings → Payments → Automatic payments → Hustle Kit → Cancel."
      },
      {
       "label": "Shortcut: thanks",
       "text": "Thank you for subscribing! 🙏🏾 If anything's confusing, message us here and we'll help you set up."
      }
     ]
    },
    {
     "title": "3. Auto replies in Meta Business Suite",
     "steps": true,
     "list": [
      "Download the free **Meta Business Suite** app and log in with Instagram. It may ask you to make a Facebook page for Hustle Kit; that's worth doing anyway.",
      "Go to **Inbox** → **Automations** (or the ⚙ in Inbox).",
      "Set up the replies below. Turn on Instagram for each one."
     ],
     "copies": [
      {
       "label": "Instant reply (first message)",
       "text": "Hey, thanks for reaching out to Hustle Kit! 👋🏾 Hustle Book is US$12 a month and runs on your phone. Get it here: https://hustlekit-c60.pages.dev. Ask us anything and we'll reply soon."
      },
      {
       "label": "Away message (outside your hours)",
       "text": "Thanks for your message! We're away right now but we'll reply first thing. Meanwhile you can see Hustle Book here: https://hustlekit-c60.pages.dev"
      },
      {
       "label": "Keyword reply: BOOK, LINK or PRICE",
       "text": "Here's Hustle Book: https://hustlekit-c60.pages.dev 📲 US$12 a month, cancel any time. Tap the link, subscribe with PayPal and it opens straight away."
      },
      {
       "label": "Comment to message: anyone who comments BOOK",
       "text": "Turn this on for your carousels and reels. Public reply: “Check your DMs 📩”. Private message: “Here's the link to Hustle Book: https://hustlekit-c60.pages.dev 🙌🏾”"
      }
     ],
     "note": "If you can't find comment automations in Business Suite, ManyChat (free plan) does the same thing for Instagram: someone comments BOOK and gets the link in their DMs."
    }
   ]
  },
  {
   "id": "trends",
   "title": "Fonts and sounds",
   "layout": "two",
   "sub": "",
   "cards": [
    {
     "title": "Fonts",
     "text": [
      "The images use **Anton**, the tall, bold, all-caps font you see on most reels right now, with Inter for the small text.",
      "To match it when you add text inside Instagram, pick the **Strong** font in the text tool and use white or gold. In Canva or CapCut, search for **Anton**."
     ],
     "note": "Keep it to one bold font and one plain font so every post looks like Hustle Kit."
    },
    {
     "title": "Trending sounds",
     "steps": true,
     "list": [
      "When editing a reel, tap **Audio** (♫).",
      "Look for the small **↗** arrow next to a song. That means it's trending right now.",
      "Tap the song to see how many reels use it. Under about 50,000 means it's still rising, which is the best time to use it.",
      "Tap the bookmark on sounds you like so you can find them again.",
      "Turn the music down under any voice-over so people can still hear you."
     ],
     "note": "Business accounts can't use some chart songs because of music licences. If a song says it's not available, pick another trending one or a trending “original audio” (voices and memes always work)."
    }
   ]
  }
 ]
}$kit$::jsonb)
  on conflict (key) do nothing;
insert into public.store_apps (slug, sort, published, data) values ('hustle-book', 1, true, $app${
 "slug": "hustle-book",
 "name": "Hustle Book",
 "price": 12,
 "planId": "P-8H829833M2433814MNL2KWPQ",
 "appUrl": "hustle-book/",
 "short": "Bookings, walk-ins, payments and regulars for any side hustle: nail techs, braiders, detailers, mechanics, food sellers, DJs, tutors and more.",
 "lede": "Whatever your hustle, Hustle Book keeps your whole day on your phone: who's booked, who's waiting, who paid, and who still owes you. Prices in BBD, reminders ready to paste into WhatsApp.",
 "who": [
  "Barbers",
  "Nail techs",
  "Braiders",
  "Lash techs",
  "Car detailers",
  "Mechanics",
  "Bakers and food sellers",
  "DJs and photographers",
  "Tutors and trainers",
  "Home cleaners"
 ],
 "features": [
  [
   "Today at a glance",
   "Bookings, a walk-in queue with wait times, and what you've collected this week."
  ],
  [
   "Your own booking link",
   "Clients pick a service, day and time, then send the request to you on WhatsApp."
  ],
  [
   "Reminders in one tap",
   "Booking reminders, payment nudges and \"time to come back\" messages, written for you."
  ],
  [
   "Who owes you",
   "Track deposits, no-shows and balances so nothing slips."
  ],
  [
   "Specials and loyalty",
   "Tuesday discounts, bundles, and a stamp card that gives a free visit."
  ],
  [
   "Monthly money summary",
   "Totals by payment method and service, plus invoices you can send. Handy for NIS or a loan."
  ]
 ],
 "privacy": "Your bookings and clients are saved on your own phone. Nobody else sees them."
}$app$::jsonb)
  on conflict (slug) do nothing;

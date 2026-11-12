# Hustle Book

Bookings, payments, clients and invoices for small businesses and side hustles in Barbados: nail techs, barbers, braiders, detailers, mechanics, cake makers, DJs, tutors and more.

- **Owners** sign in with their email, set up their business, and run their book from any phone or computer.
- **Customers** book from the owner's own link (`book.html?b=their-name`). Requests appear at the top of the owner's Today tab to accept or decline, with a ready-made WhatsApp confirmation.

It's plain HTML, CSS and JavaScript with no build step. Data lives in [Supabase](https://supabase.com) (free tier). It runs on any static host: Cloudflare Pages, Netlify, Vercel or GitHub Pages.

## Pages

| File | What it is |
|---|---|
| `index.html` | Welcome page and email sign-in |
| `app.html` | The owner's app: Today, Clients, Money and Setup tabs |
| `book.html?b=<name>` | A business's public booking page |
| `supabase/schema.sql` | Database tables and security rules |
| `manifest.webmanifest`, `icons/` | Install as an app (laptop or phone) with the Hustle Kit logo |
| `js/guide.js`, `js/tour.js` | "Add to Home Screen" steps (iPhone, Android, Samsung, computer) and the walkthrough |

## Set up (about 10 minutes)

1. **Create a Supabase project.** Sign up at supabase.com, click **New project**, pick a name and a database password, and choose the region closest to Barbados (US East).
2. **Create the database.** In the project, open **SQL Editor → New query**, paste everything from `supabase/schema.sql`, and click **Run**.
3. **Allow sign-in links to your site.** Open **Authentication → URL Configuration**. Set **Site URL** to where the app lives, for example `https://hustlekit-c60.pages.dev/hustle-book/`, and add `https://hustlekit-c60.pages.dev/hustle-book/app.html` under **Redirect URLs**.
4. **Add the sign-in code to the email.** Open **Authentication → Emails → Magic Link** and replace the message with:
   ```html
   <h2>Your Hustle Book sign-in</h2>
   <p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
   <p>Or type this code in the app: <strong>{{ .Token }}</strong></p>
   ```
   The code matters on iPhone: an app added to the home screen can't receive the link, so people type the code instead.
5. **Connect the app.** Open **Project Settings → API**. Copy the **Project URL** and the **anon public** key into `js/config.js`. Never use the `service_role` key here.
6. **Put it online.** Upload the folder to your host. On Cloudflare Pages, either connect this GitHub repo (no build command, output folder `/`) or drag the folder into a direct upload.

## Subscribers only

Only people who've paid for a Hustle Kit subscription can create an account.

- After subscribing on the store, the customer types the email they'll sign in with. The `hustle-subscribe` Edge Function (`supabase/functions/hustle-subscribe/index.ts`) checks the subscription with PayPal and adds that email to the `subscribers` table.
- The database refuses to create an account for any email that isn't on that list, and a business only works (app, booking link, booking requests) while its owner's subscription is paid up.
- The app re-checks with PayPal near the end of each paid month. A cancelled subscription keeps working until a month after the last payment.
- Everyone who already had a business when this was switched on is added as `free`, which never runs out.

**To set it up:** add `PAYPAL_CLIENT_ID` and `PAYPAL_SECRET` (from your live PayPal app) under **Edge Functions → Secrets**, deploy `hustle-subscribe` with **Verify JWT** turned off, and run `supabase/schema.sql` again.

**To give someone free access** (a friend or tester), run this in the SQL Editor:
```sql
insert into public.subscribers (email, status, note) values ('their@email.com', 'free', 'Friend')
on conflict (email) do update set status = 'free';
```

## Booking extras

- **Reminders in one tap.** Reminder, payment and "come back" buttons open WhatsApp with the message typed in. The Today tab lists tomorrow's clients and ticks off who's been reminded.
- **Deposits.** In Setup → Getting paid deposits, the owner adds a payment link (PayPal.me, WiPay and so on) and/or bank details. Clients see them right after booking, and they go into reminders.
- **Instant booking.** Setup → Online booking. When it's on, the owner's app accepts any request that doesn't clash, as soon as it opens.
- **Change or cancel.** Every confirmation has a private link (`book.html?b=<name>&r=<booking id>`) where the client can move or cancel, up to the number of hours before that the owner sets (24 by default). The owner sees "Moved" or "Cancelled" on the Today tab. A deposit already paid moves with the booking.
- **Photos and reviews.** Up to 6 photos show on the booking page. "Ask for a review" on a paid booking sends `book.html?b=<name>&review=1`. New reviews wait in Setup until the owner taps Show.

These need the latest `supabase/schema.sql`. Run the whole file again in the SQL Editor after updating.

## Good to know

- Each business's bookings and clients are only visible to its owner. That is enforced by the database rules, not just the app.
- Anyone with a booking link can send a request. The owner decides whether to accept it.
- Client photos are shrunk to about 50 KB and stored with the owner's data.
- If the owner uses two phones at the same time, the last change saved wins.
- Supabase's built-in email sender is limited to a few sign-in emails an hour. Before inviting lots of businesses, add your own email sender under **Authentication → SMTP Settings** (for example Resend or Brevo, both have free tiers).

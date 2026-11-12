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
| `manifest.webmanifest`, `icons/`, `sw.js` | Home-screen install with the Hustle Kit logo, full-screen mode, offline fallback |
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

## Good to know

- Each business's bookings and clients are only visible to its owner. That is enforced by the database rules, not just the app.
- Anyone with a booking link can send a request. The owner decides whether to accept it.
- Client photos are shrunk to about 50 KB and stored with the owner's data.
- If the owner uses two phones at the same time, the last change saved wins.
- Supabase's built-in email sender is limited to a few sign-in emails an hour. Before inviting lots of businesses, add your own email sender under **Authentication → SMTP Settings** (for example Resend or Brevo, both have free tiers).

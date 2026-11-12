// Hustle Book: links a PayPal subscription to the email someone signs in with.
//
// Supabase → Edge Functions → Deploy a new function → Via Editor. Name it
// hustle-subscribe, paste this whole file, and deploy. Then turn OFF
// "Verify JWT" (or "Enforce JWT verification") for it: the store calls it
// before the person has an account.
//
// Secrets it needs (Edge Functions → Secrets):
//   PAYPAL_CLIENT_ID  your live PayPal app's Client ID
//   PAYPAL_SECRET     the same app's Secret
// Optional:
//   PAYPAL_PLAN_IDS   plan IDs that count for Hustle Book, comma separated
//   PAYPAL_ENV        "sandbox" to test with PayPal's sandbox
//
// Two things it does:
//   {action:"claim", subscriptionID, email}  after someone subscribes on the store
//   {action:"refresh"} with the owner's sign-in token, to re-check with PayPal
//                      (so a cancelled subscription stops at the end of the paid month)

import { createClient } from "npm:@supabase/supabase-js@2";

const PLAN_IDS = (Deno.env.get("PAYPAL_PLAN_IDS") || "P-8H829833M2433814MNL2KWPQ")
  .split(",").map((s) => s.trim()).filter(Boolean);
const PAYPAL_API = Deno.env.get("PAYPAL_ENV") === "sandbox"
  ? "https://api-m.sandbox.paypal.com"
  : "https://api-m.paypal.com";
const DAY = 86400000;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (message: string, status = 400) => reply({ ok: false, message }, status);

async function paypalToken(): Promise<string> {
  const id = Deno.env.get("PAYPAL_CLIENT_ID"), secret = Deno.env.get("PAYPAL_SECRET");
  if (!id || !secret) throw new Error("PayPal keys are missing from the Edge Function secrets.");
  const r = await fetch(PAYPAL_API + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(id + ":" + secret), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error("PayPal didn't accept the Client ID and Secret (" + r.status + ").");
  return (await r.json()).access_token;
}

// deno-lint-ignore no-explicit-any
async function getSubscription(id: string): Promise<any | null> {
  const r = await fetch(PAYPAL_API + "/v1/billing/subscriptions/" + encodeURIComponent(id), {
    headers: { Authorization: "Bearer " + await paypalToken() },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("PayPal couldn't be reached (" + r.status + ").");
  return await r.json();
}

// How long this subscription pays for. Active: until the next bill, plus a week
// for PayPal to retry a failed payment. Cancelled or paused: one month after the
// last payment, as the store promises.
// deno-lint-ignore no-explicit-any
function paidUntil(sub: any): Date {
  const now = Date.now(), bill = sub.billing_info || {};
  const last = bill.last_payment?.time ? Date.parse(bill.last_payment.time) : NaN;
  if (sub.status === "ACTIVE") {
    const next = bill.next_billing_time ? Date.parse(bill.next_billing_time) : NaN;
    return new Date(isNaN(next) ? now + 35 * DAY : next + 7 * DAY);
  }
  if (sub.status === "APPROVED") return new Date(now + 2 * DAY); // payment still going through
  return new Date(isNaN(last) ? now - DAY : last + 31 * DAY);
}

// deno-lint-ignore no-explicit-any
function rowFor(email: string, sub: any) {
  return {
    email,
    status: sub.status,
    paypal_subscription_id: sub.id,
    paypal_email: sub.subscriber?.email_address || null,
    plan_id: sub.plan_id,
    paid_until: paidUntil(sub).toISOString(),
    checked_at: new Date().toISOString(),
  };
}

async function claim(subscriptionID: string, rawEmail: string) {
  const email = String(rawEmail || "").trim().toLowerCase();
  const subId = String(subscriptionID || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Please type a full email address.");
  if (!/^I-[A-Z0-9]{6,30}$/.test(subId)) return fail("That doesn't look like a PayPal subscription ID. It starts with I-.");

  const sub = await getSubscription(subId);
  if (!sub) return fail("PayPal doesn't know that subscription ID. Check it and try again.");
  if (!PLAN_IDS.includes(sub.plan_id)) return fail("That subscription isn't for Hustle Book.");
  if (!["ACTIVE", "APPROVED"].includes(sub.status)) {
    return fail("That PayPal subscription isn't active (it's " + String(sub.status).toLowerCase() + ").");
  }

  // One subscription, one email. Allow moving it only if the old email never signed in (a typo).
  const { data: existing, error: e1 } = await db.from("subscribers")
    .select("email").eq("paypal_subscription_id", subId).maybeSingle();
  if (e1) throw e1;
  if (existing && existing.email !== email) {
    const { data: used, error: e2 } = await db.rpc("email_signed_up", { p_email: existing.email });
    if (e2) throw e2;
    if (used) return fail("This subscription is already linked to another email. Message us and we'll sort it out.");
    const { error: e3 } = await db.from("subscribers").delete().eq("email", existing.email);
    if (e3) throw e3;
  }

  // Don't downgrade someone who has free access.
  const { data: mine, error: e4 } = await db.from("subscribers").select("status").eq("email", email).maybeSingle();
  if (e4) throw e4;
  if (mine?.status === "free") return reply({ ok: true, email });

  const { error: e5 } = await db.from("subscribers").upsert(rowFor(email, sub), { onConflict: "email" });
  if (e5) throw e5;
  return reply({ ok: true, email });
}

async function refresh(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user?.email) return fail("Please sign in again.", 401);
  const email = user.email.toLowerCase();
  const { data: row, error } = await db.from("subscribers")
    .select("status, paypal_subscription_id").eq("email", email).maybeSingle();
  if (error) throw error;
  if (!row || row.status === "free" || !row.paypal_subscription_id) return reply({ ok: true });
  const sub = await getSubscription(row.paypal_subscription_id);
  if (!sub) return reply({ ok: true });
  const { error: e2 } = await db.from("subscribers").update(rowFor(email, sub)).eq("email", email);
  if (e2) throw e2;
  return reply({ ok: true, status: sub.status });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("Use POST.", 405);
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "claim") return await claim(body.subscriptionID, body.email);
    if (body.action === "refresh") return await refresh(req);
    return fail("Unknown action.");
  } catch (e) {
    console.error(e);
    return fail("Something went wrong on our side: " + (e instanceof Error ? e.message : String(e)), 500);
  }
});

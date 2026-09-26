import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIRoute } from "astro";
import { addSocio, normalizeEmail } from "../../lib/brevo";

export const prerender = false;

const SIGNUP_TYPE = "subscription_preapproval";

function env(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

function sameHex(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Mercado Pago signs `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` and omits any missing pair.
function signatureMatches(request: Request, secret: string): boolean {
  const header = request.headers.get("x-signature");
  if (!header) return false;

  let ts = "";
  let v1 = "";
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") v1 = value;
  }
  if (!ts || !v1) return false;

  const dataId = new URL(request.url).searchParams.get("data.id")?.toLowerCase();
  const requestId = request.headers.get("x-request-id");
  const pairs = [
    dataId ? `id:${dataId}` : "",
    requestId ? `request-id:${requestId}` : "",
    `ts:${ts}`,
  ].filter(Boolean);

  const expected = createHmac("sha256", secret).update(`${pairs.join(";")};`).digest("hex");
  return sameHex(expected, v1);
}

export const GET: APIRoute = () => new Response(null, { status: 200 });

export const POST: APIRoute = async ({ request }) => {
  const secret = env("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret) {
    console.error("MERCADOPAGO_WEBHOOK_SECRET is not set");
    return new Response(null, { status: 500 });
  }
  if (!signatureMatches(request, secret)) return new Response(null, { status: 401 });

  let notification: { type?: string; data?: { id?: string | number } };
  try {
    notification = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? notification.type;
  if (type !== SIGNUP_TYPE) return new Response(null, { status: 200 });

  const id = url.searchParams.get("data.id") ?? (notification.data?.id == null ? "" : String(notification.data.id));
  if (!id) {
    console.error("Mercado Pago subscription notification had no id");
    return new Response(null, { status: 200 });
  }

  const token = env("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) {
    console.error("MERCADOPAGO_ACCESS_TOKEN is not set");
    return new Response(null, { status: 500 });
  }

  const subscriptionResponse = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (subscriptionResponse.status === 404) {
    console.error("Mercado Pago subscription was not found", id);
    return new Response(null, { status: 200 });
  }
  if (!subscriptionResponse.ok) {
    console.error("Mercado Pago subscription lookup failed", subscriptionResponse.status);
    return new Response(null, { status: 500 });
  }

  const subscription = (await subscriptionResponse.json()) as { status?: string; payer_email?: string };
  if (subscription.status !== "authorized") return new Response(null, { status: 200 });

  const email = normalizeEmail(subscription.payer_email);
  if (!email) {
    console.error("Authorized Mercado Pago subscription had no payer email", id);
    return new Response(null, { status: 200 });
  }

  try {
    await addSocio(email);
  } catch (error) {
    console.error(error);
    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 200 });
};

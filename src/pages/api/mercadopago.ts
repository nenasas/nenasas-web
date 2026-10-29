import { createHmac, timingSafeEqual } from "node:crypto";
import type { APIRoute } from "astro";
import { addSocio, normalizeEmail } from "../../lib/brevo";

export const prerender = false;

const MP_API = "https://api.mercadopago.com";
const SIGNUP_TYPES = new Set([
  "subscription_preapproval",
  "subscription_authorized_payment",
]);

function env(name: string): string | undefined {
  const value = ((import.meta.env as Record<string, string | undefined>)[name] ?? process.env[name])?.trim();
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
  if (env("MERCADOPAGO_WEBHOOK_WRITES_ENABLED") === "false") {
    console.info("Mercado Pago webhook: escritura temporalmente deshabilitada");
    return new Response(null, { status: 200 });
  }

  let notification: { type?: string; data?: { id?: string | number } };
  try {
    notification = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? notification.type;
  if (!type || !SIGNUP_TYPES.has(type)) return new Response(null, { status: 200 });

  const id = url.searchParams.get("data.id") ?? (notification.data?.id == null ? "" : String(notification.data.id));
  if (!id) return new Response(null, { status: 200 });

  const token = env("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) {
    console.error("MERCADOPAGO_ACCESS_TOKEN is not set");
    return new Response(null, { status: 500 });
  }
  const headers = { Authorization: `Bearer ${token}` };

  let preapprovalId = id;
  let paymentId: string | number | undefined;

  if (type === "subscription_authorized_payment") {
    const invoiceRes = await fetch(`${MP_API}/authorized_payments/${encodeURIComponent(id)}`, { headers });
    if (invoiceRes.status === 404) return new Response(null, { status: 200 });
    if (!invoiceRes.ok) return new Response(null, { status: 500 });
    const invoice = (await invoiceRes.json()) as {
      preapproval_id?: string;
      payment?: { id?: number | string; status?: string };
    };
    if (!invoice.preapproval_id) return new Response(null, { status: 200 });
    preapprovalId = invoice.preapproval_id;
    if (invoice.payment?.status === "approved") paymentId = invoice.payment.id;
  }

  const subRes = await fetch(`${MP_API}/preapproval/${encodeURIComponent(preapprovalId)}`, { headers });
  if (subRes.status === 404) return new Response(null, { status: 200 });
  if (!subRes.ok) return new Response(null, { status: 500 });

  const sub = (await subRes.json()) as {
    status?: string;
    payer_id?: number | string;
    payer_email?: string;
    preapproval_plan_id?: string;
  };
  if (sub.status !== "authorized") return new Response(null, { status: 200 });

  const planIds = env("MERCADOPAGO_PLAN_IDS")?.split(",").map((x) => x.trim()).filter(Boolean);
  if (planIds?.length && (!sub.preapproval_plan_id || !planIds.includes(sub.preapproval_plan_id))) {
    return new Response(null, { status: 200 });
  }

  if (!paymentId) {
    const searchRes = await fetch(
      `${MP_API}/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}&limit=20`,
      { headers },
    );
    if (!searchRes.ok) return new Response(null, { status: 500 });
    const invoices = (await searchRes.json()) as {
      results?: Array<{ payment?: { id?: number | string; status?: string } }>;
    };
    paymentId = invoices.results?.find((x) => x.payment?.id && x.payment.status === "approved")?.payment?.id;
  }

  let email: string | undefined;
  if (paymentId) {
    const payRes = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(String(paymentId))}`, { headers });
    if (!payRes.ok) return new Response(null, { status: 500 });
    const payment = (await payRes.json()) as {
      status?: string;
      payer?: { id?: number | string; email?: string };
    };
    if (payment.status !== "approved") return new Response(null, { status: 200 });
    if (payment.payer?.id && sub.payer_id && String(payment.payer.id) !== String(sub.payer_id)) {
      return new Response(null, { status: 200 });
    }
    email = normalizeEmail(payment.payer?.email);
  }

  email ??= normalizeEmail(sub.payer_email);
  if (!email) {
    console.error("Authorized Mercado Pago subscription had no payer email", preapprovalId);
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

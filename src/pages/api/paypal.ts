import type { APIRoute } from "astro";
import { addSocio, normalizeEmail } from "../../lib/brevo";

export const prerender = false;

const SIGNUP_TYPES = new Set(["subscr_signup", "recurring_payment_profile_created"]);

async function verifyIpn(body: string): Promise<string> {
  const response = await fetch("https://ipnpb.paypal.com/cgi-bin/webscr", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Nenasas-IPN-Verifier",
    },
    body: `cmd=_notify-validate&${body}`,
  });
  return (await response.text()).trim();
}

export const GET: APIRoute = () => new Response(null, { status: 200 });

export const POST: APIRoute = async ({ request }) => {
  const raw = new Uint8Array(await request.arrayBuffer());
  if (raw.byteLength === 0) return new Response(null, { status: 400 });

  const body = new TextDecoder("latin1").decode(raw);
  let verdict: string;
  try {
    verdict = await verifyIpn(body);
  } catch (error) {
    console.error("PayPal IPN verification request failed", error);
    return new Response(null, { status: 500 });
  }
  if (verdict !== "VERIFIED") {
    console.error("PayPal IPN was not verified");
    return new Response(null, { status: 200 });
  }

  const params = new URLSearchParams(body);
  const txnType = params.get("txn_type") ?? "";
  console.info("PayPal IPN", txnType || "(none)");
  if (!SIGNUP_TYPES.has(txnType)) return new Response(null, { status: 200 });

  const email = normalizeEmail(params.get("payer_email"));
  if (!email) {
    console.error("PayPal signup had no payer email", txnType);
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

/**
 * Nenasas · sincronización segura de socios de Mercado Pago a Brevo.
 * Uso inicial: GET /api/sync-socios (solo simulación)
 * Escritura:  GET /api/sync-socios?apply=1 (requiere SOCIOS_SYNC_WRITES_ENABLED=true)
 * Requiere Authorization: Bearer CRON_SECRET en ambas modalidades.
 * No reemplaza los webhooks existentes. No agrega contactos al newsletter.
 * IMPORTANTE: SOCIOS_SYNC_FROM debe ser la fecha real de puesta en marcha.
 */
import type { APIRoute } from 'astro';
export const prerender = false;

type Subscription = {
  id: string;
  status?: string;
  payer_id?: number | string;
  preapproval_plan_id?: string;
  date_created?: string;
};
type Page<T> = { paging?: { total?: number }; results?: T[] };
type Invoice = { payment?: { id?: number | string; status?: string } };
type Payment = { status?: string; payer?: { id?: number | string; email?: string } };
const API = 'https://api.mercadopago.com';
const BREVO = 'https://api.brevo.com/v3';

function env(name: string) {
  return String((import.meta.env as Record<string, string | undefined>)[name] ?? process.env[name] ?? '').trim();
}
async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const r = await fetch(url, { headers, cache: 'no-store' });
  if (!r.ok) throw Error(`HTTP ${r.status} en ${new URL(url).pathname}`);
  return (await r.json()) as T;
}
function makeUrl(path: string, params: Record<string, string>) {
  const u = new URL(`${API}${path}`);
  Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
}
async function verifiedPaidEmail(sub: Subscription, headers: Record<string, string>): Promise<string | null> {
  const invoices = await getJson<Page<Invoice>>(
    makeUrl('/authorized_payments/search', { preapproval_id: sub.id, limit: '100' }), headers
  );
  // La API puede devolver varias cuotas: buscamos una con pago aprobado.
  const approved = invoices.results?.find((x) => x.payment?.id && x.payment.status === 'approved');
  if (!approved?.payment?.id) return null;
  const payment = await getJson<Payment>(
    `${API}/v1/payments/${encodeURIComponent(String(approved.payment.id))}`, headers
  );
  if (payment.status !== 'approved' || !payment.payer?.email || !payment.payer.id || !sub.payer_id) return null;
  if (String(payment.payer.id) !== String(sub.payer_id)) return null;
  return payment.payer.email.trim().toLowerCase();
}
async function inSocios(email: string, headers: Record<string, string>, listId: number): Promise<boolean> {
  const r = await fetch(`${BREVO}/contacts/${encodeURIComponent(email)}`, { headers, cache: 'no-store' });
  if (r.status === 404) return false;
  if (!r.ok) throw Error(`Brevo: HTTP ${r.status} al consultar contacto`);
  const person = (await r.json()) as { listIds?: number[] };
  return person.listIds?.includes(listId) ?? false;
}
async function addSocio(email: string, headers: Record<string, string>, listId: number) {
  const r = await fetch(`${BREVO}/contacts`, {
    method: 'POST', headers,
    body: JSON.stringify({ email, listIds: [listId], updateEnabled: true }),
  });
  if (!r.ok) throw Error(`Brevo: HTTP ${r.status} al agregar contacto`);
}

export const GET: APIRoute = async ({ request }) => {
  const secret = env('CRON_SECRET');
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return new Response('Unauthorized', { status: 401 });
  const token = env('MERCADOPAGO_ACCESS_TOKEN');
  const brevoKey = env('BREVO_API_KEY');
  const listId = Number(env('BREVO_SOCIOS_LIST_ID'));
  const planIds = env('MERCADOPAGO_PLAN_IDS').split(',').map((x) => x.trim()).filter(Boolean);
  const start = env('SOCIOS_SYNC_FROM');
  const cutoff = Date.parse(start);
  if (!token || !brevoKey || !Number.isInteger(listId) || listId <= 0 ||
      planIds.length !== 3 || !start || !Number.isFinite(cutoff))
    return Response.json({ ok: false, error: 'Configuración incompleta: revisá secretos, tres planes y SOCIOS_SYNC_FROM' }, { status: 500 });

  const url = new URL(request.url);
  const requestedWrite = url.searchParams.get('apply') === '1';
  const apply = requestedWrite && env('SOCIOS_SYNC_WRITES_ENABLED') === 'true';
  if (requestedWrite && !apply)
    return Response.json({ ok: false, error: 'La escritura está deshabilitada por configuración' }, { status: 403 });

  const mpHeaders = { Authorization: `Bearer ${token}` };
  const brevoHeaders = { 'api-key': brevoKey, 'content-type': 'application/json' };
  const counts = { inspected: 0, historicalSkipped: 0, notAuthorized: 0, candidates: 0,
    noVerifiedPaidEmail: 0, alreadyInSocios: 0, wouldAdd: 0, added: 0, errors: 0 };
  // Nunca imprimir correo, id de suscripción ni datos personales.
  try {
    for (const planId of planIds) {
      let offset = 0;
      for (let page = 0; page < 50; page++) {
        const result = await getJson<Page<Subscription>>(
          makeUrl('/preapproval/search', { preapproval_plan_id: planId, limit: '20', offset: String(offset) }),
          mpHeaders
        );
        const rows = result.results ?? [];
        for (const sub of rows) {
          if (sub.preapproval_plan_id && sub.preapproval_plan_id !== planId) continue;
          counts.inspected++;
          const created = Date.parse(sub.date_created ?? '');
          // Falla cerrado: fechas faltantes o inválidas no permiten importación.
          if (!Number.isFinite(created) || created < cutoff) { counts.historicalSkipped++; continue; }
          if (sub.status !== 'authorized') { counts.notAuthorized++; continue; }
          counts.candidates++;
          try {
            const email = await verifiedPaidEmail(sub, mpHeaders);
            if (!email) { counts.noVerifiedPaidEmail++; continue; }
            if (await inSocios(email, brevoHeaders, listId)) { counts.alreadyInSocios++; continue; }
            if (apply) { await addSocio(email, brevoHeaders, listId); counts.added++; }
            else counts.wouldAdd++;
          } catch (err) {
            counts.errors++;
            console.error('Error procesando suscripción (sin datos personales):', err instanceof Error ? err.message : 'error');
          }
        }
        offset += rows.length;
        if (!rows.length || rows.length < 20 || offset >= (result.paging?.total ?? Infinity)) break;
      }
    }
    console.log('Nenasas MP sync — solo conteos', { apply, ...counts });
    return Response.json({ ok: counts.errors === 0, mode: apply ? 'apply' : 'dry-run', cutoff: start, ...counts },
      { status: counts.errors ? 207 : 200 });
  } catch (err) {
    console.error('Sincronización interrumpida:', err instanceof Error ? err.message : 'error');
    return Response.json({ ok: false, mode: apply ? 'apply' : 'dry-run', ...counts }, { status: 502 });
  }
};

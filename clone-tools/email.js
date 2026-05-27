const { prisma } = require('./db');
let resend = null;
function getClient() {
  if (resend) return resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try { const { Resend } = require('resend'); resend = new Resend(key); return resend; }
  catch (e) { console.warn('[email] resend not installed:', e.message); return null; }
}
const FROM = process.env.EMAIL_FROM || 'Skybox Global <no-reply@skyboxglobal.local>';

const TEMPLATES = {
  'magic-link': ({ url }) => ({
    subject: 'Sign in to Skybox Global',
    text: 'Sign in: ' + url,
    html: `<p>Click to sign in: <a href="${url}">${url}</a></p><p>Link expires in 15 minutes.</p>`,
  }),
  'booking.confirmation.flight': ({ order }) => ({
    subject: `Booking confirmed · ${order.booking_reference}`,
    text: `Booking confirmed: ${order.booking_reference}. Total: ${order.total_amount} ${order.currency}.`,
    html: `<h1>Booking confirmed</h1><p>Reference: <b>${order.booking_reference}</b></p><p>Total: <b>${order.total_amount} ${order.currency}</b></p><p><a href="${process.env.APP_URL || 'http://localhost:8088'}/trips/${order.id}">View trip</a></p>`,
  }),
};

async function sendEmail(template, to, data = {}) {
  const t = TEMPLATES[template];
  if (!t) return false;
  const built = t(data);
  let logRow;
  try { logRow = await prisma.emailLog.create({ data: { to, subject: built.subject, template, status: 'queued', payload: JSON.stringify(data) } }); } catch {}
  const client = getClient();
  if (!client) { console.log(`[email] (no RESEND_API_KEY) ${template} → ${to}: ${built.subject}`); return false; }
  try {
    const r = await client.emails.send({ from: FROM, to, subject: built.subject, html: built.html, text: built.text });
    if (logRow) await prisma.emailLog.update({ where: { id: logRow.id }, data: { status: 'sent', providerId: r.data?.id || null } }).catch(() => {});
    return true;
  } catch (e) {
    console.error('[email] send failed:', e.message);
    if (logRow) await prisma.emailLog.update({ where: { id: logRow.id }, data: { status: 'failed', error: e.message } }).catch(() => {});
    return false;
  }
}
module.exports = { sendEmail };

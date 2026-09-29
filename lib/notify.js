// WhatsApp alerts to the store owner through CallMeBot (free, for your own number only).
// Setup: save +34 684 78 33 47 in your phone, send it "I allow callmebot to send me messages"
// on WhatsApp, and put the API key it replies with in Dashboard > Store & Social > WhatsApp alerts.

const METHOD_LABELS = { cod: 'Cash on delivery', manual: 'Bank / wallet transfer', safepay: 'Online (Safepay)', easypaisa: 'Easypaisa' };

// 03001234567, 923001234567 and +92 300 1234567 all become +923001234567
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : '';
}

// Resolves to { ok: true } or { ok: false, error }. Never throws.
async function sendWhatsApp({ phone, apiKey }, text) {
  if (!phone || !apiKey) return { ok: false, error: 'WhatsApp number or API key is missing' };
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text.slice(0, 1500))}&apikey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const body = (await res.text()).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    // CallMeBot answers 200 with an error text when the key or number is wrong
    if (!res.ok || /error|invalid|not (been )?activated|wrong/i.test(body)) {
      return { ok: false, error: `CallMeBot: ${body.slice(0, 200) || res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not reach CallMeBot (${err.message})` };
  }
}

function orderMessage(order, currency = 'Rs.') {
  const money = (n) => `${currency} ${Number(n).toLocaleString('en-PK')}`;
  const c = order.customer;
  const extras = [order.manualPayment && `TID: ${order.manualPayment.reference}`, c.notes && `Note: ${c.notes}`].filter(Boolean);
  return [
    `🛍️ New order #${order.number}`,
    `${c.firstName} ${c.lastName} · ${c.phone}`,
    `${c.city} — ${c.address}`,
    '',
    ...order.items.map((i) => `${i.qty} × ${i.name}${[i.size, i.color].filter(Boolean).length ? ` (${[i.size, i.color].filter(Boolean).join(', ')})` : ''}`),
    '',
    ...(order.deliveryFee ? [`Delivery: ${money(order.deliveryFee)}`] : []),
    ...(order.pointsDiscount ? [`Points used: ${order.pointsUsed} (−${money(order.pointsDiscount)})`] : []),
    `Total: ${money(order.total)} · ${METHOD_LABELS[order.paymentMethod] || order.paymentMethod}${order.paymentStatus === 'pending' ? ' (payment pending)' : ''}`,
    ...extras,
  ].join('\n');
}

function earnMessage(a) {
  return [`💰 Earn with us form`, `${a.name} · ${a.city}`, `📞 ${a.phone}`, `✉️ ${a.email}`, a.message ? `Message: ${a.message}` : '']
    .filter(Boolean)
    .join('\n');
}

module.exports = { normalizePhone, sendWhatsApp, orderMessage, earnMessage };

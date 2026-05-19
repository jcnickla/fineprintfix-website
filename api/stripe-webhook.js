const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

async function writeAuditLog(sb, event) {
  try {
    const { error } = await sb.from('audit_log').insert(event);
    if (error) console.error('Audit log write failed:', error.message);
  } catch (e) {
    console.error('Audit log exception:', e.message);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    const rawBody = req.body instanceof Buffer
      ? req.body
      : Buffer.from(JSON.stringify(req.body));

    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    if (session.payment_status !== 'paid') {
      return res.status(200).json({ received: true });
    }

    const { user_id, user_email, doc_name } = session.metadata;

    if (!user_id) {
      console.error('No user_id in session metadata');
      return res.status(200).json({ received: true });
    }

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { realtime: { transport: ws } });

    try {
      // 1. Upsert credits
      const { error: creditError } = await sb
        .from('user_credits')
        .upsert({
          user_id,
          credits: 1,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id',
          ignoreDuplicates: false,
        });

      if (creditError) {
        await sb.rpc('increment_credits', { uid: user_id, amount: 1 });
      }

      // 2. Log the payment
      await sb.from('payments').insert({
        user_id,
        user_email,
        stripe_session_id: session.id,
        amount_cents: session.amount_total,
        currency: session.currency,
        doc_name,
        status: 'paid',
        created_at: new Date().toISOString(),
      }).select();

      // 3. Audit log — payment received
      await writeAuditLog(sb, {
        event_type: 'payment_completed',
        user_id,
        user_email,
        metadata: {
          stripe_session_id: session.id,
          amount_cents: session.amount_total,
          currency: session.currency,
          doc_name,
          plan: session.metadata?.plan || 'single',
          timestamp: new Date().toISOString(),
        }
      });

      console.log(`✓ Credit granted to user ${user_id} for ${doc_name}`);
      return res.status(200).json({ received: true });

    } catch (err) {
      console.error('Supabase error:', err);
      return res.status(200).json({ received: true, warning: 'Credit may not have been applied' });
    }
  }

  return res.status(200).json({ received: true });
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};



const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fineprintfix.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user_id, user_email, doc_name, plan } = req.body;

  if (!user_id || !user_email) {
    return res.status(400).json({ error: 'user_id and user_email required' });
  }

  // Use compare price ID for comparison pack, default for single doc
  const priceId = plan === 'compare'
    ? process.env.STRIPE_COMPARE_PRICE_ID
    : process.env.STRIPE_PRICE_ID;

  if (!priceId) {
    return res.status(500).json({ error: `Missing price ID for plan: ${plan || 'single'}` });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'payment',
      success_url: `https://www.fineprintfix.com/app.html?payment=success&plan=${plan || 'single'}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://www.fineprintfix.com/app.html?payment=cancelled`,
      customer_email: user_email,
      metadata: { user_id, user_email, doc_name: doc_name || 'Document', plan: plan || 'single' },
    });

    return res.status(200).json({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('Stripe checkout error:', err);
    return res.status(500).json({ error: err.message });
  }
};

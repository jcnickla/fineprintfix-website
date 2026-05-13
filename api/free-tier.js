const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fineprintfix.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, action } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const normalizedEmail = email.trim().toLowerCase();

  if (action === 'check') {
    // Check if this email has already used their free analysis
    const { data, error } = await sb
      .from('free_tier_usage')
      .select('id')
      .eq('email', normalizedEmail)
      .single();

    if (error && error.code !== 'PGRST116') {
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({ used: !!data });
  }

  if (action === 'record') {
    // Record this email as having used their free analysis
    const { error } = await sb
      .from('free_tier_usage')
      .insert({ email: normalizedEmail });

    if (error && error.code !== '23505') {
      // 23505 = unique violation (already exists) — that's fine
      return res.status(500).json({ error: 'Database error' });
    }

    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Invalid action' });
}

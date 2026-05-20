const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.SUPABASE_URL) return res.status(500).json({ error: 'Missing SUPABASE_URL' });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { global: { headers: {} }, realtime: { transport: ws } }
  );

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) {
    console.error('Auth error:', authError?.message);
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { doc_name, flags, sections, questions, summary, money, red_count, amber_count, green_count, paid, analysis_tier } = req.body;

  const { data, error } = await sb
    .from('analyses')
    .insert({
      user_id: user.id,
      doc_name: doc_name || 'Untitled document',
      flags: flags || [],
      sections: sections || [],
      questions: questions || [],
      summary: summary || {},
      money: money || {},
      red_count: red_count || 0,
      amber_count: amber_count || 0,
      green_count: green_count || 0,
      paid: paid || false,
      analysis_tier: analysis_tier || 'standard',
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error:', JSON.stringify(error));
    return res.status(500).json({ error: 'Failed to save analysis', detail: error.message });
  }

  return res.status(200).json({ id: data.id });
}



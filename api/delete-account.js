const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// ─── AUDIT LOG HELPER ─────────────────────────────────────────────────────────
async function writeAuditLog(sb, event) {
  try {
    const { error } = await sb.from('audit_log').insert(event);
    if (error) console.error('Audit log write failed:', error.message);
  } catch (e) {
    console.error('Audit log exception:', e.message);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://www.fineprintfix.com');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.SUPABASE_URL) return res.status(500).json({ error: 'Missing SUPABASE_URL' });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const userAgent = req.headers['user-agent'] || 'unknown';

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  );

  // Verify the user's token
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) {
    console.error('Auth error:', authError?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const userId = user.id;
  const userEmail = user.email;
  console.log(`Starting account deletion for user: ${userId} (${userEmail})`);

  // ── AUDIT: deletion requested ──────────────────────────────────
  await writeAuditLog(sb, {
    event_type: 'account_deletion_requested',
    user_id: userId,
    user_email: userEmail,
    ip_address: ip,
    user_agent: userAgent,
    metadata: {
      confirmed_by_user: true,
      confirmation_method: 'typed_DELETE',
      timestamp: new Date().toISOString(),
    }
  });

  const deletionResults = {};

  // ── 1. Delete all analyses ─────────────────────────────────────
  const { error: analysesError, count: analysesCount } = await sb
    .from('analyses')
    .delete({ count: 'exact' })
    .eq('user_id', userId);

  deletionResults.analyses = analysesError ? 'failed' : 'success';
  if (analysesError) {
    console.error('Failed to delete analyses:', analysesError.message);
  } else {
    console.log(`✓ Deleted ${analysesCount || 0} analyses for ${userId}`);
  }

  // ── 2. Delete user credits ─────────────────────────────────────
  const { error: creditsError } = await sb
    .from('user_credits')
    .delete()
    .eq('user_id', userId);

  deletionResults.credits = creditsError ? 'failed' : 'success';
  if (creditsError) console.error('Failed to delete credits:', creditsError.message);

  // ── 3. Delete payment records ──────────────────────────────────
  const { error: paymentsError } = await sb
    .from('payments')
    .delete()
    .eq('user_id', userId);

  deletionResults.payments = paymentsError ? 'failed' : 'success';
  if (paymentsError) console.error('Failed to delete payments:', paymentsError.message);

  // ── 4. Delete free_tier_usage by email ─────────────────────────
  if (userEmail) {
    const { error: freeTierError } = await sb
      .from('free_tier_usage')
      .delete()
      .eq('email', userEmail);

    deletionResults.free_tier_usage = freeTierError ? 'failed' : 'success';
    if (freeTierError) console.error('Failed to delete free tier usage:', freeTierError.message);
  }

  // ── 5. Delete the auth account itself ─────────────────────────
  const { error: deleteUserError } = await sb.auth.admin.deleteUser(userId);
  deletionResults.auth_account = deleteUserError ? 'failed' : 'success';

  if (deleteUserError) {
    console.error('Failed to delete auth user:', deleteUserError.message);

    // ── AUDIT: partial failure ────────────────────────────────────
    await writeAuditLog(sb, {
      event_type: 'account_deletion_partial_failure',
      user_id: userId,
      user_email: userEmail,
      ip_address: ip,
      user_agent: userAgent,
      metadata: {
        deletion_results: deletionResults,
        error: deleteUserError.message,
        timestamp: new Date().toISOString(),
      }
    });

    return res.status(500).json({
      error: 'Account data deleted but auth account could not be removed. Please contact legal@fineprintfix.com.',
      dataDeleted: true,
      authDeleted: false,
    });
  }

  // ── AUDIT: deletion complete ───────────────────────────────────
  // Note: user_id is kept in the audit log for legal record even though auth account is gone
  await writeAuditLog(sb, {
    event_type: 'account_deletion_complete',
    user_id: userId,
    user_email: userEmail,
    ip_address: ip,
    user_agent: userAgent,
    metadata: {
      deletion_results: deletionResults,
      analyses_deleted: analysesCount || 0,
      timestamp: new Date().toISOString(),
      completed: true,
    }
  });

  console.log(`✓ Full account deletion complete for ${userId} (${userEmail})`);

  return res.status(200).json({
    success: true,
    message: 'Account and all associated data permanently deleted.',
    dataDeleted: true,
    authDeleted: true,
  });
};

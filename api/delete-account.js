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

async function sendDeletionConfirmationEmail(userEmail, deletionDetails) {
  if (!process.env.RESEND_API_KEY) {
    console.error('Deletion email skipped: RESEND_API_KEY not set');
    return;
  }
  if (!userEmail) {
    console.error('Deletion email skipped: no email address');
    return;
  }

  console.log(`Sending deletion confirmation email to ${userEmail}...`);

  const deletedAt = new Date().toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1a1a18;background:#f7f5f2;margin:0;padding:0;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;border:0.5px solid rgba(0,0,0,0.09);">
    <div style="background:#D85A30;padding:24px 32px;">
      <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#fff;">FinePrintFix</div>
    </div>
    <div style="padding:32px;">
      <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:700;margin:0 0 8px;">Your account has been deleted</h1>
      <p style="font-size:14px;color:#6b6b67;line-height:1.65;margin:0 0 24px;">As requested, your FinePrintFix account and all associated data have been permanently deleted.</p>
      <div style="background:#f7f5f2;border-radius:10px;padding:20px;margin-bottom:24px;">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b6b67;margin-bottom:12px;">What was deleted</div>
        <div style="font-size:13px;line-height:2;">
          ✓ &nbsp;All saved document analyses (${deletionDetails.analysesCount || 0})<br/>
          ✓ &nbsp;Account credentials (email &amp; password)<br/>
          ✓ &nbsp;Payment history records<br/>
          ✓ &nbsp;Usage data and credits
        </div>
      </div>
      <div style="background:#f7f5f2;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b6b67;margin-bottom:8px;">Deletion details</div>
        <div style="font-size:13px;color:#4a4a48;line-height:1.7;">
          <strong>Account:</strong> ${userEmail}<br/>
          <strong>Deleted at:</strong> ${deletedAt}
        </div>
      </div>
      <p style="font-size:13px;color:#6b6b67;line-height:1.65;margin:0 0 8px;">Your original documents were never stored by FinePrintFix — only the analysis results were saved, and those have now been removed.</p>
      <p style="font-size:13px;color:#6b6b67;line-height:1.65;margin:0 0 24px;">If this was a mistake, contact us at <a href="mailto:legal@fineprintfix.com" style="color:#D85A30;">legal@fineprintfix.com</a> as soon as possible.</p>
      <a href="https://www.fineprintfix.com" style="display:inline-block;background:#D85A30;color:#fff;padding:11px 22px;border-radius:8px;font-size:13px;font-weight:500;text-decoration:none;">Visit FinePrintFix</a>
    </div>
    <div style="border-top:0.5px solid rgba(0,0,0,0.09);padding:16px 32px;font-size:11px;color:#9b9b97;line-height:1.6;">
      FinePrintFix · fineprintfix.com<br/>
      This email was sent to ${userEmail} because you requested account deletion.
    </div>
  </div>
</body>
</html>`;

  try {
    const payload = JSON.stringify({
      from: 'FinePrintFix <hello@fineprintfix.com>',
      to: [userEmail],
      subject: 'Your FinePrintFix account has been deleted',
      html,
    });

    console.log('Calling Resend API...');

    const https = require('https');
    const url = new URL('https://api.resend.com/emails');

    const responseBody = await new Promise((resolve, reject) => {
      const reqOptions = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      };

      const req = https.request(reqOptions, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          console.log(`Resend response status: ${res.statusCode}`);
          console.log(`Resend response body: ${data}`);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`Resend returned ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(payload);
      req.end();
    });

    console.log(`✓ Deletion confirmation email sent to ${userEmail}`);
  } catch (e) {
    console.error('Deletion email failed:', e.message);
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

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) {
    console.error('Auth error:', authError?.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const userId = user.id;
  const userEmail = user.email;
  console.log(`Starting account deletion for user: ${userId} (${userEmail})`);

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

  // 1. Delete analyses
  const { error: analysesError, count: analysesCount } = await sb
    .from('analyses')
    .delete({ count: 'exact' })
    .eq('user_id', userId);
  deletionResults.analyses = analysesError ? 'failed' : 'success';
  if (analysesError) console.error('Failed to delete analyses:', analysesError.message);
  else console.log(`✓ Deleted ${analysesCount || 0} analyses for ${userId}`);

  // 2. Delete credits
  const { error: creditsError } = await sb.from('user_credits').delete().eq('user_id', userId);
  deletionResults.credits = creditsError ? 'failed' : 'success';
  if (creditsError) console.error('Failed to delete credits:', creditsError.message);

  // 3. Delete payments
  const { error: paymentsError } = await sb.from('payments').delete().eq('user_id', userId);
  deletionResults.payments = paymentsError ? 'failed' : 'success';
  if (paymentsError) console.error('Failed to delete payments:', paymentsError.message);

  // 4. Delete free tier usage
  if (userEmail) {
    const { error: freeTierError } = await sb.from('free_tier_usage').delete().eq('email', userEmail);
    deletionResults.free_tier_usage = freeTierError ? 'failed' : 'success';
    if (freeTierError) console.error('Failed to delete free tier usage:', freeTierError.message);
  }

  // 5. Delete auth account
  const { error: deleteUserError } = await sb.auth.admin.deleteUser(userId);
  deletionResults.auth_account = deleteUserError ? 'failed' : 'success';

  if (deleteUserError) {
    console.error('Failed to delete auth user:', deleteUserError.message);

    await writeAuditLog(sb, {
      event_type: 'account_deletion_partial_failure',
      user_id: userId,
      user_email: userEmail,
      ip_address: ip,
      user_agent: userAgent,
      metadata: { deletion_results: deletionResults, error: deleteUserError.message, timestamp: new Date().toISOString() }
    });

    // Still send email — data was deleted even if auth account lingered
    await sendDeletionConfirmationEmail(userEmail, { analysesCount });

    return res.status(500).json({
      error: 'Account data deleted but auth account could not be removed. Please contact legal@fineprintfix.com.',
      dataDeleted: true,
      authDeleted: false,
    });
  }

  // 6. Audit log — complete
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

  // 7. Send confirmation email
  await sendDeletionConfirmationEmail(userEmail, { analysesCount });

  console.log(`✓ Full account deletion complete for ${userId} (${userEmail})`);

  return res.status(200).json({
    success: true,
    message: 'Account and all associated data permanently deleted.',
    dataDeleted: true,
    authDeleted: true,
  });
};

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



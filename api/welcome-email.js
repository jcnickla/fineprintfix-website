module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify this request is coming from Supabase webhook
  const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const signature = req.headers['x-supabase-signature'];
    if (signature !== webhookSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const { record } = req.body;
  if (!record || !record.email) {
    return res.status(400).json({ error: 'Missing user record' });
  }

  const userName = record.raw_user_meta_data?.full_name || record.email.split('@')[0];
  const firstName = userName.split(' ')[0];

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'FinePrintFix <hello@fineprintfix.com>',
        to: record.email,
        subject: `Welcome to FinePrintFix, ${firstName} 👋`,
        html: buildEmailHTML(firstName),
        text: buildEmailText(firstName),
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    const data = await response.json();
    console.log('Welcome email sent:', data.id, 'to', record.email);
    return res.status(200).json({ success: true, id: data.id });

  } catch (err) {
    console.error('Email error:', err);
    return res.status(500).json({ error: err.message });
  }
};

function buildEmailHTML(firstName) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to FinePrintFix</title>
</head>
<body style="margin:0;padding:0;background:#f7f5f2;font-family:'DM Sans',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- LOGO -->
          <tr>
            <td style="padding-bottom:24px;text-align:center;">
              <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#1a1a18;">Fine<span style="color:#D85A30;">Print</span>Fix</span>
            </td>
          </tr>

          <!-- MAIN CARD -->
          <tr>
            <td style="background:#ffffff;border-radius:14px;border:0.5px solid rgba(0,0,0,0.1);overflow:hidden;">

              <!-- HEADER BAR -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#D85A30;padding:28px 32px;">
                    <p style="margin:0;font-size:13px;font-weight:500;color:rgba(255,255,255,0.75);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">You're in 🎉</p>
                    <h1 style="margin:0;font-family:Georgia,serif;font-size:28px;font-weight:700;color:#ffffff;line-height:1.2;">Welcome, ${firstName}!</h1>
                  </td>
                </tr>
              </table>

              <!-- BODY -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:28px 32px;">

                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#1a1a18;">
                      We're really glad you're here. FinePrintFix was built for moments like this — when you've got a contract in front of you and just want to know what it actually means before you sign.
                    </p>

                    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#6b6b67;">
                      Here's what you can do with your free account:
                    </p>

                    <!-- FEATURE 1 -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                      <tr>
                        <td width="44" valign="top">
                          <div style="width:36px;height:36px;background:#FAECE7;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">📄</div>
                        </td>
                        <td style="padding-left:12px;">
                          <p style="margin:0 0 3px;font-size:14px;font-weight:600;color:#1a1a18;">Analyze any document</p>
                          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b67;">Upload a PDF or paste text. Get a full breakdown in under 90 seconds — Summary, Flags, Money analysis, and more. All in plain English.</p>
                        </td>
                      </tr>
                    </table>

                    <!-- FEATURE 2 -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:14px;">
                      <tr>
                        <td width="44" valign="top">
                          <div style="width:36px;height:36px;background:#FAECE7;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">⚠️</div>
                        </td>
                        <td style="padding-left:12px;">
                          <p style="margin:0 0 3px;font-size:14px;font-weight:600;color:#1a1a18;">See exactly what to push back on</p>
                          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b67;">Red flags, amber warnings, and word-for-word negotiation scripts you can use right away. No legal background needed.</p>
                        </td>
                      </tr>
                    </table>

                    <!-- FEATURE 3 -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                      <tr>
                        <td width="44" valign="top">
                          <div style="width:36px;height:36px;background:#FAECE7;border-radius:8px;text-align:center;line-height:36px;font-size:18px;">⇄</div>
                        </td>
                        <td style="padding-left:12px;">
                          <p style="margin:0 0 3px;font-size:14px;font-weight:600;color:#1a1a18;">Compare documents side by side</p>
                          <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b67;">Deciding between two job offers or two leases? Select any saved analyses and get pros, cons, category winners, and a clear recommendation.</p>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA BUTTON -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                      <tr>
                        <td align="center">
                          <a href="https://www.fineprintfix.com/app.html"
                             style="display:inline-block;background:#D85A30;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;">
                            Analyze your first document →
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- DIVIDER -->
                    <hr style="border:none;border-top:0.5px solid rgba(0,0,0,0.1);margin:0 0 20px;" />

                    <p style="margin:0;font-size:13px;line-height:1.65;color:#6b6b67;">
                      Got a question or just want to say hi? Reply to this email — we'd love to hear from you.
                    </p>

                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:20px 0;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:#6b6b67;">
                <a href="https://www.fineprintfix.com" style="color:#6b6b67;text-decoration:none;">fineprintfix.com</a>
                &nbsp;·&nbsp;
                <a href="https://www.fineprintfix.com/legal.html" style="color:#6b6b67;text-decoration:none;">Terms & Disclaimer</a>
              </p>
              <p style="margin:0;font-size:11px;color:#9b9b96;line-height:1.5;">
                AI-powered analysis for informational purposes only — not legal advice.<br />
                You're receiving this because you created a FinePrintFix account.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildEmailText(firstName) {
  return `Welcome to FinePrintFix, ${firstName}!

We're really glad you're here. FinePrintFix was built for moments like this — when you've got a contract in front of you and just want to know what it actually means before you sign.

Here's what you can do with your free account:

📄 ANALYZE ANY DOCUMENT
Upload a PDF or paste text. Get a full breakdown in under 90 seconds — Summary, Flags, Money analysis, and more. All in plain English.

⚠ SEE EXACTLY WHAT TO PUSH BACK ON
Red flags, amber warnings, and word-for-word negotiation scripts you can use right away. No legal background needed.

⇄ COMPARE DOCUMENTS SIDE BY SIDE
Deciding between two job offers or two leases? Select any saved analyses and get pros, cons, and a clear recommendation.

Analyze your first document → https://www.fineprintfix.com/app.html

Got a question or just want to say hi? Reply to this email — we'd love to hear from you.

—
fineprintfix.com
AI-powered analysis for informational purposes only — not legal advice.
`;
}

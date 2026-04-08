export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { suggestion } = req.body || {};

  if (!suggestion || !suggestion.trim()) {
    return res.status(400).json({ error: 'Suggestion is empty' });
  }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  try {
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'suggestions@resend.dev',
        to: 'loden.campbell@gmail.com',
        subject: 'MicheLeaderboard — New Suggestion',
        text: suggestion.trim()
      })
    });

    if (!emailRes.ok) {
      const err = await emailRes.json().catch(() => ({}));
      console.error('Resend error:', err);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Suggest API error:', err);
    return res.status(503).json({ error: 'Network error' });
  }
}

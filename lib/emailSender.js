// Sends verification emails via Gmail using Nodemailer.
// Requires a Gmail "App Password" — see project README for setup.

import nodemailer from 'nodemailer';

let cachedTransporter = null;

function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('GMAIL_USER or GMAIL_APP_PASSWORD is not set in environment variables');
  }

  cachedTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  return cachedTransporter;
}

export async function sendVerificationEmail(toEmail, code) {
  const transporter = getTransporter();

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;background:#FEF9EC;border-radius:12px">
      <div style="font-size:24px;font-weight:900;color:#0D2347;letter-spacing:1px;text-align:center">★ AMERICANKA ★</div>
      <div style="text-align:center;color:#6b6b6b;font-size:12px;margin-top:4px">Пляж 13 · Станція Фонтана · Одеса</div>
      <hr style="border:none;border-top:1px solid #DDD0A8;margin:18px 0"/>
      <p style="color:#1a1a1a;font-size:14px">Ваш код підтвердження email:</p>
      <div style="text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;color:#0D2347;padding:14px;background:#fff;border-radius:10px;border:1px solid #DDD0A8">
        ${code}
      </div>
      <p style="color:#6b6b6b;font-size:12px;margin-top:16px">Код дійсний протягом 5 хвилин.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"AMERICANKA" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: `Ваш код підтвердження: ${code}`,
    html,
  });
}

// Quick SMTP connectivity/auth check: npx tsx server/scripts/test-smtp.ts
import 'dotenv/config';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

transporter.verify()
  .then(() => { console.log(`✓ SMTP OK — connected & authenticated to ${process.env.SMTP_HOST}:${process.env.SMTP_PORT}`); process.exit(0); })
  .catch((err) => { console.error('✗ SMTP FAILED:', err?.message ?? err); process.exit(1); });

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { config } from './config.js';

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  const { host, user, pass, from } = config.smtp;
  return Boolean(host && user && pass && from);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure, // true for 465, false for 587/STARTTLS
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

export async function sendMail(opts: { to: string; subject: string; html: string; text: string }): Promise<void> {
  if (!isMailConfigured()) throw new Error('SMTP is not configured');
  const from = config.smtp.fromName
    ? `"${config.smtp.fromName}" <${config.smtp.from}>`
    : config.smtp.from;
  await getTransporter().sendMail({
    from,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

const roleLabels: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  user: 'User',
};

export function buildInviteEmail(opts: { email: string; role: string; inviteUrl: string; inviterName?: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const roleLabel = roleLabels[opts.role] ?? opts.role;
  const inviter = opts.inviterName ? `${opts.inviterName} has invited you` : 'You have been invited';
  const subject = 'You have been invited to E-Vault Password Manager';
  const text = `${inviter} to join E-Vault Password Manager as ${roleLabel}.

Accept your invitation and set up your account here:
${opts.inviteUrl}

This invitation expires in 7 days. If you did not expect this email, you can ignore it.

— E-Vault Password Manager`;

  const html = `<!doctype html>
<html><body style="margin:0;background:#0a0e1a;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e1a;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#11162a;border:1px solid rgba(148,163,184,0.16);border-radius:16px;overflow:hidden;">
        <tr><td style="padding:22px 28px;background:linear-gradient(135deg,#38bdf8,#6366f1);">
          <span style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.01em;">🔒 E-Vault Password Manager</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#f8fafc;font-weight:800;">${escapeHtml(inviter)} to E-Vault Password Manager</h1>
          <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;line-height:1.6;">
            You've been invited to join <strong style="color:#f8fafc;">E-Vault Password Manager</strong> as <strong style="color:#f8fafc;">${escapeHtml(roleLabel)}</strong>.
            Accept your invitation to create your account and set up your encrypted vault.
          </p>
          <p style="margin:24px 0;">
            <a href="${escapeAttr(opts.inviteUrl)}" style="display:inline-block;padding:13px 26px;background:linear-gradient(135deg,#38bdf8,#6366f1);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:14px;">Accept invitation</a>
          </p>
          <p style="margin:0 0 6px;color:#94a3b8;font-size:12px;line-height:1.5;">Or paste this link into your browser:</p>
          <p style="margin:0 0 18px;color:#7dd3fc;font-size:12px;word-break:break-all;">${escapeHtml(opts.inviteUrl)}</p>
          <p style="margin:0;color:#6b7491;font-size:12px;line-height:1.5;">This invitation expires in 7 days. If you didn't expect this, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

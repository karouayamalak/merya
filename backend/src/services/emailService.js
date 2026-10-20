import nodemailer from 'nodemailer';

/**
 * emailService.js — Optional SMTP Email Delivery for MERYA DZ
 *
 * Sends transactional emails such as Password Reset verification codes.
 * Operates gracefully: if SMTP is not configured in .env, skips with a notice
 * rather than throwing unhandled exceptions.
 */

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (!host || !user || !pass) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass
    }
  });

  return transporter;
}

/**
 * Send password reset verification code to an administrator's email.
 */
export async function sendPasswordResetEmail({ to, username, otp }) {
  const mailer = getTransporter();

  if (!mailer) {
    console.log('[Email] SMTP is not configured in .env (SMTP_HOST, SMTP_USER, SMTP_PASS). Skipping email dispatch.');
    return false;
  }

  const from = process.env.EMAIL_FROM || `"MERYA DZ" <${process.env.SMTP_USER}>`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 12px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #1a1a1a; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase;">MERYA DZ</h2>
        <p style="color: #666; font-size: 13px; margin-top: 4px;">Portail d'Administration Sécurisé</p>
      </div>

      <p style="font-size: 15px; color: #333; line-height: 1.5;">Bonjour <strong>${username || 'Administrateur'}</strong>,</p>
      <p style="font-size: 14px; color: #555; line-height: 1.6;">
        Vous avez demandé la réinitialisation de votre mot de passe pour accéder au portail d'administration.
      </p>

      <div style="background-color: #f7f7f7; border: 1px dashed #dcdcdc; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0;">
        <span style="font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.1em; display: block; margin-bottom: 8px;">Votre Code de Vérification</span>
        <span style="font-family: monospace, Courier; font-size: 32px; font-weight: 700; color: #111; letter-spacing: 0.25em;">${otp}</span>
        <span style="font-size: 12px; color: #999; display: block; margin-top: 8px;">(Ce code expire dans 10 minutes)</span>
      </div>

      <p style="font-size: 13px; color: #777; line-height: 1.5;">
        Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité. Votre mot de passe actuel restera inchangé.
      </p>

      <hr style="border: none; border-top: 1px solid #f0f0f0; margin: 24px 0;" />
      <p style="font-size: 11px; color: #aaa; text-align: center; margin: 0;">
        MERYA DZ — Système de Sécurité Automatisé
      </p>
    </div>
  `;

  try {
    await mailer.sendMail({
      from,
      to,
      subject: `[MERYA DZ] Code de réinitialisation de mot de passe : ${otp}`,
      text: `Bonjour ${username || 'Administrateur'},\n\nVotre code de réinitialisation est : ${otp}\nIl est valable pendant 10 minutes.\n\nSi vous n'êtes pas à l'origine de cette demande, veuillez ignorer ce message.`,
      html
    });
    console.log(`[Email] Password reset verification sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.warn(`[Email] Failed to send email via SMTP: ${error.message}`);
    return false;
  }
}

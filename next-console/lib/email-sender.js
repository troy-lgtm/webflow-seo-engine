import fs from "fs";
import path from "path";
import { resolveFromRoot } from "./fs/project-root.js";

/**
 * Create a Nodemailer transport from environment variables.
 * Uses Gmail SMTP with app password authentication.
 */
export async function createTransportFromEnv() {
  const { EMAIL_USER, EMAIL_APP_PASSWORD } = process.env;
  if (!EMAIL_USER) throw new Error("Missing EMAIL_USER environment variable.");
  if (!EMAIL_APP_PASSWORD) throw new Error("Missing EMAIL_APP_PASSWORD environment variable.");

  const nodemailer = await import("nodemailer");
  return nodemailer.default.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: EMAIL_USER, pass: EMAIL_APP_PASSWORD }
  });
}

/**
 * Verify that the SMTP transport can connect and authenticate.
 * Returns { ok: true } or { ok: false, error: string }.
 */
export async function verifyTransport(transport) {
  try {
    await transport.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Write a debug run log to artifacts/ship/run_log.json.
 * Never includes secrets.
 */
export function writeRunLog({ artifactsDir, dryRun, emailAttempted, emailSent, messageId, errorSummary, from, to, subject }) {
  const dir = artifactsDir || resolveFromRoot("artifacts", "ship");
  fs.mkdirSync(dir, { recursive: true });
  const log = {
    timestamp: new Date().toISOString(),
    dryRun: !!dryRun,
    emailAttempted: !!emailAttempted,
    emailSent: !!emailSent,
    messageId: messageId || null,
    errorSummary: errorSummary || null,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    from: from || process.env.EMAIL_USER || "(not set)",
    to: to || process.env.EMAIL_TO || "(not set)",
    subject: subject || "(not set)"
  };
  fs.writeFileSync(path.join(dir, "run_log.json"), JSON.stringify(log, null, 2));
  return log;
}

/**
 * Send a draft email via Gmail SMTP or write artifacts in dry run mode.
 *
 * @param {object} opts
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {Array} opts.attachments - [{filename, content|path}]
 * @param {boolean} opts.dryRun - if true, write to artifacts instead of sending
 * @param {string} [opts.artifactsDir] - where to write dry run output
 */
export async function sendDraftEmail({ subject, html, attachments, dryRun = true, artifactsDir }) {
  const dir = artifactsDir || resolveFromRoot("artifacts", "ship");
  fs.mkdirSync(dir, { recursive: true });

  if (dryRun) {
    const payload = {
      to: process.env.EMAIL_TO || "(dry run — no recipient)",
      from: process.env.EMAIL_USER || "(dry run — no sender)",
      subject,
      html_preview: html.slice(0, 500) + "...",
      html_length: html.length,
      attachment_filenames: (attachments || []).map((a) => a.filename),
      dry_run: true,
      generated_at: new Date().toISOString()
    };

    const outputPath = path.join(dir, "email_payload.json");
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

    writeRunLog({ artifactsDir: dir, dryRun: true, emailAttempted: false, emailSent: false, subject });
    return { success: true, dryRun: true, outputPath };
  }

  // Real send via Nodemailer
  const { EMAIL_USER, EMAIL_TO } = process.env;
  if (!EMAIL_USER) throw new Error("Missing EMAIL_USER environment variable.");
  if (!EMAIL_TO) throw new Error("Missing EMAIL_TO environment variable.");

  let transport;
  try {
    transport = await createTransportFromEnv();
  } catch (err) {
    writeRunLog({ artifactsDir: dir, dryRun: false, emailAttempted: true, emailSent: false, errorSummary: `Transport creation failed: ${err.message}`, from: EMAIL_USER, to: EMAIL_TO, subject });
    throw err;
  }

  // Verify SMTP connection before sending
  const verification = await verifyTransport(transport);
  if (!verification.ok) {
    writeRunLog({ artifactsDir: dir, dryRun: false, emailAttempted: true, emailSent: false, errorSummary: `SMTP verify failed: ${verification.error}`, from: EMAIL_USER, to: EMAIL_TO, subject });
    throw new Error(`SMTP verification failed: ${verification.error}`);
  }

  const mailOptions = {
    from: EMAIL_USER,
    to: EMAIL_TO,
    subject,
    html,
    attachments: (attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content || undefined,
      path: a.path || undefined
    }))
  };

  try {
    const info = await transport.sendMail(mailOptions);
    writeRunLog({ artifactsDir: dir, dryRun: false, emailAttempted: true, emailSent: true, messageId: info.messageId, from: EMAIL_USER, to: EMAIL_TO, subject });
    return { success: true, dryRun: false, messageId: info.messageId };
  } catch (err) {
    writeRunLog({ artifactsDir: dir, dryRun: false, emailAttempted: true, emailSent: false, errorSummary: `sendMail failed: ${err.message}`, from: EMAIL_USER, to: EMAIL_TO, subject });
    throw err;
  }
}

import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

export function smtpConfigFromEnv(env = process.env) {
  return {
    host: env.SMTP_HOST,
    port: Number.parseInt(env.SMTP_PORT || "465", 10),
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM || env.SMTP_USER
  };
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const RESEND_TEST_SENDER = "Kordexa <onboarding@resend.dev>";
const RESEND_TIMEOUT_MS = 15000;
const RESEND_MAX_ATTEMPTS = 3;

export function resendConfigFromEnv(env = process.env) {
  if (!env.RESEND_API_KEY) return null;
  return { apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM || RESEND_TEST_SENDER };
}

// The key stays the same for one learner's plan day, so a retry can't send twice.
export function dailyEmailKey(to, startDate, day) {
  const learner = crypto.createHash("sha256").update(String(to).toLowerCase()).digest("hex").slice(0, 24);
  return `kordexa-${learner}-${startDate || "unscheduled"}-day-${day}`;
}

export async function sendWithResend({ resend, message, idempotencyKey, wait = delay }) {
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        headers: {
          authorization: `Bearer ${resend.apiKey}`,
          "content-type": "application/json",
          "user-agent": "kordexa-cli",
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
        },
        body: JSON.stringify({ from: resend.from, to: [message.to], subject: message.subject, html: message.html, text: message.text })
      });
    } catch {
      if (attempt < RESEND_MAX_ATTEMPTS) {
        await wait(attempt * 1000);
        continue;
      }
      throw new Error("Couldn't reach Resend. Check your internet connection and try again.");
    }
    if (response.ok) {
      const { id } = await response.json();
      return { sent: true, to: message.to, subject: message.subject, transport: "resend", id };
    }
    if ((response.status === 429 || response.status >= 500) && attempt < RESEND_MAX_ATTEMPTS) {
      const retryAfter = Number(response.headers?.get?.("retry-after"));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 1000);
      continue;
    }
    throw new Error(await resendErrorMessage(response, message.to));
  }
}

async function resendErrorMessage(response, to) {
  const details = await response.json().catch(() => ({}));
  const reason = String(details.message || "");
  if (response.status === 401 || /api key/i.test(reason)) {
    return "Resend didn't accept the API key. Create a new key at resend.com/api-keys and update RESEND_API_KEY in .env.local.";
  }
  if (response.status === 403 && /testing emails|verify a domain/i.test(reason)) {
    return `Resend's free test sender can only email the address on your Resend account, so it can't send to ${to}. Use that address, or verify a domain in Resend.`;
  }
  if (response.status === 429) return "Resend's sending limit was reached. Please try again later.";
  return `Resend couldn't send this email (error ${response.status}). ${reason}`.trim();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendMail({ smtp, message, dryRun = false }) {
  if (dryRun) {
    return { dryRun: true, message };
  }
  validateSmtp(smtp);
  // Port 465 = implicit TLS. Anything else (e.g. 587) starts plaintext and
  // upgrades via STARTTLS. Both paths end fully encrypted before AUTH.
  const implicitTls = smtp.port === 465;
  let socket = implicitTls
    ? tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host })
    : net.connect({ host: smtp.host, port: smtp.port });
  const timeoutMs = 15000;
  socket.setTimeout(timeoutMs);
  socket.once("timeout", () => {
    socket.destroy(new Error(`SMTP connection timed out after ${timeoutMs}ms`));
  });
  let client = new SmtpClient(socket);
  await client.expect(220);
  await client.command("EHLO kordexa.local", 250);
  if (!implicitTls) {
    await client.command("STARTTLS", 220);
    socket = await upgradeToTls(socket, smtp.host);
    client = new SmtpClient(socket);
    await client.command("EHLO kordexa.local", 250);
  }
  await client.command("AUTH LOGIN", 334);
  await client.command(Buffer.from(smtp.user).toString("base64"), 334);
  await client.command(Buffer.from(smtp.pass).toString("base64"), 235);
  await client.command(`MAIL FROM:<${smtp.from}>`, 250);
  await client.command(`RCPT TO:<${message.to}>`, 250);
  await client.command("DATA", 354);
  await client.raw(renderSmtpMessage(smtp.from, message));
  await client.expect(250);
  await client.command("QUIT", 221);
  socket.end();
  return { sent: true, to: message.to, subject: message.subject, transport: implicitTls ? "implicit-tls" : "starttls" };
}

function upgradeToTls(socket, host) {
  // Hand the plaintext socket to the TLS layer after STARTTLS. Detach the old
  // plaintext reader first so it does not consume encrypted bytes.
  socket.removeAllListeners("data");
  socket.removeAllListeners("error");
  socket.removeAllListeners("timeout");
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: host }, () => {
      secureSocket.setTimeout(15000);
      secureSocket.once("timeout", () => {
        secureSocket.destroy(new Error("SMTP connection timed out after 15000ms"));
      });
      resolve(secureSocket);
    });
    secureSocket.once("error", reject);
  });
}

function validateSmtp(smtp) {
  for (const key of ["host", "port", "user", "pass", "from"]) {
    if (!smtp[key]) throw new Error(`Missing SMTP config: ${key}`);
  }
}

function renderSmtpMessage(from, message) {
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@kordexa>`,
    "MIME-Version: 1.0"
  ];
  if (message.html) {
    const boundary = `eo_${crypto.randomBytes(12).toString("hex")}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(message.text),
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(message.html),
      `--${boundary}--`,
      ".",
      ""
    ].join("\r\n");
  }
  return [
    ...headers,
    "Content-Type: text/plain; charset=utf-8",
    "",
    dotStuff(message.text),
    ".",
    ""
  ].join("\r\n");
}

// base64 split into 76-char lines (RFC 2045); base64 never starts a line with
// "." so no SMTP dot-stuffing is needed for these parts.
function base64Lines(value) {
  return (Buffer.from(String(value), "utf8").toString("base64").match(/.{1,76}/g) || [""]).join("\r\n");
}

function dotStuff(text) {
  return String(text).replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

class SmtpClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = "";
    this.waiters = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      this.buffer += chunk;
      this.flush();
    });
    socket.on("error", (error) => {
      for (const waiter of this.waiters.splice(0)) waiter.reject(error);
    });
  }

  raw(line) {
    this.socket.write(line);
  }

  async command(line, code) {
    this.socket.write(`${line}\r\n`);
    return this.expect(code);
  }

  expect(code) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ code: String(code), resolve, reject });
      this.flush();
    });
  }

  flush() {
    if (!this.buffer.includes("\n") || this.waiters.length === 0) return;
    const lines = this.buffer.split(/\r?\n/).filter(Boolean);
    const last = lines[lines.length - 1] || "";
    const waiter = this.waiters[0];
    if (last.startsWith(waiter.code)) {
      this.waiters.shift();
      this.buffer = "";
      waiter.resolve(last);
    } else if (/^[45]\d\d/.test(last)) {
      this.waiters.shift();
      this.buffer = "";
      waiter.reject(new Error(last));
    }
  }
}

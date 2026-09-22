import type { WalnutBaseContext } from './walnut';
import * as fs from 'fs';
import * as path from 'path';
import { google } from 'googleapis';
import type { Auth } from 'googleapis';

/** @walnut_method
 * name: Read OTP from Gmail Using Json Credentials File
 * description: Fetch the latest otp from gmail using credentials at ${credentialFilePath} and store in $[OTP]
 * actionType: custom_read_otp_gmail
 * context: shared
 * needsLocator: false
 * category: Email Automation
 */
export async function readOtpFromGmail(ctx: WalnutBaseContext) {
  // ctx.args[0] = credentialFilePath  (from ${credentialFilePath})
  // ctx.args[1] = "OTP"               (variable name from $[OTP])

  const credentialFilePath: string = ctx.args[0];
  const outputVar: string = ctx.args[1];

  if (!credentialFilePath) {
    throw new Error('credentialFilePath is required — pass the path to your Google service-account or OAuth2 JSON file.');
  }
  if (!outputVar) {
    throw new Error('Output variable name is required — ensure $[OTP] is present in the step description.');
  }

  // ── 1. Load & validate credential file ────────────────────────────────────
  // Detect whether the input is a local file path or a Walnut artifact reference:
  //   • If the path exists on disk (absolute or relative) → use it directly
  //   • Otherwise → treat it as a Walnut artifact name/ID and resolve via ctx.resolveArtifact
  ctx.log(`Resolving credential source: "${credentialFilePath}"`);

  const localPath = path.isAbsolute(credentialFilePath)
    ? credentialFilePath
    : path.resolve(process.cwd(), credentialFilePath);

  let resolvedPath: string;
  if (fs.existsSync(localPath)) {
    resolvedPath = localPath;
    ctx.log(`Using local file: ${resolvedPath}`);
  } else {
    ctx.log(`Local file not found — treating as Walnut artifact: "${credentialFilePath}"`);
    resolvedPath = await ctx.resolveArtifact(credentialFilePath);
    ctx.log(`Artifact resolved to: ${resolvedPath}`);
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Credential file not found: "${credentialFilePath}"\n` +
      'Provide either a valid local file path or a Walnut artifact name/ID.'
    );
  }

  const rawCreds = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));

  // ── 2. Log Google Cloud project from credential file ──────────────────────
  // The project_id is embedded in every service-account and OAuth2 JSON —
  // no separate Google Cloud project input is needed.
  const projectId: string | undefined =
    rawCreds.project_id ||
    rawCreds.quota_project_id ||
    (rawCreds.installed || rawCreds.web)?.project_id;

  if (projectId) {
    ctx.log(`Google Cloud Project: ${projectId}`);
  } else {
    ctx.warn('project_id not found in credential file — proceeding anyway.');
  }

  // ── 3. Authenticate ────────────────────────────────────────────────────────
  let auth: Auth.GoogleAuth | Auth.OAuth2Client;

  if (rawCreds.type === 'service_account') {
    // Service Account — requires Gmail domain-wide delegation with readonly scope
    auth = new google.auth.GoogleAuth({
      credentials: rawCreds,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      ...(projectId ? { projectId } : {}),
    });
    ctx.log(`Authenticating with Service Account: ${rawCreds.client_email}`);

  } else if (rawCreds.installed || rawCreds.web) {
    // OAuth2 client secrets file — needs a token.json alongside it
    const oauthCreds = rawCreds.installed ?? rawCreds.web;
    const oAuth2Client = new google.auth.OAuth2(
      oauthCreds.client_id,
      oauthCreds.client_secret,
      oauthCreds.redirect_uris[0]
    );

    const tokenPath = path.join(path.dirname(resolvedPath), 'token.json');
    if (!fs.existsSync(tokenPath)) {
      throw new Error(
        `OAuth2 token file not found at: ${tokenPath}\n` +
        'Run the OAuth2 consent flow once to generate token.json, ' +
        'then place it beside your credentials file.'
      );
    }
    oAuth2Client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf-8')));
    auth = oAuth2Client;
    ctx.log('Authenticating with OAuth2 client secrets + token.json');

  } else if (rawCreds.access_token || rawCreds.refresh_token) {
    // Pre-generated token JSON with client_id / client_secret embedded
    const oAuth2Client = new google.auth.OAuth2(
      rawCreds.client_id,
      rawCreds.client_secret
    );
    oAuth2Client.setCredentials(rawCreds);
    auth = oAuth2Client;
    ctx.log('Authenticating with pre-generated OAuth2 token.');

  } else {
    throw new Error(
      'Unrecognised credential file format. ' +
      'Supported: service_account JSON, OAuth2 client-secrets JSON (+ token.json), ' +
      'or a token JSON with access_token / refresh_token.'
    );
  }

  // ── 4. Query Gmail — default OTP-related keywords, no user input needed ───
  //
  // Internal default: search the inbox for messages containing common OTP
  // keywords received within the last 10 minutes to avoid stale codes.
  // No subject argument is accepted from the test step — this is intentional.
  const tenMinutesAgo = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
  const defaultQuery =
    `in:inbox after:${tenMinutesAgo} ` +
    `(subject:OTP OR subject:"one-time" OR subject:"verification code" ` +
    `OR subject:"passcode" OR subject:"your code" OR subject:"security code" ` +
    `OR subject:"login code" OR subject:"signin code")`;

  ctx.log(`Searching Gmail with default OTP query (last 10 min): ${defaultQuery}`);

  const gmail = google.gmail({ version: 'v1', auth });

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    q: defaultQuery,
    maxResults: 5,
  });

  let messages = listResponse.data.messages;

  // Fallback: broaden search to last 30 min without subject filter
  if (!messages || messages.length === 0) {
    const thirtyMinutesAgo = Math.floor((Date.now() - 30 * 60 * 1000) / 1000);
    const fallbackQuery = `in:inbox after:${thirtyMinutesAgo}`;
    ctx.warn(`No OTP emails found with keyword filter. Falling back to: ${fallbackQuery}`);

    const fallbackResponse = await gmail.users.messages.list({
      userId: 'me',
      q: fallbackQuery,
      maxResults: 10,
    });
    messages = fallbackResponse.data.messages ?? [];
  }

  if (!messages || messages.length === 0) {
    throw new Error('No recent emails found in Gmail inbox (last 30 minutes). Cannot extract OTP.');
  }

  ctx.log(`Found ${messages.length} message(s). Scanning for OTP...`);

  // ── 5. Extract OTP from message body ──────────────────────────────────────
  // Patterns ordered from most specific to most general
  const otpPatterns: RegExp[] = [
    /\b(?:OTP|one.?time.?password|verification.?code|passcode|security.?code|login.?code|your.?code)[^\d]{0,30}(\d{4,8})\b/i,
    /\b(\d{6})\b/,   // 6-digit (most common)
    /\b(\d{4})\b/,   // 4-digit
    /\b(\d{8})\b/,   // 8-digit
  ];

  for (const message of messages) {
    const msgId = message.id!;

    const msgResponse = await gmail.users.messages.get({
      userId: 'me',
      id: msgId,
      format: 'full',
    });

    const payload = msgResponse.data.payload;
    if (!payload) continue;

    const bodyText = extractTextFromPayload(payload);
    ctx.log(`Message ${msgId} preview: ${bodyText.substring(0, 200).replace(/\s+/g, ' ')}`);

    for (const pattern of otpPatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const otp = match[1] ?? match[0];
        ctx.log(`OTP extracted: "${otp}" (matched pattern: ${pattern.source})`);
        ctx.setVariable(outputVar, otp);
        ctx.log(`Stored as runtime variable $[${outputVar}] = ${otp}`);
        return;
      }
    }

    ctx.warn(`No OTP pattern matched in message ${msgId}. Trying next...`);
  }

  throw new Error(
    'Could not extract an OTP from any recent emails. ' +
    'Ensure the email arrived within the last 30 minutes and contains a numeric code.'
  );
}

// ── Helper: recursively decode MIME parts into plain text ───────────────────
function extractTextFromPayload(payload: any): string {
  const parts: string[] = [];

  function walk(part: any): void {
    if (!part) return;
    const mimeType: string = part.mimeType ?? '';
    const body = part.body;

    if ((mimeType === 'text/plain' || mimeType === 'text/html') && body?.data) {
      const decoded = Buffer.from(body.data, 'base64url').toString('utf-8');
      // Strip HTML tags so OTP regexes match raw numbers only
      parts.push(mimeType === 'text/html' ? decoded.replace(/<[^>]*>/g, ' ') : decoded);
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);
  return parts.join('\n');
}

// v1.1 — test push/pull change
import type { WalnutBaseContext } from './walnut';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as url from 'url';
import { google } from 'googleapis';
import type { Auth } from 'googleapis';

/** @walnut_method
 * name: Read OTP from Gmail
 * description: Fetch the latest otp from gmail using client secret ${clientSecretPath} and token ${tokenPath} and store in $[OTP]
 * actionType: custom_read_otp_gmail
 * context: shared
 * needsLocator: false
 * category: Email Automation
 * modules: child_process
 */
export async function readOtpFromGmail(ctx: WalnutBaseContext) {
  // ctx.args[0] = clientSecretPath  — local path OR Walnut artifact name/ID
  //                                    e.g. "C:\...\client_secret.json"  or  "gmail-client-secret"
  // ctx.args[1] = tokenPath          — local path OR Walnut artifact name/ID for token.json
  //                                    e.g. "C:\...\token.json"          or  "gmail-token"
  //                                    Leave empty on first local run → browser consent auto-launches
  //                                    and token.json is saved beside client_secret.json
  // ctx.args[2] = "OTP"             — runtime variable name from $[OTP]

  const clientSecretPath: string = ctx.args[0];
  const tokenPathArg: string     = ctx.args[1];   // may be empty string on first local run
  const outputVar: string        = ctx.args[2];

  if (!clientSecretPath) {
    throw new Error(
      'clientSecretPath is required — pass a local path or Walnut artifact name ' +
      'for the OAuth2 client secrets JSON downloaded from Google Cloud Console.'
    );
  }
  if (!outputVar) {
    throw new Error('Output variable name is required — ensure $[OTP] is present in the step description.');
  }

  // ── 1. Resolve client secret (local path or Walnut artifact) ──────────────
  const clientSecretResolved = await resolveFile(ctx, clientSecretPath, 'client secret');
  const rawClientSecret      = JSON.parse(fs.readFileSync(clientSecretResolved, 'utf-8'));

  const oauthCreds = rawClientSecret.installed ?? rawClientSecret.web;
  if (!oauthCreds) {
    throw new Error(
      'clientSecretPath does not look like an OAuth2 client secrets file. ' +
      'Expected a JSON with an "installed" or "web" key from Google Cloud Console.'
    );
  }

  const projectId: string | undefined =
    rawClientSecret.project_id ?? rawClientSecret.quota_project_id ?? oauthCreds.project_id;

  ctx.log(`Google Cloud Project: ${projectId ?? '(not found in file)'}`);
  ctx.log(`OAuth2 client_id: ${oauthCreds.client_id}`);

  // ── 2. Determine token.json path ──────────────────────────────────────────
  // Priority:
  //   1. ${tokenPath} arg in step description — local path OR Walnut artifact name/ID
  //   2. token.json beside client_secret.json — default / first-run save location
  let tokenFilePath: string;

  if (tokenPathArg) {
    // User supplied a path or artifact name — resolve it
    tokenFilePath = await resolveFile(ctx, tokenPathArg, 'token');
  } else {
    // Not supplied — default to beside the client secret file
    tokenFilePath = path.join(path.dirname(clientSecretResolved), 'token.json');
    ctx.log(`token: defaulting to ${tokenFilePath}`);
  }

  // ── 3. Obtain OAuth2 tokens — auto-browser on first run ───────────────────
  const oAuth2Client: Auth.OAuth2Client = new google.auth.OAuth2(
    oauthCreds.client_id,
    oauthCreds.client_secret,
    'http://localhost'            // redirect_uri — overridden per-flow below
  );

  if (fs.existsSync(tokenFilePath)) {
    // ── Subsequent runs: load saved token ──────────────────────────────────
    const savedToken = JSON.parse(fs.readFileSync(tokenFilePath, 'utf-8'));
    oAuth2Client.setCredentials(savedToken);
    ctx.log(`Token loaded from: ${tokenFilePath}`);

    // Auto-save refreshed tokens back to the same file
    oAuth2Client.on('tokens', (tokens) => {
      const merged = { ...savedToken, ...tokens };
      try {
        fs.writeFileSync(tokenFilePath, JSON.stringify(merged, null, 2));
        ctx.log('Token auto-refreshed and saved: ' + tokenFilePath);
      } catch {
        ctx.warn('Token refreshed but could not be saved back (read-only path — expected on cloud).');
      }
    });

  } else {
    // ── First run: launch browser for consent, wait for redirect ───────────
    ctx.log('No token.json found — starting OAuth2 browser consent flow...');
    const tokens = await runLocalOAuthFlow(ctx, oauthCreds);
    fs.writeFileSync(tokenFilePath, JSON.stringify(tokens, null, 2));
    ctx.log(`token.json saved to: ${tokenFilePath}`);
    oAuth2Client.setCredentials(tokens);
  }

  // ── 4. Query Gmail — OTP keyword filter (last 10 min), fallback 30 min ───
  ctx.log('OAuth2 client ready. Querying Gmail...');
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

  const tenMinutesAgo    = Math.floor((Date.now() - 10 * 60 * 1000) / 1000);
  const thirtyMinutesAgo = Math.floor((Date.now() - 30 * 60 * 1000) / 1000);

  const defaultQuery =
    `in:inbox after:${tenMinutesAgo} ` +
    `(subject:OTP OR subject:"one-time" OR subject:"verification code" ` +
    `OR subject:"passcode" OR subject:"your code" OR subject:"security code" ` +
    `OR subject:"login code" OR subject:"signin code")`;

  ctx.log(`Searching Gmail (last 10 min, OTP keywords): ${defaultQuery}`);

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    q: defaultQuery,
    maxResults: 5,
  });

  let messages = listResponse.data.messages;

  if (!messages || messages.length === 0) {
    const fallbackQuery = `in:inbox after:${thirtyMinutesAgo}`;
    ctx.warn(`No OTP keyword match. Falling back to all inbox mail (last 30 min): ${fallbackQuery}`);
    const fallbackResponse = await gmail.users.messages.list({
      userId: 'me',
      q: fallbackQuery,
      maxResults: 10,
    });
    messages = fallbackResponse.data.messages ?? [];
  }

  if (!messages || messages.length === 0) {
    throw new Error(
      'No recent emails found in Gmail inbox (last 30 minutes). ' +
      'Ensure the OTP email has arrived and the Gmail account matches the credentials.'
    );
  }

  ctx.log(`Found ${messages.length} message(s). Scanning for OTP...`);

  // ── 5. Extract OTP from message body ──────────────────────────────────────
  const otpPatterns: RegExp[] = [
    /\b(?:OTP|one.?time.?password|verification.?code|passcode|security.?code|login.?code|your.?code)[^\d]{0,30}(\d{4,8})\b/i,
    /\b(\d{6})\b/,
    /\b(\d{4})\b/,
    /\b(\d{8})\b/,
  ];

  for (const message of messages) {
    const msgId = message.id!;
    const msgResponse = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
    const payload = msgResponse.data.payload;
    if (!payload) continue;

    const bodyText = extractTextFromPayload(payload);
    ctx.log(`Message ${msgId} preview: ${bodyText.substring(0, 200).replace(/\s+/g, ' ')}`);

    for (const pattern of otpPatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const otp = match[1] ?? match[0];
        ctx.log(`OTP extracted: "${otp}" (pattern: ${pattern.source})`);
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

// ── OAuth2 browser consent flow ─────────────────────────────────────────────
// Spins up a temporary localhost HTTP server, opens the auth URL in the
// system browser, waits for Google to redirect back with the auth code,
// exchanges it for tokens, then shuts the server down.
async function runLocalOAuthFlow(ctx: WalnutBaseContext, oauthCreds: any): Promise<any> {
  const TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for user to complete consent

  return new Promise<any>((resolve, reject) => {
    // Pick a random available port in the 8080–9000 range
    const port = Math.floor(Math.random() * 920) + 8080;
    const redirectUri = `http://localhost:${port}`;

    const oAuth2Client = new google.auth.OAuth2(
      oauthCreds.client_id,
      oauthCreds.client_secret,
      redirectUri
    );

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/gmail.readonly'],
      prompt: 'consent',   // force refresh_token to always be returned
    });

    // Timeout guard
    const timer = setTimeout(() => {
      server.close();
      reject(new Error(
        `OAuth2 consent flow timed out after 3 minutes. ` +
        `If the browser did not open, visit this URL manually:\n${authUrl}`
      ));
    }, TIMEOUT_MS);

    const server = http.createServer(async (req, res) => {
      try {
        const parsed   = url.parse(req.url ?? '', true);
        const code     = parsed.query.code as string | undefined;
        const error    = parsed.query.error as string | undefined;

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h2>Authorization denied.</h2><p>You can close this tab.</p>');
          clearTimeout(timer);
          server.close();
          reject(new Error(`OAuth2 consent was denied by the user: ${error}`));
          return;
        }

        if (!code) {
          // Not the callback request (e.g. favicon) — ignore
          res.writeHead(200);
          res.end();
          return;
        }

        // Exchange auth code for tokens
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<h2 style="font-family:sans-serif;color:green">&#10003; Gmail access granted!</h2>' +
          '<p style="font-family:sans-serif">You can close this tab and return to Walnut.</p>'
        );

        clearTimeout(timer);
        server.close();

        const { tokens } = await oAuth2Client.getToken(code);
        ctx.log('OAuth2 consent completed. Tokens received.');
        resolve(tokens);

      } catch (err: any) {
        clearTimeout(timer);
        server.close();
        reject(new Error(`Failed to exchange OAuth2 code for tokens: ${err.message}`));
      }
    });

    server.listen(port, '127.0.0.1', async () => {
      ctx.log(`OAuth2 redirect server listening on ${redirectUri}`);
      ctx.log(`Opening browser for Gmail consent...`);
      ctx.log(`Auth URL: ${authUrl}`);

      // Open system browser for OAuth consent
      const openCmd = process.platform === 'win32'
        ? `start "" "${authUrl}"`
        : process.platform === 'darwin'
          ? `open "${authUrl}"`
          : `xdg-open "${authUrl}"`;

      exec(openCmd, (err) => {
        if (err) ctx.warn(`Could not open system browser: ${err.message}. Open this URL manually:\n${authUrl}`);
        else ctx.log('System browser opened for Gmail consent. Waiting for user to approve (timeout: 3 min)...');
      });
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is in use. Please retry — a different port will be selected.`));
      } else {
        reject(new Error(`OAuth2 redirect server error: ${err.message}`));
      }
    });
  });
}

// ── Helper: local-first file resolution ────────────────────────────────────
async function resolveFile(ctx: WalnutBaseContext, input: string, label: string): Promise<string> {
  const localPath = path.isAbsolute(input)
    ? input
    : path.resolve(process.cwd(), input);

  if (fs.existsSync(localPath)) {
    ctx.log(`${label}: using local file → ${localPath}`);
    return localPath;
  }

  ctx.log(`${label}: not a local path — resolving as Walnut artifact "${input}"`);
  const resolved = await ctx.resolveArtifact(input);
  ctx.log(`${label}: artifact resolved → ${resolved}`);

  // resolveArtifact may return the destination path before the download completes.
  // Retry up to 5 times (5 seconds total) before giving up.
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (fs.existsSync(resolved)) break;
    if (attempt === 5) {
      throw new Error(
        `${label} artifact "${input}" was resolved to "${resolved}" but the file was not present ` +
        `after 5 retries.\nCheck that the artifact is still active and your Walnut Agent has network access.`
      );
    }
    ctx.warn(`${label}: file not ready yet (attempt ${attempt}/5) — retrying in 1s...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return resolved;
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
      parts.push(mimeType === 'text/html' ? decoded.replace(/<[^>]*>/g, ' ') : decoded);
    }

    if (Array.isArray(part.parts)) {
      for (const child of part.parts) walk(child);
    }
  }

  walk(payload);
  return parts.join('\n');
}

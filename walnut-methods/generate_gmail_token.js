/**
 * ONE-TIME Gmail OAuth2 Token Generator
 * ──────────────────────────────────────
 * Run this script ONCE to authorize Gmail access and produce token.json.
 * After that, the custom method will work without any manual steps.
 *
 * Usage:
 *   node generate_gmail_token.js <path-to-client-secret.json>
 *
 * Example:
 *   node generate_gmail_token.js "C:\Users\Santhosh.m01\Downloads\client_secret_117006028904-2fh0ukta12mo7mb1g3k4jlf4h6mb8bgu.apps.googleusercontent.com.json"
 *
 * What it does:
 *   1. Reads your client secrets file
 *   2. Opens an authorization URL in the console (paste it into your browser)
 *   3. You grant Gmail read access in the browser
 *   4. Google gives you a code — paste it back here
 *   5. Saves token.json alongside the client secrets file
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { google } = require('googleapis');
const readline = require('readline');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

async function main() {
  const credPath = process.argv[2];

  if (!credPath) {
    console.error('\nUsage: node generate_gmail_token.js <path-to-client-secret.json>\n');
    process.exit(1);
  }

  const resolvedCredPath = path.isAbsolute(credPath)
    ? credPath
    : path.resolve(process.cwd(), credPath);

  if (!fs.existsSync(resolvedCredPath)) {
    console.error(`\nError: File not found: ${resolvedCredPath}\n`);
    process.exit(1);
  }

  const rawCreds = JSON.parse(fs.readFileSync(resolvedCredPath, 'utf-8'));
  const oauthCreds = rawCreds.installed || rawCreds.web;

  if (!oauthCreds) {
    console.error('\nError: This does not look like an OAuth2 client secrets file.');
    console.error('Expected a JSON file with an "installed" or "web" key.\n');
    process.exit(1);
  }

  const tokenPath = path.join(path.dirname(resolvedCredPath), 'token.json');

  if (fs.existsSync(tokenPath)) {
    console.log(`\ntoken.json already exists at: ${tokenPath}`);
    console.log('Delete it first if you want to re-authorize.\n');
    process.exit(0);
  }

  const redirectUri = oauthCreds.redirect_uris.includes('urn:ietf:wg:oauth:2.0:oob')
    ? 'urn:ietf:wg:oauth:2.0:oob'
    : oauthCreds.redirect_uris[0];

  const oAuth2Client = new google.auth.OAuth2(
    oauthCreds.client_id,
    oauthCreds.client_secret,
    redirectUri
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',   // force refresh_token to be returned
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Gmail OAuth2 Authorization');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Step 1: Open this URL in your browser:\n');
  console.log('  ' + authUrl);
  console.log('\nStep 2: Sign in with the Gmail account you want to read OTPs from.');
  console.log('Step 3: Grant the "Read Gmail" permission.');
  console.log('Step 4: Copy the authorization code shown and paste it below.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  rl.question('Paste the authorization code here: ', async (code) => {
    rl.close();
    code = code.trim();

    try {
      const { tokens } = await oAuth2Client.getToken(code);
      oAuth2Client.setCredentials(tokens);

      fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('  ✓ token.json saved successfully!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`\n  Location: ${tokenPath}\n`);
      console.log('You can now run the "Read OTP from Gmail" custom method.');
      console.log('This token will auto-refresh — you will not need to do this again.\n');
    } catch (err) {
      console.error('\nError exchanging code for token:', err.message);
      console.error('Make sure you copied the full code and try again.\n');
      process.exit(1);
    }
  });
}

main();

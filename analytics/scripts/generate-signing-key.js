#!/usr/bin/env node
/**
 * Generate the Ed25519 keypair used to sign the in-app update manifest.
 *
 * Run ONCE via:
 *   docker exec albion-market node /opt/analytics/scripts/generate-signing-key.js
 *
 * Writes the 64-byte private key (secret key seed + public key) to
 * /data/signing-private.bin with mode 600, then prints the 32-byte public key
 * in hex on stdout. Copy that hex string into the PUBLIC_SIGNING_KEY constant
 * in the client at /root/AlbionMarket/lib/updater.ts.
 *
 * Refuses to overwrite an existing key — if you need to rotate, move the old
 * file aside explicitly (and be aware all pre-rotation clients will stop
 * accepting the new manifest).
 */

const fs = require('fs');
const path = require('path');
const nacl = require('tweetnacl');

const PRIVATE_KEY_PATH = '/data/signing-private.bin';

function main() {
  if (fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('ERROR: ' + PRIVATE_KEY_PATH + ' already exists.');
    console.error('Refusing to overwrite. Move it aside first if you really want to rotate the key.');
    process.exit(1);
  }

  const dir = path.dirname(PRIVATE_KEY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const kp = nacl.sign.keyPair();
  // secretKey is 64 bytes (32-byte seed + 32-byte public key, per NaCl convention).
  fs.writeFileSync(PRIVATE_KEY_PATH, Buffer.from(kp.secretKey), { mode: 0o600 });
  // Defensive chmod in case umask interfered.
  fs.chmodSync(PRIVATE_KEY_PATH, 0o600);

  const pubHex = Buffer.from(kp.publicKey).toString('hex');

  console.log('');
  console.log('Ed25519 signing key generated.');
  console.log('');
  console.log('  Private key: ' + PRIVATE_KEY_PATH + ' (chmod 600)');
  console.log('  Public key (hex, 64 chars):');
  console.log('');
  console.log('    ' + pubHex);
  console.log('');
  console.log('Next step: paste that hex string into PUBLIC_SIGNING_KEY in');
  console.log('/root/AlbionMarket/lib/updater.ts, then rebuild the app.');
  console.log('');
}

main();

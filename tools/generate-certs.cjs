const fs = require('node:fs');
const path = require('node:path');
const forge = require('node-forge');
const dir = path.join(__dirname, '../certs');
fs.mkdirSync(dir, { recursive: true });
const files = ['localhost.crt', 'localhost.key', 'localhost.pem'];
if (files.some(f => fs.existsSync(path.join(dir, f)))) {
  if (!files.every(f => fs.existsSync(path.join(dir, f)))) throw new Error('Incomplete certs directory; move existing files aside before regenerating.');
  console.log('Existing certificates preserved.');
  process.exit(0);
}
const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(16));
cert.validity.notBefore = new Date(Date.now() - 300000);
cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
const attrs = [{ name: 'commonName', value: 'localhost' }];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
  { name: 'extKeyUsage', serverAuth: true },
  { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, { type: 7, ip: '::1' }] },
]);
cert.sign(keys.privateKey, forge.md.sha256.create());
const crt = forge.pki.certificateToPem(cert);
const key = forge.pki.privateKeyToPem(keys.privateKey);
for (const [file, value] of [['localhost.crt', crt], ['localhost.key', key], ['localhost.pem', crt + key]]) fs.writeFileSync(path.join(dir, file), value, { flag: 'wx' });
console.log('Generated localhost self-signed certificate (365 days); no OS trust store changes.');

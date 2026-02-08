/**
 * Manual .pkpass construction:
 * 1. Build pass.json with user data
 * 2. Collect all files (pass.json, images)
 * 3. Create manifest.json (SHA-1 hash of each file)
 * 4. Sign manifest.json with CMS/PKCS#7 (using node-forge)
 * 5. ZIP everything into .pkpass
 */
import forge from 'node-forge';
import JSZip from 'jszip';

const BUILD_NUMBER = 100;

const FLAT_COLORS = {
  blue: 'rgb(157, 213, 238)',
  yellow: 'rgb(226, 208, 96)',
  pink: 'rgb(228, 184, 192)',
};

const LOGO_TEXT_COLORS = {
  blue: 'rgb(120, 175, 200)',
  yellow: 'rgb(190, 175, 60)',
  pink: 'rgb(195, 150, 160)',
};

function parseCertificates(env) {
  const p12Der = forge.util.decode64(env.P12_BASE64);
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, env.P12_PASSWORD || '');

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const signerCert = certBags[forge.pki.oids.certBag][0].cert;

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const signerKey = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag][0].key;

  const wwdrPem = env.WWDR_PEM;
  const wwdrCert = forge.pki.certificateFromPem(wwdrPem);

  return { signerCert, signerKey, wwdrCert };
}

function buildPassJson({ text, color }) {
  const bgColor = FLAT_COLORS[color] || FLAT_COLORS.blue;
  const fgColor = LOGO_TEXT_COLORS[color] || LOGO_TEXT_COLORS.blue;
  const serial = `memo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const passJson = {
    formatVersion: 1,
    serialNumber: serial,
    passTypeIdentifier: 'pass.com.walletmemo.note',
    teamIdentifier: 'HTWS8J5HF3',
    organizationName: 'Wallet Memo',
    description: 'A sticky note for your wallet',
    foregroundColor: fgColor,
    labelColor: fgColor,
    backgroundColor: bgColor,
    logoText: 'Wallet Memo',
    coupon: {
      headerFields: [],
      primaryFields: [],
      secondaryFields: [],
      auxiliaryFields: [],
      backFields: [
        { key: 'version', label: 'Build', value: String(BUILD_NUMBER) },
        { key: 'website', label: 'Website', value: 'https://walletmemo.com' },
      ],
    },
  };

  if (text && text.trim()) {
    passJson.coupon.secondaryFields = [
      { key: 'memo', label: 'Note', value: text },
    ];
  }

  return passJson;
}

function sha1Hex(data) {
  const md = forge.md.sha1.create();
  if (typeof data === 'string') {
    md.update(data, 'utf8');
  } else {
    // Binary string
    md.update(data, 'raw');
  }
  return md.digest().toHex();
}

function signManifest(manifestJson, signerCert, signerKey, wwdrCert) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestJson, 'utf8');
  p7.addCertificate(signerCert);
  p7.addCertificate(wwdrCert);
  p7.addSigner({
    key: signerKey,
    certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha1,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        type: forge.pki.oids.messageDigest,
      },
      {
        type: forge.pki.oids.signingTime,
        value: new Date(),
      },
    ],
  });
  p7.sign({ detached: true });

  const asn1 = p7.toAsn1();
  const derBytes = forge.asn1.toDer(asn1).getBytes();
  return derBytes; // binary string
}

export async function createPass(env, { text, color, stripPng, iconPng }) {
  const { signerCert, signerKey, wwdrCert } = parseCertificates(env);

  const passJson = buildPassJson({ text, color });
  const passJsonStr = JSON.stringify(passJson);

  // Collect all files as binary strings for hashing
  const files = {
    'pass.json': passJsonStr,
    'strip.png': bufferToBinaryString(stripPng),
    'strip@2x.png': bufferToBinaryString(stripPng),
    'strip@3x.png': bufferToBinaryString(stripPng),
    'icon.png': bufferToBinaryString(iconPng),
    'icon@2x.png': bufferToBinaryString(iconPng),
  };

  // Build manifest
  const manifest = {};
  for (const [name, data] of Object.entries(files)) {
    if (name === 'pass.json') {
      // pass.json is UTF-8 text
      const md = forge.md.sha1.create();
      md.update(data, 'utf8');
      manifest[name] = md.digest().toHex();
    } else {
      // Binary files
      manifest[name] = sha1Hex(data);
    }
  }

  const manifestJson = JSON.stringify(manifest);

  // Sign manifest
  const signatureDer = signManifest(manifestJson, signerCert, signerKey, wwdrCert);

  // Build ZIP
  const zip = new JSZip();
  zip.file('pass.json', passJsonStr);
  zip.file('manifest.json', manifestJson);
  zip.file('signature', signatureDer, { binary: true });
  zip.file('strip.png', stripPng);
  zip.file('strip@2x.png', stripPng);
  zip.file('strip@3x.png', stripPng);
  zip.file('icon.png', iconPng);
  zip.file('icon@2x.png', iconPng);

  const zipBuffer = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return zipBuffer;
}

function bufferToBinaryString(buf) {
  // buf is a Buffer or Uint8Array
  let str = '';
  for (let i = 0; i < buf.length; i++) {
    str += String.fromCharCode(buf[i]);
  }
  return str;
}

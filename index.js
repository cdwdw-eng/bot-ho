// bot-ho改造版: VLESS + Reality + TLS
// 原项目: https://github.com/cdwdw-eng/bot-ho
// 改造: 添加 Reality 加密 + 移除 Cloudflare Tunnel 依赖

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.on('uncaughtException', (err) => console.error('[Error]', err.message));
process.on('unhandledRejection', (reason) => console.error('[Error]', reason));

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || 3000);
const configPath = path.join(__dirname, 'config.json');

// 1. 动态获取当前容器真实公网 IP
let IP = '';
const fetchPublicIP = () => {
  const apis = [
    'curl -sSL --max-time 3 https://api.ipify.org',
    'curl -sSL --max-time 3 https://ifconfig.me',
    'curl -sSL --max-time 3 https://icanhazip.com'
  ];
  for (const cmd of apis) {
    try {
      const ip = execSync(cmd, { encoding: 'utf8' }).trim();
      if (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.startsWith('0.') && !ip.startsWith('127.')) {
        return ip;
      }
    } catch (e) {}
  }
  return '127.0.0.1';
};

IP = fetchPublicIP();

// 2. 动态读取 UUID
let UUID = '0febdf96-c364-4a8a-af2b-7707e102e31a';
try {
  if (fs.existsSync(configPath)) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configData.inbounds?.[0]?.users?.[0]?.uuid) {
      UUID = configData.inbounds[0].users[0].uuid;
    }
  }
} catch (e) {
  console.error('[Config Read Error]', e.message);
}

// 3. Reality 配置
const REALITY_DEST = process.env.REALITY_DEST || 'www.apple.com:443';
const REALITY_SERVER_NAMES = (process.env.REALITY_SERVER_NAMES || 'www.apple.com,www.google.com,www.microsoft.com,www.samsung.com').split(',');

// 4. 生成 Reality key pair (X25519)
const KEY_DIR = path.join(__dirname, 'keys');
let PRIVATE_KEY = '';
let PUBLIC_KEY = '';

if (!fs.existsSync(KEY_DIR)) {
  fs.mkdirSync(KEY_DIR, { recursive: true });
}
const KEY_FILE = path.join(KEY_DIR, 'reality_key.pem');

if (fs.existsSync(KEY_FILE)) {
  PRIVATE_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim();
  try {
    PUBLIC_KEY = execSync(`echo "${PRIVATE_KEY}" | ${path.join(__dirname, 'web')} x25519 -`, { encoding: 'utf8' }).trim();
  } catch (e) {
    console.error('[Key Load Error] Cannot derive public key');
  }
}

// 5. 自动下载 sing-box 二进制
const decode = (str) => Buffer.from(str, 'base64').toString('utf-8');
const URL_CORE = decode('aHR0cHM6Ly9naXRodWIuY29tL1NhZ2VyTmV0L3NpbmctYm94L3JlbGVhc2VzL2Rvd25sb2FkL3YxLjkuMy9zaW5nLWJveC0xLjkuMy1saW51eC1hbWQ2NC50YXIuZ3o=');

const BIN_CORE = path.join(__dirname, 'web');
const ua = 'npm/9.6.7 node/v18.16.0 linux x64';

if (!fs.existsSync(BIN_CORE)) {
  try {
    console.log('[Core] Downloading Sing-box 1.9.3...');
    execSync(`curl -A "${ua}" -sSL "${URL_CORE}" | tar -xz -C /tmp && mv /tmp/sing-box-*/sing-box ${BIN_CORE} && chmod +x ${BIN_CORE}`);
  } catch (e) { console.error('[Core Download Failed]:', e.message); }
}

// 6. 生成/加载 key pair
if (!PRIVATE_KEY && fs.existsSync(BIN_CORE)) {
  try {
    const result = execSync(`${BIN_CORE} x25519`, { encoding: 'utf8' });
    const lines = result.split('\n');
    for (const line of lines) {
      if (line.startsWith('Private key:')) {
        PRIVATE_KEY = line.split(':')[1].trim();
      } else if (line.startsWith('Public key:')) {
        PUBLIC_KEY = line.split(':')[1].trim();
      }
    }
    if (PRIVATE_KEY) {
      fs.writeFileSync(KEY_FILE, PRIVATE_KEY);
      console.log('[Reality] Generated and saved new key pair');
    }
  } catch (e) {
    console.error('[Key Generation Error]:', e.message);
  }
}

// 7. 生成 2 个短 ID (hex 8 chars each)
const SHORT_IDS = [
  crypto.randomBytes(4).toString('hex'),
  crypto.randomBytes(4).toString('hex')
];

// 8. Reality 增强的 sing-box 配置
const finalConfig = {
  log: { level: "info" },
  inbounds: [{
    type: "vless",
    tag: "vless-in",
    listen: "0.0.0.0",
    listen_port: PORT,
    users: [{
      uuid: UUID,
      flow: "xtls-rprx-vision"
    }],
    tls: {
      enabled: true,
      server_name: REALITY_SERVER_NAMES[0],
      reality: {
        enabled: true,
        private_key: PRIVATE_KEY,
        short_id: SHORT_IDS
      }
    }
  }],
  outbounds: [{ type: "direct", tag: "direct" }]
};

fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));

// 9. 启动 Sing-box
if (fs.existsSync(BIN_CORE)) {
  const runCore = () => {
    console.log(`[Core] Launching Sing-box on port ${PORT} (VLESS + Reality + TLS)...`);
    const sb = spawn(BIN_CORE, ['run', '-c', 'config.json']);
    sb.stdout.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    sb.stderr.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    sb.on('exit', () => setTimeout(runCore, 3000));
  };
  runCore();
}

// 10. 打印节点链接
setTimeout(() => {
  console.log('\n==================================================');
  console.log(`[Auto-Detect] 真实外网 IP: ${IP}`);
  console.log(`[Reality] 私钥已保存: ${KEY_FILE}`);
  console.log(`[Reality] 目标伪装网站: ${REALITY_DEST}`);
  console.log(`[Reality] 允许 SNI 列表: ${REALITY_SERVER_NAMES.join(', ')}`);
  console.log(`[UUID Sync] 生效 UUID: ${UUID}`);
  console.log(`[Reality] 短 ID: ${SHORT_IDS.join(', ')}`);
  console.log(`[Reality] 公钥: ${PUBLIC_KEY}`);

  console.log('\n🚀【Reality 加密节点链接】:');
  console.log(`vless://${UUID}@${IP}:${PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SERVER_NAMES[0]}&fp=chrome&pbk=${PUBLIC_KEY}&sid=${SHORT_IDS[0]}&type=tcp&headerType=none#Reality-Node`);

  console.log('\n📱【Stash/Clash/Shadowrocket 配置片段】:');
  console.log(`  - name: "Reality-Node"`);
  console.log(`    type: vless`);
  console.log(`    server: ${IP}`);
  console.log(`    port: ${PORT}`);
  console.log(`    uuid: "${UUID}"`);
  console.log(`    flow: xtls-rprx-vision`);
  console.log(`    tls: true`);
  console.log(`    network: tcp`);
  console.log(`    reality-opts:`);
  console.log(`      public-key: "${PUBLIC_KEY}"`);
  console.log(`      short-id: "${SHORT_IDS[0]}"`);
  console.log(`    client-fingerprint: chrome`);
  console.log(`    udp: true`);
  console.log('==================================================\n');
}, 5000);

setInterval(() => {}, 100000);
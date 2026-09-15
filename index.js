// bot-ho改造版: VLESS + Reality + TLS (使用 Xray-core)
// 原项目: https://github.com/cdwdw-eng/bot-ho
// 改造: 用 xray 替代 sing-box (更小更快) + Reality 加密

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// 4. 自动下载 Xray-core 二进制 (最新稳定版, ~21MB)
const XRAY_URL = 'https://github.com/XTLS/Xray-core/releases/download/v26.3.27/Xray-linux-64.zip';
const BIN_CORE = path.join(__dirname, 'web');
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

if (!fs.existsSync(BIN_CORE)) {
  try {
    console.log('[Core] Downloading Xray-core v26.3.27 (~21MB)...');
    execSync(`curl -A "${ua}" -sSL -o /tmp/xray.zip "${XRAY_URL}" && cd /tmp && unzip -o xray.zip && mv /tmp/xray ${BIN_CORE} && chmod +x ${BIN_CORE}`);
  } catch (e) {
    console.error('[Core Download Failed]:', e.message);
    process.exit(1);
  }
}

// 5. 生成 Reality key pair (使用 Xray 内置 x25519)
const KEY_DIR = path.join(__dirname, 'keys');
let PRIVATE_KEY = '';
let PUBLIC_KEY = '';

if (!fs.existsSync(KEY_DIR)) {
  fs.mkdirSync(KEY_DIR, { recursive: true });
}
const KEY_FILE = path.join(KEY_DIR, 'reality_key.txt');

if (fs.existsSync(KEY_FILE)) {
  PRIVATE_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim();
}

if (!PRIVATE_KEY && fs.existsSync(BIN_CORE)) {
  try {
    // xray x25519 输出格式:
    // Private key: <base64>
    // Public key: <base64>
    const result = execSync(`${BIN_CORE} x25519`, { encoding: 'utf8' });
    const lines = result.split('\n');
    for (const line of lines) {
      if (line.startsWith('Private key:')) {
        PRIVATE_KEY = line.split(':').slice(1).join(':').trim();
      } else if (line.startsWith('Public key:')) {
        PUBLIC_KEY = line.split(':').slice(1).join(':').trim();
      }
    }
    if (PRIVATE_KEY && PUBLIC_KEY) {
      fs.writeFileSync(KEY_FILE, PRIVATE_KEY);
      console.log('[Reality] Generated and saved new key pair');
    }
  } catch (e) {
    console.error('[Key Generation Error]:', e.message);
    process.exit(1);
  }
}

// 6. 短 ID (hex 8 chars = 4 bytes)
const SHORT_IDS = [
  execSync('openssl rand -hex 4', { encoding: 'utf8' }).trim(),
  execSync('openssl rand -hex 4', { encoding: 'utf8' }).trim()
];

// 7. Xray Reality 配置 (JSON格式, 比 sing-box 简单)
const finalConfig = {
  log: { loglevel: "warning" },
  inbounds: [{
    tag: "vless-in",
    listen: "0.0.0.0",
    port: PORT,
    protocol: "vless",
    settings: {
      clients: [{
        id: UUID,
        flow: "xtls-rprx-vision"
      }],
      decryption: "none"
    },
    streamSettings: {
      network: "tcp",
      security: "reality",
      realitySettings: {
        show: false,
        dest: REALITY_DEST,
        xver: 0,
        serverNames: REALITY_SERVER_NAMES,
        privateKey: PRIVATE_KEY,
        shortIds: SHORT_IDS
      }
    }
  }],
  outbounds: [{
    protocol: "freedom",
    tag: "direct"
  }]
};

fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));

// 8. 启动 Xray
if (fs.existsSync(BIN_CORE)) {
  const runCore = () => {
    console.log(`[Core] Launching Xray on port ${PORT} (VLESS + Reality + TLS)...`);
    const xray = spawn(BIN_CORE, ['run', '-c', 'config.json']);
    xray.stdout.on('data', data => console.log(`[Xray] ${data.toString().trim()}`));
    xray.stderr.on('data', data => console.log(`[Xray] ${data.toString().trim()}`));
    xray.on('exit', (code) => {
      console.log(`[Xray] Exited with code ${code}, restarting in 3s...`);
      setTimeout(runCore, 3000);
    });
  };
  runCore();
}

// 9. 打印节点链接
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
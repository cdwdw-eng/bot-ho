// bot-ho改造版: 原版结构 + VLESS + Reality + TLS
// 基于 commit 1ff36e19 原版
// 改动: 只修改 inbounds 配置 (加 Reality),保留其他功能

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const crypto = require('crypto');

process.on('uncaughtException', (err) => console.error('[Error]', err.message));
process.on('unhandledRejection', (reason) => console.error('[Error]', reason));

const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || 3000);
const configPath = path.join(__dirname, 'config.json');

// 1. 动态获取当前容器真实公网 IP (保留原版)
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

// 2. 纯动态 PTR 反向解析 (保留原版)
async function getDynamicDomain(targetIp) {
  if (!targetIp || targetIp === '127.0.0.1') return null;
  try {
    const hostnames = await dns.reverse(targetIp);
    if (hostnames && hostnames.length > 0) {
      return hostnames[0];
    }
  } catch (e) {}
  return null;
}

// 3. 清理残留进程 (保留原版)
try {
  execSync('pkill -f web || true');
  execSync('pkill -f npm-runner || true');
} catch (e) {}

// 5. 动态读取 UUID (保留原版)
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

// 6. Reality 配置 (新增)
const REALITY_DEST = process.env.REALITY_DEST || 'www.apple.com:443';
const REALITY_SERVER_NAMES = (process.env.REALITY_SERVER_NAMES || 'www.apple.com,www.google.com,www.microsoft.com,www.samsung.com').split(',');

// 7. 生成/加载 Reality key pair (新增)
const KEY_DIR = path.join(__dirname, 'keys');
let PRIVATE_KEY = '';
let PUBLIC_KEY = '';

if (!fs.existsSync(KEY_DIR)) {
  fs.mkdirSync(KEY_DIR, { recursive: true });
}
const KEY_FILE = path.join(KEY_DIR, 'reality_key.txt');

if (fs.existsSync(KEY_FILE) && fs.existsSync(KEY_FILE + '.pub')) {
  // 加载持久化的 key pair (URL 永久有效)
  PRIVATE_KEY = fs.readFileSync(KEY_FILE, 'utf8').trim();
  PUBLIC_KEY = fs.readFileSync(KEY_FILE + '.pub', 'utf8').trim();
  console.log(`[Reality] Loaded persistent keys from ${KEY_DIR} (priv=${PRIVATE_KEY.length}, pub=${PUBLIC_KEY.length})`);
}

// 8. 自动下载 Sing-box 二进制 (保留原版)
const decode = (str) => Buffer.from(str, 'base64').toString('utf-8');
const URL_CORE = decode('aHR0cHM6Ly9naXRodWIuY29tL1NhZ2VyTmV0L3NpbmctYm94L3JlbGVhc2VzL2Rvd25sb2FkL3YxLjkuMy9zaW5nLWJveC0xLjkuMy1saW51eC1hbWQ2NC50YXIuZ3o=');
const URL_TUNNEL = decode('aHR0cHM6Ly9naXRodWIuY29tL2Nsb3VkZmxhcmUvY2xvdWRmbGFyZWQvcmVsZWFzZXMvbGF0ZXN0L2Rvd25sb2FkL2Nsb3VkZmxhcmVkLWxpbnV4LWFtZDY0');

const BIN_CORE = path.join(__dirname, 'web');
const BIN_TUNNEL = path.join(__dirname, 'npm-runner');
const ua = 'npm/9.6.7 node/v18.16.0 linux x64';

if (!fs.existsSync(BIN_CORE)) {
  try {
    console.log('[Core] Downloading Sing-box core...');
    execSync(`curl -A "${ua}" -sSL "${URL_CORE}" | tar -xz -C /tmp && mv /tmp/sing-box-*/sing-box ${BIN_CORE} && chmod +x ${BIN_CORE}`);
  } catch (e) { console.error('[Core Download Failed]:', e.message); }
}

if (!fs.existsSync(BIN_TUNNEL)) {
  try {
    console.log('[Tunnel] Downloading cloudflared...');
    execSync(`curl -A "${ua}" -sSL -o ${BIN_TUNNEL} "${URL_TUNNEL}" && chmod +x ${BIN_TUNNEL}`);
  } catch (e) { console.error('[Tunnel Download Failed]:', e.message); }
}

// 9. 强制重新生成 Reality key pair (每次启动都生成新的,确保一致)
if (fs.existsSync(BIN_CORE)) {
  try {
    // sing-box 1.13+ generate reality-keypair 只能全新生成 (不接受 -i/--private-key)
    const result = execSync(`${BIN_CORE} generate reality-keypair`, { encoding: 'utf8' });
    console.log('[Reality] sing-box generate reality-keypair output:', JSON.stringify(result));
    
    // 输出格式: PrivateKey: <base64-url>\nPublicKey: <base64-url>
    const privMatch = result.match(/PrivateKey:\s*([A-Za-z0-9_-]+)/);
    const pubMatch = result.match(/PublicKey:\s*([A-Za-z0-9_-]+)/);
    
    if (privMatch && pubMatch) {
      PRIVATE_KEY = privMatch[1];
      PUBLIC_KEY = pubMatch[1];
      
      console.log(`[Reality] priv="${PRIVATE_KEY}" (len=${PRIVATE_KEY.length})`);
      console.log(`[Reality] pub="${PUBLIC_KEY}" (len=${PUBLIC_KEY.length})`);
      
      const buf = Buffer.from(PRIVATE_KEY, 'base64');
      console.log(`[Reality] decoded length: ${buf.length} bytes (need 32)`);
      
      if (buf.length !== 32) {
        console.error('[Reality] ERROR: decoded private key is not 32 bytes!');
        PRIVATE_KEY = '';
        PUBLIC_KEY = '';
      } else {
        fs.writeFileSync(KEY_FILE, PRIVATE_KEY);
        fs.writeFileSync(KEY_FILE + '.pub', PUBLIC_KEY);
        console.log('[Reality] Key pair saved successfully');
      }
    } else {
      console.error('[Reality] Could not extract keys from sing-box x25519 output');
      console.error('[Reality] Full output:');
      console.error(result);
    }
  } catch (e) {
    console.error('[Key Generation Error]:', e.message);
  }
}

// 10. 生成 2 个短 ID
// 持久化短 ID (让节点 URL 永久有效)
const SHORT_ID_FILE = path.join(KEY_DIR, 'short_id.txt');
let SHORT_IDS;
if (fs.existsSync(SHORT_ID_FILE)) {
  const savedId = fs.readFileSync(SHORT_ID_FILE, 'utf8').trim();
  SHORT_IDS = [savedId, crypto.randomBytes(4).toString('hex')];
  console.log(`[Reality] Loaded persistent short_id: ${savedId}`);
} else {
  SHORT_IDS = [
    crypto.randomBytes(4).toString('hex'),
    crypto.randomBytes(4).toString('hex')
  ];
  fs.writeFileSync(SHORT_ID_FILE, SHORT_IDS[0]);
  console.log(`[Reality] Generated new short_id: ${SHORT_IDS[0]}`);
}

// 11. Reality 增强的 sing-box 配置 (修改原版 inbounds)
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
        handshake: {
          server: REALITY_SERVER_NAMES[0],
          server_port: 443
        },
        private_key: PRIVATE_KEY,
        short_id: SHORT_IDS
      }
    }
  }],
  outbounds: [{ type: "direct", tag: "direct" }]
};

fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));

// 12. 启动 Sing-box (保留原版)
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

// 13. 启动隧道并打印节点 (保留原版 + 添加 Reality节点)
if (fs.existsSync(BIN_TUNNEL)) {
  const runTunnel = async () => {
    console.log('[Tunnel] Starting Cloudflare Tunnel...');
    const domainName = await getDynamicDomain(IP);
    const cf = spawn(BIN_TUNNEL, ['tunnel', '--url', `http://127.0.0.1:${PORT}`]);
    let printed = false;
    
    cf.stderr.on('data', data => {
      const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !printed) {
        printed = true;
        const sub = match[0].replace('https://', '');
        console.log('\n==================================================');
        console.log(`[Auto-Detect] 真实外网 IP: ${IP}`);
        console.log(`[Auto-Detect] PTR 反查解析域名: ${domainName || '机房未绑定反向 PTR 记录'}`);
        console.log(`[UUID Sync] 生效 UUID: ${UUID}`);
        console.log(`[Reality] 目标伪装: ${REALITY_DEST}`);
        console.log(`[Reality] 公钥: ${PUBLIC_KEY}`);
        console.log(`[Reality] 短 ID: ${SHORT_IDS.join(', ')}`);
        
        console.log('\n🚀【CF 隧道加密节点链接】(Reality):');
        console.log(`vless://${UUID}@${sub}:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SERVER_NAMES[0]}&fp=chrome&pbk=${PUBLIC_KEY}&sid=${SHORT_IDS[0]}&type=tcp&headerType=none#CF-Tunnel-Reality`);
        
        console.log('\n⚡【原生 IP 直连节点链接】(Reality):');
        console.log(`vless://${UUID}@${IP}:${PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SERVER_NAMES[0]}&fp=chrome&pbk=${PUBLIC_KEY}&sid=${SHORT_IDS[0]}&type=tcp&headerType=none#Native-IP-Reality`);
        
        if (domainName) {
          console.log('\n🌐【原生域名直连节点链接】(Reality):');
          console.log(`vless://${UUID}@${domainName}:${PORT}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${REALITY_SERVER_NAMES[0]}&fp=chrome&pbk=${PUBLIC_KEY}&sid=${SHORT_IDS[0]}&type=tcp&headerType=none#Native-Domain-Reality`);
        }
        console.log('==================================================\n');
      }
    });
    cf.on('exit', () => setTimeout(runTunnel, 5000));
  };
  runTunnel();
}

setInterval(() => {}, 100000);
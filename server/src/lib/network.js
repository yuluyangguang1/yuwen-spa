// 网络工具：获取本机局域网 IP
// 供 index.js 和 health.js 共用，消除 DRY 违规

import os from 'node:os'

export function getLanIPs() {
  const ifs = os.networkInterfaces()
  const ips = []
  for (const name of Object.keys(ifs)) {
    for (const iface of ifs[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address)
      }
    }
  }
  return ips
}

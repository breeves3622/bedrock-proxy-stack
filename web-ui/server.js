const http = require('http')
const fs = require('fs')
const path = require('path')
const dgram = require('dgram')

const PORT = parseInt(process.env.PORT || '8080', 10)
const SERVERS_FILE = process.env.SERVERS_FILE || path.join(__dirname, 'custom_servers.json')
const TARGET_CONTAINER = process.env.TARGET_CONTAINER || 'bedrock-proxy'
const XBOX_CONTAINER = process.env.XBOX_CONTAINER || 'mcxboxbroadcast'
const XBOX_CONFIG_DIR = process.env.XBOX_CONFIG_DIR || '/xbox-config'
const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''

// Helper to make requests to Docker daemon over Unix socket
function dockerRequest(endpoint, method = 'GET', postData = null) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(DOCKER_SOCKET)) {
      return resolve({
        error: `Docker socket (${DOCKER_SOCKET}) not found. Ensure it is mounted into the container.`,
        available: false
      })
    }

    const options = {
      socketPath: DOCKER_SOCKET,
      path: endpoint,
      method: method,
      headers: {}
    }

    if (postData) {
      options.headers['Content-Type'] = 'application/json'
      options.headers['Content-Length'] = Buffer.byteLength(postData)
    }

    const req = http.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} })
          } else {
            resolve({ statusCode: res.statusCode, error: data || res.statusMessage })
          }
        } catch (e) {
          resolve({ statusCode: res.statusCode, body: data })
        }
      })
    })

    req.on('error', (err) => {
      resolve({ error: err.message, available: false })
    })

    if (postData) req.write(postData)
    req.end()
  })
}

// Ping a Minecraft Bedrock server via RakNet Unconnected Ping (UDP)
function pingBedrock(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    const startTime = Date.now()

    // RakNet Magic: 00ffff00fefefefefdfdfdfd12345678
    const raknetMagic = Buffer.from([
      0x00, 0xff, 0xff, 0x00, 0xfe, 0xfe, 0xfe, 0xfe,
      0xfd, 0xfd, 0xfd, 0xfd, 0x12, 0x34, 0x56, 0x78
    ])

    // Packet ID 0x01 (Unconnected Ping)
    const packet = Buffer.alloc(33)
    packet.writeUInt8(0x01, 0)
    packet.writeBigInt64BE(BigInt(Date.now()), 1)
    raknetMagic.copy(packet, 9)
    packet.writeBigInt64BE(BigInt(12345678), 25)

    let timer = setTimeout(() => {
      socket.close()
      resolve({ online: false, error: 'Timed out' })
    }, timeoutMs)

    socket.on('message', (msg) => {
      clearTimeout(timer)
      const latency = Date.now() - startTime
      socket.close()

      try {
        if (msg.length > 35 && (msg[0] === 0x1c || msg[0] === 0x1d)) {
          const strLen = msg.readUInt16BE(33)
          const motdStr = msg.subarray(35, 35 + strLen).toString('utf8')
          const parts = motdStr.split(';')
          // Format: MCPE;Server Name;Protocol;Version;Players;MaxPlayers;ServerID;WorldName;GameMode
          resolve({
            online: true,
            latency,
            serverName: parts[1] || 'Bedrock Server',
            version: parts[3] || '',
            players: parts[4] || '0',
            maxPlayers: parts[5] || '0'
          })
        } else {
          resolve({ online: true, latency })
        }
      } catch (err) {
        resolve({ online: true, latency })
      }
    })

    socket.on('error', (err) => {
      clearTimeout(timer)
      socket.close()
      resolve({ online: false, error: err.message })
    })

    try {
      socket.send(packet, port, host)
    } catch (e) {
      clearTimeout(timer)
      socket.close()
      resolve({ online: false, error: e.message })
    }
  })
}

// Read servers from custom_servers.json
function readServers() {
  try {
    const dir = path.dirname(SERVERS_FILE)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    if (!fs.existsSync(SERVERS_FILE)) {
      const defaultServers = [
        { name: 'Local Survival Server', address: '192.168.1.100', port: 19133 },
        { name: 'Creative World', address: '192.168.1.100', port: 19134 }
      ]
      writeServers(defaultServers)
      return defaultServers
    }

    const stat = fs.statSync(SERVERS_FILE)
    if (stat.isDirectory()) {
      console.error(`SERVERS_FILE (${SERVERS_FILE}) is a directory! Expected a json file.`)
      return []
    }

    const content = fs.readFileSync(SERVERS_FILE, 'utf8')
    return JSON.parse(content)
  } catch (err) {
    console.error('Error reading servers file:', err.message)
    return []
  }
}

// Write servers to custom_servers.json safely
function writeServers(servers) {
  const dir = path.dirname(SERVERS_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const content = JSON.stringify(servers, null, 2)
  fs.writeFileSync(SERVERS_FILE, content, 'utf8')
}

// Authentication check middleware
function checkAuth(req) {
  if (!ADMIN_PASSWORD) return true
  const authHeader = req.headers['authorization']
  if (!authHeader) return false
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7) === ADMIN_PASSWORD
  }
  return false
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)

  // Helper for JSON responses
  const sendJson = (data, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    })
    res.end(JSON.stringify(data))
  }

  // Handle CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    })
    return res.end()
  }

  // API Endpoints
  if (url.pathname.startsWith('/api/')) {
    // 1. Check Auth Status
    if (url.pathname === '/api/auth/status') {
      return sendJson({ authRequired: Boolean(ADMIN_PASSWORD) })
    }

    // 2. Login endpoint
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', () => {
        try {
          const { password } = JSON.parse(body)
          if (!ADMIN_PASSWORD || password === ADMIN_PASSWORD) {
            return sendJson({ success: true, token: ADMIN_PASSWORD })
          }
          return sendJson({ success: false, error: 'Invalid password' }, 401)
        } catch (e) {
          return sendJson({ error: 'Malformed JSON' }, 400)
        }
      })
      return
    }

    // Enforce auth on mutation or protected endpoints if password set
    if (ADMIN_PASSWORD && !checkAuth(req)) {
      return sendJson({ error: 'Unauthorized' }, 401)
    }

    // 3. Get Servers
    if (url.pathname === '/api/servers' && req.method === 'GET') {
      const servers = readServers()
      return sendJson({ servers })
    }

    // 4. Save Servers
    if (url.pathname === '/api/servers' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body)
          if (!Array.isArray(parsed.servers)) {
            return sendJson({ error: 'Invalid payload: "servers" must be an array.' }, 400)
          }

          // Basic validation
          for (const s of parsed.servers) {
            if (!s.name || !s.address || !s.port) {
              return sendJson({ error: 'Each server must have a name, address, and port.' }, 400)
            }
            s.port = parseInt(s.port, 10)
          }

          writeServers(parsed.servers)
          return sendJson({ success: true, count: parsed.servers.length })
        } catch (e) {
          return sendJson({ error: 'Failed to parse JSON body' }, 400)
        }
      })
      return
    }

    // 5. Ping Server
    if (url.pathname === '/api/ping' && req.method === 'GET') {
      const host = url.searchParams.get('host')
      const port = parseInt(url.searchParams.get('port') || '19132', 10)

      if (!host) {
        return sendJson({ error: 'Missing host parameter' }, 400)
      }

      const result = await pingBedrock(host, port)
      return sendJson(result)
    }

    // 6. Docker Container Status
    if (url.pathname === '/api/proxy/status' && req.method === 'GET') {
      const inspect = await dockerRequest(`/containers/${TARGET_CONTAINER}/json`)
      if (inspect.error) {
        return sendJson({
          container: TARGET_CONTAINER,
          running: false,
          status: 'unknown',
          error: inspect.error
        })
      }

      const state = inspect.body.State || {}
      return sendJson({
        container: TARGET_CONTAINER,
        running: state.Running || false,
        status: state.Status || 'stopped',
        startedAt: state.StartedAt,
        restartCount: inspect.body.RestartCount || 0
      })
    }

    // 7. Restart Proxy Container
    if (url.pathname === '/api/proxy/restart' && req.method === 'POST') {
      const result = await dockerRequest(`/containers/${TARGET_CONTAINER}/restart`, 'POST')
      if (result.error) {
        return sendJson({ success: false, error: result.error }, 500)
      }
      return sendJson({ success: true, message: `Container ${TARGET_CONTAINER} restarted successfully` })
    }

    // 8. Get Container Logs
    if (url.pathname === '/api/proxy/logs' && req.method === 'GET') {
      const tail = parseInt(url.searchParams.get('tail') || '100', 10)
      const result = await dockerRequest(`/containers/${TARGET_CONTAINER}/logs?stdout=1&stderr=1&tail=${tail}`)
      if (result.error) {
        return sendJson({ error: result.error }, 500)
      }

      // Clean Docker multiplex headers if present
      let rawLogs = typeof result.body === 'string' ? result.body : ''
      const cleanLogs = rawLogs.replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, '')
      return sendJson({ logs: cleanLogs })
    }

    // 9. Detailed Xbox Broadcaster Status & Join Links
    if (url.pathname === '/api/xbox/details' && req.method === 'GET') {
      const inspect = await dockerRequest(`/containers/${XBOX_CONTAINER}/json`)
      const isRunning = inspect.body?.State?.Running || false
      const status = inspect.body?.State?.Status || 'stopped'

      let logs = ''
      let authRequired = false
      let authUrl = null
      let authCode = null
      let detectedGamertag = ''

      if (isRunning) {
        const logRes = await dockerRequest(`/containers/${XBOX_CONTAINER}/logs?stdout=1&stderr=1&tail=150`)
        let rawLogs = typeof logRes.body === 'string' ? logRes.body : ''
        logs = rawLogs.replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, '')

        // Try extracting gamertag from logs
        const tagMatch = logs.match(/(?:Account linked|Logged in as|Broadcasting as|Gamertag)[:\s]+([A-Za-z0-9_ #]+)/i)
        if (tagMatch) detectedGamertag = tagMatch[1].trim()

        const isLinkedOrBroadcasting = Boolean(
          detectedGamertag ||
          /Account linked|Xbox Broadcast:\s*Ready|Creating Xbox LIVE session|Session is now active|Broadcasting as|Logged in as/i.test(logs)
        )

        // Only mark authRequired if the prompt exists AND we are not yet linked/broadcasting
        if (linkMatch && codeMatch && !isLinkedOrBroadcasting) {
          authRequired = true
          authUrl = linkMatch[0]
          authCode = codeMatch[1]
        }
      }

      // Read saved config or custom gamertag file
      let savedGamertag = ''
      const tagFile = path.join(XBOX_CONFIG_DIR, 'gamertag.txt')
      if (fs.existsSync(tagFile)) {
        try { savedGamertag = fs.readFileSync(tagFile, 'utf8').trim() } catch(e) {}
      }
      const gamertag = savedGamertag || detectedGamertag || ''

      // Read IP & Port from config.yml if available
      let ip = ''
      let port = 19132
      const configPath = path.join(XBOX_CONFIG_DIR, 'config.yml')
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf8')
          const ipMatch = content.match(/ip:\s*["']?([^"'\r\n]+)["']?/)
          const portMatch = content.match(/port:\s*([0-9]+)/)
          if (ipMatch) ip = ipMatch[1].trim()
          if (portMatch) port = parseInt(portMatch[1].trim(), 10)
        } catch(e) {}
      }

      // Generate join links
      const xboxProfileUrl = gamertag ? `https://account.xbox.com/Profile?gamerTag=${encodeURIComponent(gamertag)}` : ''
      const directJoinUri = ip ? `minecraft://?addExternalServer=${encodeURIComponent('Bedrock Proxy')}|${ip}:${port}` : ''
      const shareMessage = gamertag 
        ? `Join my Minecraft server from console, mobile, or PC without DNS hacks!\n1. Add Xbox friend: ${gamertag}\n2. Open Minecraft -> Friends Tab -> Join!\n(Direct profile: ${xboxProfileUrl})`
        : `Join my Minecraft server via Bedrock Proxy!`

      return sendJson({
        container: XBOX_CONTAINER,
        running: isRunning,
        status,
        startedAt: inspect.body?.State?.StartedAt,
        authRequired,
        authUrl,
        authCode,
        gamertag,
        ip,
        port,
        joinLinks: {
          xboxProfileUrl,
          directJoinUri,
          shareMessage
        }
      })
    }

    // 10. Xbox Broadcaster Logs
    if (url.pathname === '/api/xbox/logs' && req.method === 'GET') {
      const tail = parseInt(url.searchParams.get('tail') || '100', 10)
      const result = await dockerRequest(`/containers/${XBOX_CONTAINER}/logs?stdout=1&stderr=1&tail=${tail}`)
      if (result.error) {
        return sendJson({ error: result.error }, 500)
      }

      let rawLogs = typeof result.body === 'string' ? result.body : ''
      const cleanLogs = rawLogs.replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, '')
      return sendJson({ logs: cleanLogs })
    }

    // 11. Restart Xbox Broadcaster Container
    if (url.pathname === '/api/xbox/restart' && req.method === 'POST') {
      const result = await dockerRequest(`/containers/${XBOX_CONTAINER}/restart`, 'POST')
      if (result.error) {
        return sendJson({ success: false, error: result.error }, 500)
      }
      return sendJson({ success: true, message: `Container ${XBOX_CONTAINER} restarted successfully` })
    }

    // 12. Save Broadcaster Settings (IP, Port, Gamertag)
    if (url.pathname === '/api/xbox/save-settings' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', async () => {
        try {
          const { ip, port, gamertag, restart } = JSON.parse(body)
          if (!fs.existsSync(XBOX_CONFIG_DIR)) {
            fs.mkdirSync(XBOX_CONFIG_DIR, { recursive: true })
          }

          if (gamertag !== undefined) {
            fs.writeFileSync(path.join(XBOX_CONFIG_DIR, 'gamertag.txt'), String(gamertag).trim(), 'utf8')
          }

          // Update config.yml
          const configPath = path.join(XBOX_CONFIG_DIR, 'config.yml')
          let configContent = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
          
          if (!configContent) {
            configContent = `sessionInfo:\n  host-name: "Bedrock Proxy"\n  world-name: "Custom Server Selection"\n  ip: "${ip || '127.0.0.1'}"\n  port: ${port || 19132}\n`
          } else {
            if (ip) {
              if (/ip:\s*.*/.test(configContent)) {
                configContent = configContent.replace(/ip:\s*.*/, `ip: "${ip}"`)
              } else {
                configContent += `\n  ip: "${ip}"`
              }
            }
            if (port) {
              if (/port:\s*.*/.test(configContent)) {
                configContent = configContent.replace(/port:\s*.*/, `port: ${port}`)
              } else {
                configContent += `\n  port: ${port}`
              }
            }
          }
          fs.writeFileSync(configPath, configContent, 'utf8')

          if (restart) {
            await dockerRequest(`/containers/${XBOX_CONTAINER}/restart`, 'POST')
          }

          return sendJson({ success: true, message: 'Settings saved successfully' })
        } catch (e) {
          return sendJson({ error: e.message }, 400)
        }
      })
      return
    }

    // 13. Re-authenticate / Reset Xbox Broadcaster Session
    if (url.pathname === '/api/xbox/reauth' && req.method === 'POST') {
      try {
        if (fs.existsSync(XBOX_CONFIG_DIR)) {
          const files = fs.readdirSync(XBOX_CONFIG_DIR)
          for (const file of files) {
            // Delete token and cache files to force new login prompt
            if (file.toLowerCase().includes('token') || file.toLowerCase().includes('auth') || file.endsWith('.cache')) {
              try { fs.unlinkSync(path.join(XBOX_CONFIG_DIR, file)) } catch(err) {}
            }
          }
        }
        await dockerRequest(`/containers/${XBOX_CONTAINER}/restart`, 'POST')
        return sendJson({ success: true, message: 'Cleared login tokens and restarted broadcaster' })
      } catch (e) {
        return sendJson({ error: e.message }, 500)
      }
    }

    return sendJson({ error: 'Not found' }, 404)
  }

  // Serve Single-Page App (index.html)
  const indexPath = path.join(__dirname, 'public', 'index.html')
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    fs.createReadStream(indexPath).pipe(res)
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Web UI index.html not found')
  }
})

server.listen(PORT, () => {
  console.log(`[Bedrock Proxy Web UI] Running on http://0.0.0.0:${PORT}`)
  console.log(`[Bedrock Proxy Web UI] Target servers file: ${SERVERS_FILE}`)
  console.log(`[Bedrock Proxy Web UI] Target container: ${TARGET_CONTAINER}`)

  // Ensure directories exist with proper write permissions for all containers
  try {
    const serverDir = path.dirname(SERVERS_FILE)
    if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true })
    fs.chmodSync(serverDir, 0o777)
  } catch (e) {}

  try {
    if (!fs.existsSync(XBOX_CONFIG_DIR)) fs.mkdirSync(XBOX_CONFIG_DIR, { recursive: true })
    fs.chmodSync(XBOX_CONFIG_DIR, 0o777)
  } catch (e) {}
})

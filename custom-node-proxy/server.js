/**
 * Custom Minecraft Bedrock Proxy with Server Selection Menu
 * Uses bedrock-protocol to listen for LAN discovery and render Bedrock Modal Forms.
 */

const bedrock = require('bedrock-protocol')

// Configuration for downstream target servers
const SERVERS = [
  { name: 'Survival SMP', address: '192.168.1.100', port: 19133 },
  { name: 'Creative World', address: '192.168.1.100', port: 19134 },
  { name: 'Geyser / Java Server', address: '192.168.1.100', port: 19135 }
]

const PROXY_PORT = parseInt(process.env.PROXY_PORT || '19132', 10)

const server = bedrock.createServer({
  host: '0.0.0.0',
  port: PROXY_PORT,
  motd: {
    motd: 'Bedrock LAN Proxy',
    levelName: 'Custom Server Selector'
  },
  maxPlayers: 20
})

console.log(`[Bedrock Proxy] Listening on UDP ${PROXY_PORT} (Responding to LAN Discovery)...`)

server.on('connect', (client) => {
  console.log(`[Bedrock Proxy] Player connecting: ${client.profile?.name || client.address}`)

  client.on('join', () => {
    console.log(`[Bedrock Proxy] Player joined limbo session, sending server menu form...`)

    // Build Bedrock Simple Form (ModalFormRequest)
    const form = {
      type: 'form',
      title: 'Server Selection Menu',
      content: 'Choose a server to join:',
      buttons: SERVERS.map((s) => ({ text: `${s.name}\n§7${s.address}:${s.port}` }))
    }

    client.write('modal_form_request', {
      formId: 1001,
      formData: JSON.stringify(form)
    })
  })

  // Handle client interaction with the Form
  client.on('packet', (packet) => {
    if (packet.data.name === 'modal_form_response') {
      const formResponse = packet.data.params

      if (formResponse.formId === 1001 && formResponse.formData) {
        const selectedIndex = JSON.parse(formResponse.formData)

        if (typeof selectedIndex === 'number' && SERVERS[selectedIndex]) {
          const target = SERVERS[selectedIndex]
          console.log(`[Bedrock Proxy] Transferring player to ${target.name} (${target.address}:${target.port})...`)

          // Issue Bedrock TransferPacket
          client.write('transfer', {
            server_address: target.address,
            port: target.port
          })
        }
      }
    }
  })
})

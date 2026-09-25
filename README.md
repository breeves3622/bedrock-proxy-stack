# Minecraft Bedrock LAN Proxy & Web Management Dashboard

A complete Docker solution designed for **Portainer** and home servers to:
1. **Appear automatically under "LAN Games" (Friends/Worlds tab)** on Bedrock clients (PlayStation, Xbox, PC, iOS, Android).
2. **Present a custom in-game GUI menu** (Native Bedrock Modal Form) when a player connects.
3. **Provide a browser-based Web Management Dashboard** on port `8090` to:
   - Add, edit, reorder, and remove servers in real-time.
   - Live test/ping Bedrock servers (shows online/offline status, latency in ms, and player count).
   - View live proxy container logs directly in your browser.
   - Restart the Bedrock proxy service with a single click (or automatically on save).

---

## 📸 Architecture Overview

```
+-------------------------------------------------------------+
|                      Minecraft Players                      |
|          (PlayStation / Xbox / Switch / Mobile / PC)        |
+-------------------------------------------------------------+
                               |
                               | (UDP 19132 LAN Broadcast & Join)
                               v
+-------------------------------------------------------------+
|              bedrock-proxy Container (Port 19132)           |
|                Presents In-Game Server Menu                 |
+-------------------------------------------------------------+
               ^                               ^
               | (Reads/Updates)               | (Docker restart / logs)
               v                               |
+------------------------------+   +--------------------------+
|     custom_servers.json      |   |   /var/run/docker.sock   |
+------------------------------+   +--------------------------+
               ^                               ^
               |                               |
+-------------------------------------------------------------+
|             proxy-web-ui Container (Port 8090)              |
|        Browser Web Dashboard (Edit, Ping, Restart)          |
+-------------------------------------------------------------+
                               ^
                               | (HTTP 8090)
+-------------------------------------------------------------+
|                    Administrator Browser                    |
|                http://<server-ip>:8090                      |
+-------------------------------------------------------------+
```

---

## 🚀 Deployment via Portainer

### Method 1: Portainer Git Repository Stack (Recommended)
1. In Portainer, navigate to **Stacks** -> **Add stack**.
2. Select **Repository**:
   - **Repository URL:** `https://github.com/breeves3622/bedrock-proxy-stack`
   - **Repository reference:** `refs/heads/main` (or `refs/heads/master`, or leave blank)
   - **Compose path:** `docker-compose.yml`
5. Click **Deploy the stack**. Portainer will automatically build the `web-ui` image and start both containers.

### Method 2: Local Directory / Web Editor
If you copied this folder onto your server:
1. Ensure `custom_servers.json` exists in your folder:
   ```json
   [
     {
       "name": "Local Survival Server",
       "address": "192.168.1.100",
       "port": 19133
     }
   ]
   ```
2. Run `docker compose up -d --build` (or create a stack in Portainer pointing to the directory).

---

## 🌐 Accessing the Web Dashboard

Open your browser and navigate to:
```
http://<your-server-ip>:8090
```

### Dashboard Features:
* **🟢 Real-Time Proxy Status:** Shows whether the proxy container is online, uptime, and restart count.
* **⚡ One-Click Restart:** Instantly restarts the proxy container if needed.
* **📡 Live Bedrock Ping:** Sends RakNet UDP pings to your game servers to display live latency, online status, and player counts (`e.g. 4/20 players`).
* **✏️ Interactive Editor:** Add, edit, reorder (▲/▼), or remove servers without touching JSON files manually.
* **🚀 Save & Restart:** Writes the new configuration and reboots the proxy so players immediately see the updated server list.
* **📜 Proxy Log Viewer:** Stream the latest 100 lines of proxy logs without logging into Portainer or SSH.

---

## ⚙️ Configuration & Environment Variables

### `proxy-web-ui` Options
In `docker-compose.yml`:
* `PORT`: Port the web dashboard listens on (default: `8080`).
* `SERVERS_FILE`: Path to `custom_servers.json` inside the container (default: `/config/custom_servers.json`).
* `TARGET_CONTAINER`: Name of the proxy container to manage (default: `bedrock-proxy`).
* `ADMIN_PASSWORD`: *(Optional)* Set a password to require login before saving changes or restarting.

### Docker Socket Permission
The web UI controls the proxy via `/var/run/docker.sock`. Ensure `/var/run/docker.sock` is mounted into the `proxy-web-ui` container as defined in `docker-compose.yml`.

---

## 🎮 How Players Connect on Bedrock

1. Make sure your device (PlayStation, Xbox, Mobile, PC) is connected to the same Wi-Fi / LAN network.
2. Open Minecraft Bedrock Edition.
3. Go to the **Friends** tab (or **Worlds** tab depending on platform).
4. Look under **LAN Games** — you will see **My Bedrock Proxy**.
5. Tap to join. You will be greeted with the custom server selection menu!

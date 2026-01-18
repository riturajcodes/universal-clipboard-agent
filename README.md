# Universal Clipboard Agent

A cross-platform, real-time clipboard synchronization tool. This project allows you to seamlessly share text, images, and files between Windows, Linux, and macOS devices (and mobile via local network) using WebRTC for secure peer-to-peer communication.

## Features

- **Real-time Sync**: Copy on one device, paste on another instantly.
- **File Transfer**: Supports transferring files and images via standard clipboard copy/paste actions.
- **Secure P2P**: Uses WebRTC encryption for direct device-to-device data transfer.
- **Local Dashboard**: A web-based UI to manage connections and view clipboard history.
- **QR Code Pairing**: Generate QR codes to easily connect mobile devices on the local network.

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- npm (Node Package Manager)
- **Linux Users**: You may need `xsel` (for X11) or `wl-clipboard` (for Wayland) installed.

## Setup and Installation

### 1. Client Setup (Required)

The client runs on your local machine to monitor the clipboard and handle connections.

1.  Open a terminal and navigate to the client directory:

    ```bash
    cd win-lin-mac-client
    ```

2.  Install dependencies:

    ```bash
    npm install
    ```

3.  Start the client:

    ```bash
    node server.js
    ```

4.  The client dashboard will be available at `http://localhost:4001`.

### 2. Server Setup (Optional)

The client connects to a central signaling server to find peers. By default, it connects to a hosted instance. If you want to host the signaling server yourself:

1.  Navigate to `universal-server` and run `npm install`.
2.  Start it with `node index.js` (runs on port 3000).
3.  Update `SERVER_URL` in `win-lin-mac-client/server.js` to `ws://localhost:3000`.

## How to Use

1.  **Open Dashboard**: Go to `http://localhost:4001` in your browser.
2.  **Join a Room**:
    - Click **Create Room** to generate a new Room ID.
    - Or, enter a Room ID from another device and click **Join**.
3.  **Connect Mobile/Local Devices**:
    - Once inside a room, click **Generate QR** (top right).
    - Scan the QR code with a phone connected to the same Wi-Fi to join the room via the local network.
4.  **Sync**:
    - Simply copy text or files on your computer. They will automatically be sent to connected peers.

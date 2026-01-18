const devicesList = document.getElementById('devicesList');
const clipboardHistory = document.getElementById('clipboardHistory');
const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
const roomIdInput = document.getElementById('roomId');
const loginScreen = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const currentRoomDisplay = document.getElementById('currentRoomDisplay');

// Inject QRCode library
const qrScript = document.createElement('script');
qrScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
document.head.appendChild(qrScript);

// Auto-join if roomId is in URL
window.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const rid = params.get('roomId');
    if (rid) {
        roomIdInput.value = rid;
        joinBtn.click();
    }
});

createBtn.addEventListener('click', () => {
    fetch('https://universal-clipboard-agent.onrender.com/api/rooms/create', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            roomIdInput.value = data.roomId;
        })
        .catch(err => alert('Failed to create room: ' + err));
});

joinBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) return alert('Enter a room ID');
    
    fetch(`/api/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showDashboard(roomId);
            }
        });
});

function showDashboard(roomId) {
    loginScreen.style.display = 'none';
    dashboardScreen.style.display = 'block';
    currentRoomDisplay.textContent = `Room: ${roomId}`;
    
    const qrBtn = document.createElement('button');
    qrBtn.textContent = 'Generate QR';
    qrBtn.style.float = 'right';
    qrBtn.onclick = () => {
        fetch('/api/local-ip')
            .then(res => res.json())
            .then(data => {
                const url = `http://${data.ip}:${data.port}/?roomId=${roomId}`;
                
                const modal = document.createElement('div');
                Object.assign(modal.style, {
                    position: 'fixed', top: '0', left: '0', width: '100%', height: '100%',
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', 
                    justifyContent: 'center', alignItems: 'center', zIndex: '1000'
                });
                
                const content = document.createElement('div');
                Object.assign(content.style, {
                    backgroundColor: 'white', padding: '20px', borderRadius: '8px',
                    textAlign: 'center', minWidth: '300px'
                });
                
                const qrDiv = document.createElement('div');
                qrDiv.style.display = 'flex';
                qrDiv.style.justifyContent = 'center';
                new QRCode(qrDiv, { text: url, width: 200, height: 200 });
                
                const linkText = document.createElement('p');
                linkText.textContent = url;
                linkText.style.marginTop = '15px';
                linkText.style.wordBreak = 'break-all';

                const closeBtn = document.createElement('button');
                closeBtn.textContent = 'Close';
                closeBtn.style.marginTop = '15px';
                closeBtn.onclick = () => document.body.removeChild(modal);
                
                content.appendChild(qrDiv);
                content.appendChild(linkText);
                content.appendChild(closeBtn);
                modal.appendChild(content);
                document.body.appendChild(modal);
            });
    };
    currentRoomDisplay.appendChild(qrBtn);
    
    setInterval(pollStatus, 2000);
    pollStatus();
}

let lastPeersJson = '';
let lastHistoryJson = '';

function pollStatus() {
    fetch('/api/status')
        .then(res => res.json())
        .then(data => {
            const currentPeersJson = JSON.stringify(data.peers);
            if (currentPeersJson !== lastPeersJson) {
                devicesList.innerHTML = '';
                if (data.peers) {
                    data.peers.forEach(peer => addDevice(peer, ''));
                }
                lastPeersJson = currentPeersJson;
            }

            const currentHistoryJson = JSON.stringify(data.history);
            if (currentHistoryJson !== lastHistoryJson) {
                clipboardHistory.innerHTML = '';
                if (data.history) {
                    data.history.forEach(item => addClipboardItem(item.type, item.content, item.senderId));
                }
                lastHistoryJson = currentHistoryJson;
            }
        });
}

function addDevice(deviceName, os) {
    const li = document.createElement('li');
    li.textContent = `${deviceName} (${os})`;
    devicesList.appendChild(li);
}

function addClipboardItem(type, content, senderId) {
    const li = document.createElement('li');

    const timestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    li.textContent = `[${timestamp}] [${type}] from ${senderId}: ${content}`;
    clipboardHistory.appendChild(li);
}

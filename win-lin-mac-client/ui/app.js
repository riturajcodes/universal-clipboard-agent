const devicesList = document.getElementById('devicesList');
const clipboardHistory = document.getElementById('clipboardHistory');
const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
const roomIdInput = document.getElementById('roomId');
const loginScreen = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const currentRoomDisplay = document.getElementById('currentRoomDisplay');

// 1. Create Room (Calls Central Server directly)
createBtn.addEventListener('click', () => {
    fetch('http://localhost:3000/api/rooms/create', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
            roomIdInput.value = data.roomId;
        })
        .catch(err => alert('Failed to create room: ' + err));
});

// 2. Join Room (Calls Local Client to switch rooms)
joinBtn.addEventListener('click', () => {
    const roomId = roomIdInput.value.trim();
    if (!roomId) return alert('Enter a room ID');
    
    // Tell local server to join this room
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
    
    // Start polling for status
    setInterval(pollStatus, 2000);
    pollStatus();
}

let lastPeersJson = '';
let lastHistoryJson = '';

function pollStatus() {
    fetch('/api/status')
        .then(res => res.json())
        .then(data => {
            // Update devices list only if changed
            const currentPeersJson = JSON.stringify(data.peers);
            if (currentPeersJson !== lastPeersJson) {
                devicesList.innerHTML = '';
                if (data.peers) {
                    data.peers.forEach(peer => addDevice(peer, ''));
                }
                lastPeersJson = currentPeersJson;
            }

            // Update clipboard history only if changed
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

// Example: dynamically add devices / clipboard items
function addDevice(deviceName, os) {
    const li = document.createElement('li');
    li.textContent = `${deviceName} (${os})`;
    devicesList.appendChild(li);
}

function addClipboardItem(type, content, senderId) {
    const li = document.createElement('li');
    li.textContent = `[${type}] from ${senderId}: ${content}`;
    clipboardHistory.appendChild(li);
}

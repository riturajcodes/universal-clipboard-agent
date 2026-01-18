const devicesList = document.getElementById('devicesList');
const clipboardHistory = document.getElementById('clipboardHistory');
const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
const roomIdInput = document.getElementById('roomId');
const loginScreen = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const currentRoomDisplay = document.getElementById('currentRoomDisplay');

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

    li.innerHTML = `
    <span class="time">${time}</span>
    <span class="type">[${type}]</span>
    <span class="sender">from ${senderId}:</span>
    <span class="content">${content}</span>
`;

    clipboardHistory.appendChild(li);
}

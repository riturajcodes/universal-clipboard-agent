const { RTCPeerConnection } = require('wrtc');
const crypto = require('crypto');

function createPeerConnection(onData, isInitiator = false) {
    const pc = new RTCPeerConnection();

    let dataChannel;

    if (isInitiator) {
        dataChannel = pc.createDataChannel('clipboard');
        setupDataChannel(dataChannel, onData);
    } else {
        pc.ondatachannel = (event) => {
            dataChannel = event.channel;
            setupDataChannel(dataChannel, onData);
        };
    }

    return { pc, dataChannel };
}

function setupDataChannel(channel, onData) {
    channel.onopen = () => console.log('Data channel open');
    channel.onmessage = (event) => {
        try {
            const decrypted = JSON.parse(event.data); // decryption handled separately
            onData(decrypted);
        } catch (err) {
            console.error('Data channel message error', err);
        }
    };
}

module.exports = { createPeerConnection };

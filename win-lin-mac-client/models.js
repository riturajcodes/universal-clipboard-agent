// Clipboard item structure
class ClipboardItem {
    constructor(type, content, timestamp, senderId) {
        this.type = type;           // text / image / file
        this.content = content;     // string for text, base64 for image/file
        this.timestamp = timestamp; // Date.now()
        this.senderId = senderId;
    }
}

module.exports = { ClipboardItem };

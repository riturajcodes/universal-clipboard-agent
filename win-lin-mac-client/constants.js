// Shared constants
export const MESSAGE_TYPES = {
    JOIN: 'join',
    SIGNAL: 'signal',
    PEER_JOINED: 'peer-joined',
    PEER_LEFT: 'peer-left',
    EXISTING_PEERS: 'existing-peers',
    CLIPBOARD: 'clipboard',
    FILE_TRANSFER: 'file-transfer'
};

export const TRANSFER_ACTIONS = {
    START: 'start',
    CHUNK: 'chunk',
    END: 'end'
};

export const CLIPBOARD_TYPES = {
    TEXT: 'text',
    IMAGE: 'image',
    FILE: 'file'
};

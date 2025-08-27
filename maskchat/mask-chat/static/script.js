// static/script.js
// Client logic: join, connect, encrypt/decrypt, send/receive, typing, UI updates

(() => {
  // Elements
  const entryScreen = document.getElementById('entryScreen');
  const chatScreen = document.getElementById('chatScreen');
  const nameInput = document.getElementById('nameInput');
  const roomInput = document.getElementById('roomInput');
  const keyInput = document.getElementById('keyInput');
  const joinBtn = document.getElementById('joinBtn');
  const entryError = document.getElementById('entryError');

  const roomLabel = document.getElementById('roomLabel');
  const meLabel = document.getElementById('meLabel');
  const peerLabel = document.getElementById('peerLabel');
  const status = document.getElementById('status');
  const messagesBox = document.getElementById('messages');
  const typingIndicator = document.getElementById('typingIndicator');

  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');

  // State
  let socket = null;
  let name = '';
  let room = '';
  let secretKey = '';
  let demoMode = false;
  let typingTimeout = null;

  // Utilities
  function el(tag, cls) { const d = document.createElement(tag); if (cls) d.className = cls; return d; }

  function addSystem(text) {
    const wrap = el('div', 'text-center text-xs text-gray-600');
    wrap.textContent = text;
    messagesBox.appendChild(wrap);
    scrollToBottom();
  }

  function getTime() {
    const now = new Date();
    return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
  }

  function addMessage(text, who='me', ts=null) {
    const row = el('div', who === 'me' ? 'flex justify-end' : 'flex justify-start');
    const bubble = el('div', (who === 'me' ? 'bg-green-500 text-white' : 'bg-white text-gray-900') +
      ' px-3 py-2 rounded-lg shadow text-sm max-w-[72%] break-words');
    bubble.innerHTML = `<div class="whitespace-pre-wrap">${escapeHtml(text)}</div>
      <div class="text-[11px] opacity-70 text-right mt-1">${ts || getTime()}</div>`;
    row.appendChild(bubble);
    messagesBox.appendChild(row);
    scrollToBottom();
  }

  function escapeHtml(s) {
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function scrollToBottom() {
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }

  // Encryption helpers using CryptoJS (passphrase AES)
  function encrypt(plain) {
    try {
      return CryptoJS.AES.encrypt(plain, secretKey).toString();
    } catch (e) {
      return null;
    }
  }
  function decrypt(ciphertext) {
    try {
      const bytes = CryptoJS.AES.decrypt(ciphertext, secretKey);
      const txt = bytes.toString(CryptoJS.enc.Utf8);
      return txt || null;
    } catch (e) {
      return null;
    }
  }

  // UI state helpers
  function showEntry(errMsg) {
    entryScreen.classList.remove('hidden');
    chatScreen.classList.add('hidden');
    if (errMsg) {
      entryError.textContent = errMsg;
      entryError.classList.remove('hidden');
    } else {
      entryError.classList.add('hidden');
    }
  }

  function showChat() {
    entryScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    roomLabel.textContent = room;
    meLabel.textContent = `You: ${name}`;
    peerLabel.textContent = '';
    messageInput.focus();
  }

  // Connect to socket.io server with timeout fallback to demo mode
  function connectSocket() {
    // Create socket - will try same origin
    try {
      socket = io({transports: ['websocket','polling']});
    } catch (e) {
      socket = null;
      console.warn('Socket.io client init error', e);
    }

    if (!socket) {
      // fallback to demo mode
      enableDemoMode('No socket client available');
      return;
    }

    status.textContent = 'Connecting…';
    const connectTimer = setTimeout(() => {
      if (!socket.connected) {
        // server unreachable -> demo
        enableDemoMode('Server unreachable — demo mode');
        socket.close && socket.close();
      }
    }, 2500);

    // socket events
    socket.on('connect', () => {
      clearTimeout(connectTimer);
      status.textContent = 'Connected';
      addSystem('Connected to server');
      // join room on server
      socket.emit('join', { name, room });
    });

    socket.on('disconnect', () => {
      status.textContent = 'Disconnected';
      addSystem('Disconnected from server — demo mode');
      enableDemoMode('Disconnected — demo mode');
    });

    socket.on('message', (msg) => {
      // Expect: { sender, ciphertext, timestamp }
      if (!msg || !msg.ciphertext) return;
      const pt = decrypt(msg.ciphertext);
      if (pt === null) {
        addMessage('[Unable to decrypt: wrong key?]', 'other', msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : null);
      } else {
        addMessage(pt, msg.sender === name ? 'me' : 'other', msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : null);
      }
    });

    socket.on('typing', (d) => {
      typingIndicator.textContent = `${d.name} is typing…`;
      clearTimeout(typingTimeout);
      typingTimeout = setTimeout(() => typingIndicator.textContent = '', 1200);
    });

    socket.on('peer_joined', (d) => {
      peerLabel.textContent = d.name ? `Peer: ${d.name}` : '';
      addSystem(`${d.name} joined`);
    });

    socket.on('peer_left', (d) => {
      addSystem(`${d.name} left`);
      peerLabel.textContent = '';
    });

    // Optional: roster event if server emits roster
    socket.on('roster', (d) => {
      if (d && Array.isArray(d.users)) {
        peerLabel.textContent = d.users.filter(u => u !== name).join(', ') || '';
      }
    });
  }

  function enableDemoMode(reason) {
    demoMode = true;
    status.textContent = reason || 'Demo';
    addSystem('(Demo mode) Messages stay on this device only.');
    // keep local echo working
  }

  // Send handler
  function sendHandler() {
    const v = messageInput.value.trim();
    if (!v) return;
    // encrypt
    const ciphertext = encrypt(v);
    const ts = Date.now();
    // optimistic UI
    addMessage(v, 'me', new Date(ts).toLocaleTimeString());
    messageInput.value = '';
    // emit to server if connected
    if (socket && socket.connected && !demoMode) {
      socket.emit('message', { room, ciphertext, timestamp: ts });
    } else {
      // demo: simulate peer echo (for local testing)
      setTimeout(() => {
        // simulate other user reply (just echo)
        addMessage(v + ' (echo)', 'other', new Date().toLocaleTimeString());
      }, 600);
    }
  }

  // typing emitter
  function onTyping() {
    if (!socket || !socket.connected || demoMode) return;
    socket.emit('typing', { room, name });
  }

  // Event wiring
  joinBtn.addEventListener('click', () => {
    entryError.classList.add('hidden');
    name = nameInput.value.trim();
    room = roomInput.value.trim();
    secretKey = keyInput.value;

    if (!name || !room || !secretKey) {
      showEntry('Please enter name, room, and secret key.');
      return;
    }

    // Save in sessionStorage for refresh tolerance (optional)
    sessionStorage.setItem('maskchat:name', name);
    sessionStorage.setItem('maskchat:room', room);
    // Do NOT store secretKey permanently in real apps; we keep in sessionStorage for convenience
    sessionStorage.setItem('maskchat:key', secretKey);

    showChat();
    connectSocket();
  });

  // Allow pressing Enter on entry fields to start
  [nameInput, roomInput, keyInput].forEach(elm => {
    elm.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') joinBtn.click();
    });
  });

  // Send message events
  sendBtn.addEventListener('click', sendHandler);
  messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendHandler();
    }
  });
  messageInput.addEventListener('input', () => {
    if (messageInput.value.trim() !== '') {
      onTyping();
    }
  });

  // Restore state if page refresh
  window.addEventListener('load', () => {
    const savedName = sessionStorage.getItem('maskchat:name');
    const savedRoom = sessionStorage.getItem('maskchat:room');
    const savedKey = sessionStorage.getItem('maskchat:key');
    if (savedName) nameInput.value = savedName;
    if (savedRoom) roomInput.value = savedRoom;
    if (savedKey) keyInput.value = savedKey;
  });

})();

# app.py
# Mask Chat — simple private two-person chat
# Fixed for Python 3.12 (Eventlet-safe)

import os
import sys
import ssl
import logging

# --- Fix for Python 3.12 + Eventlet ---
os.environ['EVENTLET_NO_GREENDNS'] = 'yes'
if not hasattr(ssl, "wrap_socket"):
    ssl.wrap_socket = ssl.SSLContext.wrap_socket

import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template
import socketio

# ---------------- Logging ----------------
logging.basicConfig(level=logging.INFO, format="[%(levelname)s] %(message)s")
logger = logging.getLogger("mask-chat")

# ---------------- Socket.IO Setup ----------------
sio = socketio.Server(async_mode="eventlet", cors_allowed_origins="*")
app = Flask(__name__)
app.wsgi_app = socketio.WSGIApp(sio, app.wsgi_app)

# ---------------- Chat State ----------------
rooms = {}  # {room: set(sids)}

def get_other(sid, room):
    clients = rooms.get(room, set())
    return next((s for s in clients if s != sid), None)

# ---------------- Socket.IO Events ----------------
@sio.event
def connect(sid, environ):
    logger.info(f"🔌 Client connected: {sid}")

@sio.event
def join(sid, data):
    name = data.get("name")
    room = data.get("room")
    if not name or not room:
        logger.warning("⚠️ Join failed: missing name or room")
        return

    rooms.setdefault(room, set()).add(sid)
    sio.save_session(sid, {"name": name, "room": room})
    logger.info(f"👤 {name} joined room {room}")

    other = get_other(sid, room)
    if other:
        sio.emit("peer_joined", {"name": name}, room=other)
        sio.emit("online", {"name": name}, room=sid)

@sio.event
def typing(sid, data):
    session = sio.get_session(sid)
    room = session["room"]
    other = get_other(sid, room)
    if other:
        sio.emit("typing", {"name": session["name"]}, room=other)

@sio.event
def message(sid, data):
    session = sio.get_session(sid)
    room = session["room"]
    other = get_other(sid, room)
    if other:
        sio.emit(
            "message",
            {
                "sender": session["name"],
                "ciphertext": data["ciphertext"],
                "timestamp": data.get("timestamp"),
            },
            room=other,
        )

@sio.event
def disconnect(sid):
    session = sio.get_session(sid)
    name = session.get("name", "Unknown")
    room = session.get("room")

    if room in rooms:
        rooms[room].discard(sid)
        if not rooms[room]:
            del rooms[room]
            logger.info(f"🚪 Room {room} closed.")
        else:
            other = get_other(sid, room)
            if other:
                sio.emit("peer_left", {"name": name}, room=other)
    logger.info(f"🔌 Disconnected: {sid}")

# ---------------- Routes ----------------
@app.route("/")
def index():
    return render_template("index.html")

# ---------------- Run ----------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    logger.info(f"🚀 Running Mask Chat on http://127.0.0.1:{port}")
    eventlet.wsgi.server(eventlet.listen(("0.0.0.0", port)), app)

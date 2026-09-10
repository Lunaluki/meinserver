import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

// 📂 Modelle importieren
import Ticket from "./models/ticket.js"; 
import Blacklist from "./models/blacklist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// =========================================================
// 🌐 ZENTRALE KONFIGURATION (Direkt im Code hinterlegt)
// =========================================================
const MAILWATCHER = process.env.MAILWATCHER_URL || "https://transmit-shore-feedback-mean.trycloudflare.com";

// CORS komplett öffnen
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.options("*", cors());

// JSON-Limit erhöht (für Bilder / Base64)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Statische Dateien ausliefern (damit HTML-Seiten direkt greifen)
app.use(express.static(__dirname));

// 🔗 MongoDB Verbindung
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://Falkenauge:falkenauge@cluster0.doogtcl.mongodb.net/";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB erfolgreich verbunden"))
  .catch(err => console.error("❌ MongoDB Verbindungsfehler:", err));

// =========================================================
// 👤 USER / AUTH SCHEMA & ENDPUNKTE
// =========================================================
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model("User", userSchema);

app.get("/api/auth/check/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.json({ exists: false });
    }
    const user = await User.findById(id);
    res.json({ exists: !!user });
  } catch (err) {
    console.error("❌ Fehler beim Prüfen der User-ID:", err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

// ⚡ WebSocket Verbindung für Echtzeit-Admin-Updates
io.on("connection", (socket) => {
  console.log("⚡ Admin mit Dashboard verbunden:", socket.id);
  socket.on("disconnect", () => {
    console.log("🔌 Admin getrennt:", socket.id);
  });
});

// ---------------------------------------------------------
// 🌐 ROUTES
// ---------------------------------------------------------

// Admin Dashboard Seite ausliefern
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// =========================================================
// 🔐 AUTH ROUTES (REGISTER & LOGIN)
// =========================================================
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Benutzername und Passwort sind erforderlich!" });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: "Benutzername ist bereits vergeben!" });
    }

    const newUser = new User({ username, password });
    await newUser.save();

    console.log(`👤 Neuer User registriert: ${username} (ID: ${newUser._id})`);
    
    res.status(201).json({ 
      success: true, 
      userId: newUser._id, 
      token: "token_" + newUser._id, 
      username 
    });
  } catch (err) {
    console.error("❌ Fehler bei der Registrierung:", err);
    res.status(500).json({ error: "Serverfehler bei der Registrierung" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "Benutzername und Passwort erforderlich!" });
    }

    const user = await User.findOne({ username, password });
    if (!user) {
      return res.status(401).json({ error: "Ungültiger Benutzername oder falsches Passwort!" });
    }

    console.log(`🔑 User eingeloggt: ${username} (ID: ${user._id})`);
    res.json({ success: true, userId: user._id, token: "token_" + user._id, username });
  } catch (err) {
    console.error("❌ Fehler beim Login:", err);
    res.status(500).json({ error: "Serverfehler beim Login" });
  }
});

// =========================================================
// 🏴‍☠️ BLACKLIST ROUTES
// =========================================================

app.get("/api/blacklist", async (req, res) => {
  try {
    const entries = await Blacklist.find().sort({ createdAt: -1 });
    res.json(entries);
  } catch (err) {
    console.error("❌ Fehler beim Laden der Blacklist:", err);
    res.status(500).json({ error: "Fehler beim Laden aus der Datenbank" });
  }
});

app.post("/api/blacklist", async (req, res) => {
  try {
    const { number, reason, fan, imageUrl } = req.body;
    
    if (!number) {
      return res.status(400).json({ error: "Telefonnummer fehlt!" });
    }

    const newEntry = new Blacklist({
      number,
      reason: reason || "Kein Grund angegeben",
      fan: fan || "Unbekannt",
      screenshots: imageUrl ? [imageUrl] : []
    });

    const savedEntry = await newEntry.save();
    console.log(`🚨 Neue Nummer zur Blacklist hinzugefügt: ${number}`);
    
    io.emit("newBlacklistEntry", savedEntry);
    res.status(201).json({ success: true, savedEntry });
  } catch (err) {
    console.error("❌ Fehler beim Speichern in der Blacklist:", err);
    res.status(500).json({ error: "Fehler beim Speichern in der Datenbank" });
  }
});

// =========================================================
// 🎫 TICKET ROUTES
// =========================================================

app.get("/tickets", async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ date: -1 });
    res.json(tickets);
  } catch (err) {
    console.error("❌ Fehler beim Laden der Tickets:", err);
    res.status(500).json({ error: "Fehler beim Laden der Tickets" });
  }
});

// 🔍 Einzelnes Ticket per ID oder ticketId abrufen (Absolut robust gemacht)
app.get("/tickets/:id", async (req, res) => {
  try {
    let { id } = req.params;
    id = id ? id.trim() : "";

    const queryConditions = [
      { ticketId: id },
      { ticketId: { $regex: new RegExp(`^${id}$`, "i") } }
    ];

    if (mongoose.isValidObjectId(id)) {
      queryConditions.push({ _id: id });
    }

    const ticket = await Ticket.findOne({ $or: queryConditions });

    if (!ticket) {
      console.log(`⚠️ Ticket nicht gefunden für Abfrage: "${id}"`);
      return res.status(404).json({ error: "Ticket nicht gefunden" });
    }

    res.json(ticket);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen des Tickets:", err);
    res.status(500).json({ error: "Serverfehler beim Abrufen des Tickets" });
  }
});

app.post("/tickets/:id/:action", async (req, res) => {
  try {
    let { id, action } = req.params;
    id = id ? id.trim() : "";
    const newStatus = action === "close" ? "closed" : "open";
    
    const queryConditions = [
      { ticketId: id },
      { ticketId: { $regex: new RegExp(`^${id}$`, "i") } }
    ];
    if (mongoose.isValidObjectId(id)) {
      queryConditions.push({ _id: id });
    }

    const updatedTicket = await Ticket.findOneAndUpdate(
      { $or: queryConditions },
      { status: newStatus },
      { new: true }
    );

    if (!updatedTicket) {
      return res.status(404).json({ error: "Ticket nicht gefunden" });
    }

    if (newStatus === "closed" && MAILWATCHER && updatedTicket.from) {
      try {
        console.log(`🚀 Sende Ticket-Schließung an MailWatcher (${MAILWATCHER})...`);
        await fetch(`${MAILWATCHER}/ticket-closed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: updatedTicket.ticketId, email: updatedTicket.from })
        });
        console.log("✅ MailWatcher erfolgreich benachrichtigt!");
      } catch (mailErr) {
        console.error("⚠️ Konnte Mailwatcher nicht erreichen:", mailErr.message);
      }
    }

    io.emit("ticketUpdated", updatedTicket);
    res.json({ success: true, updatedTicket });
  } catch (err) {
    console.error("❌ Fehler beim Aktualisieren:", err);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

app.delete("/tickets/:id", async (req, res) => {
  try {
    let { id } = req.params;
    id = id ? id.trim() : "";

    const queryConditions = [
      { ticketId: id },
      { ticketId: { $regex: new RegExp(`^${id}$`, "i") } }
    ];
    if (mongoose.isValidObjectId(id)) {
      queryConditions.push({ _id: id });
    }

    await Ticket.findOneAndDelete({ $or: queryConditions });
    
    io.emit("ticketDeleted", id);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fehler beim Löschen:", err);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

app.post("/tickets", async (req, res) => {
  try {
    const { ticketId, from, subject, message, text, os, source, isWhatsapp, userAgent } = req.body;
    const newTicket = new Ticket({
      ticketId: ticketId || `LUNA-${Date.now()}`,
      from,
      subject: subject || "Luna Support Anfrage",
      message: message || text,
      text: text || message,
      os,
      source,
      isWhatsapp,
      userAgent
    });
    const savedTicket = await newTicket.save();

    console.log(`🎫 Neues Ticket erstellt: ${savedTicket.ticketId}`);
    io.emit("newTicket", savedTicket);
    res.status(201).json(savedTicket);
  } catch (err) {
    console.error("❌ Fehler beim Erstellen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Erstellen des Tickets" });
  }
});

// =========================================================
// RENDER SERVER START
// =========================================================
const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Luna Backend läuft erfolgreich auf Port ${PORT}`);
});

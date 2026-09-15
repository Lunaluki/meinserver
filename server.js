import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import ExifReader from "exifreader";

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
// 🌐 ZENTRALE KONFIGURATION
// =========================================================
const MAILWATCHER = process.env.MAILWATCHER_URL || "https://transmit-shore-feedback-mean.trycloudflare.com";
const BASE_URL = process.env.BASE_URL || "https://dsvgo.onrender.com";

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

// Statische Dateien ausliefern
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
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  password: { type: String, required: true },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
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

app.get("/", (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
        <meta charset="UTF-8">
        <title>Luna Bot Server</title>
        <style>
            body { background: #110515; color: #fff; font-family: Arial, sans-serif; text-align: center; padding-top: 10vh; }
            .box { background: #1e0924; border: 2px solid #ff4fae; display: inline-block; padding: 40px; border-radius: 12px; box-shadow: 0 0 20px rgba(255, 79, 174, 0.4); }
            h1 { color: #ff9dd6; margin-top: 0; }
            .status { color: #00ffaa; font-weight: bold; }
        </style>
    </head>
    <body>
        <div class="box">
            <h1>Luna Bot Backend</h1>
            <p>Status: <span class="status">ONLINE & Läuft perfekt! 🚀</span></p>
            <p>Hier läuft das Backend für Support-Tickets & Blacklist-System.</p>
            <p><a href="/admin" style="color: #ff4fae; text-decoration: none; font-weight: bold;">→ Zum Admin Dashboard</a></p>
        </div>
    </body>
    </html>
  `);
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// 🔐 PASSWORT-RESET-SEITEN
app.get("/passwortvergessen.html", (req, res) => {
  return res.status(403).send(`
    <!DOCTYPE html>
    <html lang="de">
    <head><meta charset="UTF-8"><title>Zugriff verweigert</title></head>
    <body style="background:#110515; color:#fff; font-family:Arial; text-align:center; padding-top:15vh;">
      <h1 style="color:#ff4fae;">Zugriff verweigert! 🛑</h1>
      <p>Diese Seite kann nur über den gültigen Reset-Link aus deiner E-Mail aufgerufen werden.</p>
      <p><a href="/" style="color:#00ffaa;">Zur Startseite</a></p>
    </body>
    </html>
  `);
});

app.get("/passwortvergessen.html/:token", async (req, res) => {
  const token = req.params.token;
  try {
    const user = await User.findOne({
      resetPasswordToken: token.trim(),
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="de">
        <head><meta charset="UTF-8"><title>Link ungültig</title></head>
        <body style="background:#110515; color:#fff; font-family:Arial; text-align:center; padding-top:15vh;">
          <h1 style="color:#ff4fae;">Link ungültig oder bereits abgelaufen! ⏳</h1>
          <p>Dieser Link wurde entweder schon benutzt oder ist älter als 1 Stunde.</p>
        </body>
        </html>
      `);
    }

    res.sendFile(path.join(__dirname, "passwortvergessen.html"));
  } catch (err) {
    console.error("❌ Fehler beim Prüfen des Tokens:", err);
    res.status(500).send("Serverfehler");
  }
});

// 🔐 AUTH ROUTES
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: "Benutzername, E-Mail und Passwort sind erforderlich!" });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(400).json({ error: "Benutzername oder E-Mail ist bereits vergeben!" });
    }

    const newUser = new User({ username, email, password });
    await newUser.save();

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
      return res.status(400).json({ error: "Benutzername/E-Mail und Passwort erforderlich!" });
    }

    const user = await User.findOne({
      $or: [
        { username: username.trim() },
        { email: username.trim().toLowerCase() }
      ],
      password
    });

    if (!user) {
      return res.status(401).json({ error: "Ungültige Anmeldedaten oder falsches Passwort!" });
    }

    res.json({ success: true, userId: user._id, token: "token_" + user._id, username: user.username });
  } catch (err) {
    console.error("❌ Fehler beim Login:", err);
    res.status(500).json({ error: "Serverfehler beim Login" });
  }
});

// 🔐 Feste PIN-Verifizierung (Ersetzt die Datenbank-Suche/E-Mail-Abhängigkeit)
app.post("/api/auth/verify-pin", async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ success: false, error: "Keine PIN angegeben!" });
    }

    // Standard-PIN ist "1234", kann über Render als Environment-Variable 'ADMIN_PIN' geändert werden
    const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

    if (pin.trim() !== ADMIN_PIN) {
      return res.status(401).json({ success: false, error: "Falsche PIN!" });
    }

    res.json({ 
      success: true, 
      token: "token_admin_fixed", 
      username: "Admin" 
    });
  } catch (err) {
    console.error("❌ Fehler bei der PIN-Verifizierung:", err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Bitte gib deinen Benutzernamen oder deine E-Mail ein!" });
    }

    const searchValue = email.trim();
    const user = await User.findOne({
      $or: [
        { username: searchValue },
        { email: searchValue.toLowerCase() }
      ]
    });

    if (!user) {
      return res.json({ success: true, message: "Falls das Konto existiert, wurde eine E-Mail gesendet." });
    }

    const token = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const resetLink = `${BASE_URL}/passwortvergessen.html/${encodeURIComponent(token)}`;

    if (MAILWATCHER) {
      try {
        await fetch(`${MAILWATCHER}/send-reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email, resetLink, username: user.username })
        });
      } catch (mailErr) {
        console.error("⚠️ Konnte MailWatcher für Reset-Mail nicht erreichen:", mailErr.message);
      }
    }

    res.json({ success: true, message: "Reset-Link wurde per E-Mail versendet!" });
  } catch (err) {
    console.error("❌ Fehler bei Passwort vergessen:", err);
    res.status(500).json({ error: "Serverfehler" });
  }
});

app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token?.trim() || !password?.trim()) {
      return res.status(400).json({ success: false, error: "Token und neues Passwort sind erforderlich!" });
    }

    const user = await User.findOne({
      resetPasswordToken: token.trim(),
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ success: false, error: "Der Link ist ungültig oder abgelaufen!" });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return res.json({ success: true, message: "Passwort erfolgreich geändert!" });
  } catch (err) {
    console.error("❌ Fehler beim Zurücksetzen:", err);
    return res.status(500).json({ success: false, error: "Serverfehler beim Zurücksetzen des Passworts." });
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
    const { number, reason, fan, image, imageUrl } = req.body;

    if (!number) {
      return res.status(400).json({ error: "Telefonnummer fehlt!" });
    }

    const finalImage = image || imageUrl;
    let exifInfo = {};

    if (finalImage) {
      try {
        const base64Data = finalImage.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, 'base64');
        const tags = ExifReader.load(buffer);

        exifInfo = {
          make: tags['Make']?.description || "",
          model: tags['Model']?.description || "",
          software: tags['Software']?.description || ""
        };
      } catch (exifErr) {}
    }

    const newEntry = new Blacklist({
      number,
      reason: reason || "Kein Grund angegeben",
      fan: fan || "Unbekannt",
      screenshots: finalImage ? [finalImage] : [],
      metadata: exifInfo
    });

    const savedEntry = await newEntry.save();
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
      return res.status(404).json({ error: "Ticket nicht gefunden" });
    }

    res.json(ticket);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen des Tickets:", err);
    res.status(500).json({ error: "Serverfehler beim Abrufen des Tickets" });
  }
});

// ⚡ NEU: Antwort per Mail versenden & Ticket schließen
app.post("/tickets/:id/reply", async (req, res) => {
  try {
    let { id } = req.params;
    const { email, message } = req.body;
    id = id ? id.trim() : "";

    const queryConditions = [
      { ticketId: id },
      { ticketId: { $regex: new RegExp(`^${id}$`, "i") } }
    ];
    if (mongoose.isValidObjectId(id)) {
      queryConditions.push({ _id: id });
    }

    // Status direkt auf geschlossen setzen
    const updatedTicket = await Ticket.findOneAndUpdate(
      { $or: queryConditions },
      { status: "closed" },
      { new: true }
    );

    if (!updatedTicket) {
      return res.status(404).json({ error: "Ticket nicht gefunden" });
    }

    // Mail via MailWatcher versenden falls eingerichtet
    if (MAILWATCHER) {
      try {
        await fetch(`${MAILWATCHER}/ticket-reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticketId: updatedTicket.ticketId,
            email: email || updatedTicket.from,
            message: message
          })
        });
      } catch (mailErr) {
        console.error("⚠️ Konnte MailWatcher für Ticket-Antwort nicht erreichen:", mailErr.message);
      }
    }

    io.emit("ticketUpdated", updatedTicket);
    res.json({ success: true, updatedTicket });
  } catch (err) {
    console.error("❌ Fehler beim Beantworten des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Senden der Antwort" });
  }
});

// Ticket Öffnen / Schließen
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
        await fetch(`${MAILWATCHER}/ticket-closed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: updatedTicket.ticketId, email: updatedTicket.from })
        });
      } catch (mailErr) {}
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
    const saved = await newTicket.save();

    io.emit("newTicket", saved);
    res.status(201).json(saved);
  } catch (err) {
    console.error("❌ Fehler beim Erstellen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Erstellen des Tickets" });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Luna Backend läuft erfolgreich auf Port ${PORT}`);
});

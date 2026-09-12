import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto"; // 🔐 Für sichere Reset-Tokens
import ExifReader from "exifreader"; // 📱 EXIF-Bibliothek für Handydaten

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
const BASE_URL = process.env.BASE_URL || "https://meinserver-u317.onrender.com";

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
            body {
                background: #110515;
                color: #fff;
                font-family: Arial, sans-serif;
                text-align: center;
                padding-top: 10vh;
            }
            .box {
                background: #1e0924;
                border: 2px solid #ff4fae;
                display: inline-block;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 0 20px rgba(255, 79, 174, 0.4);
            }
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

// =========================================================
// 🔐 PASSWORT-RESET-SEITE (Verhindert 404 durch Übersetzer-Tools)
// =========================================================

// GET: normale Passwort-Reset-Seite
app.get("/passwortvergessen.html", (req, res) => {
  res.sendFile(path.join(__dirname, "passwortvergessen.html"));
});

// POST: Fängt fehlerhafte POST-Aufrufe von Browser-Erweiterungen / Google Translate ab
app.post("/passwortvergessen.html", (req, res) => {
  const token = req.query.token || "";

  if (token) {
    return res.redirect(
      303,
      `/passwortvergessen.html?token=${encodeURIComponent(token)}`
    );
  }

  return res.redirect(303, "/passwortvergessen.html");
});

// HEAD sauber beantworten
app.head("/passwortvergessen.html", (req, res) => {
  res.sendStatus(200);
});

// =========================================================
// 🔐 AUTH ROUTES (REGISTER, LOGIN & PASSWORD RESET)
// =========================================================
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

    console.log(`👤 Neuer User registriert: ${username} (${email}) (ID: ${newUser._id})`);
    
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

    console.log(`🔑 User eingeloggt: ${user.username} (ID: ${user._id})`);
    res.json({ success: true, userId: user._id, token: "token_" + user._id, username: user.username });
  } catch (err) {
    console.error("❌ Fehler beim Login:", err);
    res.status(500).json({ error: "Serverfehler beim Login" });
  }
});

// 1️⃣ Passwort vergessen: Generiert Token und sendet Anfrage an den MailWatcher
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
    
    // Aus Sicherheitsgründen immer success zurückgeben
    if (!user) {
      return res.json({ success: true, message: "Falls das Konto existiert, wurde eine E-Mail gesendet." });
    }

    // Sicherer Einmal-Token
    const token = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 Stunde
    await user.save();

    // 🌐 Zuverlässiger Link über die BASE_URL
    const resetLink = `${BASE_URL}/passwortvergessen.html?token=${encodeURIComponent(token)}`;
    
    console.log(`🔗 PASSWORD RESET LINK für '${user.username}': ${resetLink}`);

    // An den lokalen MailWatcher senden, damit er die E-Mail rausschickt
    if (MAILWATCHER) {
      try {
        await fetch(`${MAILWATCHER}/send-reset`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: user.email, resetLink, username: user.username })
        });
        console.log("✅ MailWatcher erfolgreich mit Reset-Mail beauftragt!");
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

// 2️⃣ Neues Passwort speichern (Robuste API)
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body;

    if (
      typeof token !== "string" ||
      !token.trim() ||
      typeof password !== "string" ||
      !password.trim()
    ) {
      return res.status(400).json({
        success: false,
        error: "Token und neues Passwort sind erforderlich!"
      });
    }

    const cleanToken = token.trim();

    const user = await User.findOne({
      resetPasswordToken: cleanToken,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        error: "Der Link ist ungültig oder abgelaufen!"
      });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    console.log(`🔒 Passwort erfolgreich geändert für User: ${user.username}`);

    return res.json({
      success: true,
      message: "Passwort erfolgreich geändert!"
    });
  } catch (err) {
    console.error("❌ Fehler beim Zurücksetzen:", err);
    return res.status(500).json({
      success: false,
      error: "Serverfehler beim Zurücksetzen des Passworts."
    });
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
    const savedTicket = name => newTicket.save(); // wait, keep original newTicket.save() below:
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

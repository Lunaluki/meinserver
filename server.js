import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import Ticket from "./models/ticket.js";
import Blacklist from "./models/blacklist.js";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// 🔗 MailWatcher URL über Environment Variable oder Fallback
const MAILWATCHER = process.env.MAILWATCHER_URL || "https://masters-plants-mia-ten.trycloudflare.com";

// ---------------------------------------------------------
// 🗄️ MongoDB Verbindung
// ---------------------------------------------------------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ Mongo Fehler:", err));

// ---------------------------------------------------------
// 🛠️ Hilfsfunktionen
// ---------------------------------------------------------
function detectDeviceOS(req, providedOS) {
  if (providedOS && providedOS !== "Unbekannt") {
    return providedOS;
  }

  const userAgent = req.headers["user-agent"] || "";

  if (/android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Win/i.test(userAgent)) return "Windows";
  if (/Mac/i.test(userAgent)) return "Mac OS";
  if (/Linux/i.test(userAgent)) return "Linux";

  return "Web / PC";
}

function generateTicketId() {
  return "LUNA-" + Date.now();
}

function getTicketFilter(idParam) {
  if (mongoose.Types.ObjectId.isValid(idParam)) {
    return { $or: [{ ticketId: idParam }, { _id: idParam }] };
  }
  return { ticketId: idParam };
}

// ---------------------------------------------------------
// 👤 User Schema & Auth-Modell
// ---------------------------------------------------------
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const User = mongoose.model("User", userSchema);

// ---------------------------------------------------------
// 🔐 AUTH ROUTEN (Login, Register, Me)
// ---------------------------------------------------------

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: "Benutzername und Passwort erforderlich." });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: "Benutzername ist bereits vergeben." });
    }

    const newUser = new User({ username, password });
    await newUser.save();
    
    console.log(`👤 Neuer User registriert: ${username}`);
    res.status(201).json({ success: true, message: "Erfolgreich registriert" });
  } catch (err) {
    console.error("❌ Registrierungsfehler:", err);
    res.status(500).json({ error: "Fehler bei der Registrierung" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });

    if (!user) {
      return res.status(400).json({ error: "Falscher Benutzername oder Passwort." });
    }

    const token = user._id.toString();
    console.log(`🔑 User eingeloggt: ${username}`);
    
    res.json({ success: true, token, username: user.username });
  } catch (err) {
    console.error("❌ Login-Fehler:", err);
    res.status(500).json({ error: "Login fehlgeschlagen" });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || !mongoose.Types.ObjectId.isValid(token)) {
      return res.status(401).json({ error: "Nicht eingeloggt" });
    }

    const user = await User.findById(token);
    if (!user) {
      return res.status(404).json({ error: "User nicht gefunden" });
    }

    res.json({ success: true, data: { username: user.username } });
  } catch (err) {
    console.error("❌ Auth-Me Fehler:", err);
    res.status(500).json({ error: "Fehler beim Laden des Users" });
  }
});

// ---------------------------------------------------------
// 🌐 HTML Status-Seite
// ---------------------------------------------------------
app.get("/", (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Luna Support Backend</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background-color: #0f172a;
          color: #f8fafc;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 1rem;
        }
        .card {
          background: #1e293b;
          border: 1px solid #334155;
          padding: 2.5rem 2rem;
          border-radius: 1rem;
          box-shadow: 0 10px 25px rgba(0,0,0,0.4);
          text-align: center;
          max-width: 400px;
          width: 100%;
        }
        h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff; }
        p { color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.5rem; }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
          border: 1px solid rgba(52, 211, 153, 0.3);
          padding: 8px 18px;
          border-radius: 9999px;
          font-weight: 600;
          font-size: 0.9rem;
        }
        .dot {
          width: 10px;
          height: 10px;
          background: #10b981;
          border-radius: 50%;
          box-shadow: 0 0 8px #10b981;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Luna Backend API</h1>
        <p>Der Service ist erreichbar und betriebsbereit.</p>
        <div class="badge">
          <span class="dot"></span>
          <span>Server läuft</span>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ---------------------------------------------------------
// ➕ Ticket erstellen
// ---------------------------------------------------------
app.post("/tickets", async (req, res) => {
  try {
    const { from, email, text, message, subject, os, platform, source, isWhatsapp } = req.body;

    const senderEmail = from || email;
    const bodyText = text || message;

    if (!senderEmail || !bodyText) {
      return res.status(400).json({ error: "E-Mail und Nachrichtentext sind erforderlich." });
    }

    const detectedOS = detectDeviceOS(req, os || platform);
    const userAgentHeader = req.headers["user-agent"] || "Unbekannt";

    const newTicket = new Ticket({
      ticketId: generateTicketId(),
      from: senderEmail,
      text: bodyText,
      message: bodyText,
      subject: subject || "Luna Support Anfrage",
      status: "open",
      date: new Date(),
      os: detectedOS,
      source: source || (isWhatsapp ? "WhatsApp" : "Webformular"),
      isWhatsapp: Boolean(isWhatsapp),
      userAgent: userAgentHeader
    });

    await newTicket.save();
    console.log(`📩 Neues Ticket erstellt (${newTicket.ticketId}) - System: ${detectedOS}`);

    res.status(201).json({ success: true, ticket: newTicket });
  } catch (err) {
    console.error("❌ Fehler beim Erstellen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Erstellen des Tickets" });
  }
});

// ---------------------------------------------------------
// 📋 Alle Tickets abrufen
// ---------------------------------------------------------
app.get("/tickets", async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ date: -1 });
    res.json(tickets);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen der Tickets:", err);
    res.status(500).json({ error: "Fehler beim Abrufen der Tickets" });
  }
});

// ---------------------------------------------------------
// 📋 Einzelnes Ticket abrufen
// ---------------------------------------------------------
app.get("/tickets/:id", async (req, res) => {
  try {
    const filter = getTicketFilter(req.params.id);
    const ticket = await Ticket.findOne(filter);

    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });
    res.json(ticket);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Abrufen des Tickets" });
  }
});

// ---------------------------------------------------------
// 🟡 Ticket auf "processing" setzen
// ---------------------------------------------------------
app.post("/tickets/:id/processing", async (req, res) => {
  try {
    const filter = getTicketFilter(req.params.id);
    const ticket = await Ticket.findOneAndUpdate(
      filter, 
      { status: "processing" }, 
      { new: true }
    );

    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });

    res.json({ success: true, status: "processing" });
  } catch (err) {
    console.error("❌ Fehler beim Setzen des Bearbeitungsstatus:", err);
    res.status(500).json({ error: "Fehler beim Setzen des Bearbeitungsstatus" });
  }
});

// ---------------------------------------------------------
// 🔒 Ticket schließen
// ---------------------------------------------------------
app.post("/tickets/:id/close", async (req, res) => {
  try {
    const filter = getTicketFilter(req.params.id);
    const ticket = await Ticket.findOneAndUpdate(
      filter, 
      { status: "closed" }, 
      { new: true }
    );

    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });

    try {
      await fetch(`${MAILWATCHER}/ticket-closed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.ticketId,
          email: ticket.from
        })
      });

      console.log(`📨 Ticket geschlossen → MailWatcher informiert (${ticket.ticketId})`);
    } catch (err) {
      console.error("❌ Fehler beim Informieren des MailWatchers:", err.message);
    }

    res.json({ success: true, status: "closed" });
  } catch (err) {
    console.error("❌ Fehler beim Schließen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Schließen des Tickets" });
  }
});

// ---------------------------------------------------------
// 🔓 Ticket öffnen
// ---------------------------------------------------------
app.post("/tickets/:id/open", async (req, res) => {
  try {
    const filter = getTicketFilter(req.params.id);
    const ticket = await Ticket.findOneAndUpdate(
      filter, 
      { status: "open" }, 
      { new: true }
    );

    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });

    res.json({ success: true, status: "open" });
  } catch (err) {
    console.error("❌ Fehler beim Öffnen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Öffnen des Tickets" });
  }
});

// ---------------------------------------------------------
// 🗑️ Ticket löschen
// ---------------------------------------------------------
app.delete("/tickets/:id", async (req, res) => {
  try {
    const filter = getTicketFilter(req.params.id);
    const ticket = await Ticket.findOneAndDelete(filter);

    if (!ticket) {
      return res.status(404).json({ error: "Ticket nicht gefunden" });
    }

    console.log(`🗑️ Ticket gelöscht: ${req.params.id}`);
    res.json({ success: true, message: "Ticket erfolgreich gelöscht" });
  } catch (err) {
    console.error("❌ Fehler beim Löschen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Löschen des Tickets" });
  }
});

// ---------------------------------------------------------
// 📨 Admin-Antwort an Nutzer senden
// ---------------------------------------------------------
app.post("/tickets/:id/reply", async (req, res) => {
  const { email, text, message } = req.body;
  const replyText = text || message;

  if (!email || !replyText) {
    return res.status(400).json({ error: "Email oder Text fehlt" });
  }

  try {
    await fetch(`${MAILWATCHER}/admin-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, text: replyText })
    });

    console.log(`📨 Admin-Antwort gesendet → ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fehler beim Senden der Admin-Antwort:", err.message);
    res.status(500).json({ error: "MailWatcher Fehler" });
  }
});

// ---------------------------------------------------------
// 🚫 Blacklist Routen
// ---------------------------------------------------------
app.get("/api/blacklist", async (req, res) => {
  try {
    const list = await Blacklist.find().sort({ date: -1 });
    res.json(list);
  } catch (err) {
    console.error("❌ Fehler beim Laden der Blacklist:", err);
    res.status(500).json({ error: "Fehler beim Laden der Blacklist" });
  }
});

app.get("/api/blacklist/my", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token || !mongoose.Types.ObjectId.isValid(token)) {
      return res.status(401).json({ error: "Nicht eingeloggt" });
    }

    const user = await User.findById(token);
    if (!user) {
      return res.status(404).json({ error: "User nicht gefunden" });
    }

    const list = await Blacklist.find({ fan: user.username }).sort({ date: -1 });
    res.json(list);
  } catch (err) {
    console.error("❌ Fehler beim Laden der persönlichen Blacklist:", err);
    res.status(500).json({ error: "Fehler beim Laden deiner Liste" });
  }
});

app.post("/api/blacklist", async (req, res) => {
  try {
    const { fan, number, reason } = req.body;

    if (!fan || !number) {
      return res.status(400).json({ error: "Vorname und Nummer sind erforderlich." });
    }

    // --- DOPPELTER EINTRAG SCHUTZ ---
    const existingEntry = await Blacklist.findOne({ fan: fan, number: number });
    if (existingEntry) {
      return res.status(400).json({ error: "Du hast diese Nummer bereits gemeldet!" });
    }
    // ---------------------------------

    const newEntry = new Blacklist({
      fan,
      number,
      reason: reason || "Kein Grund angegeben"
    });

    await newEntry.save();
    console.log(`🚫 Neue Blacklist-Nummer gemeldet von ${fan}: ${number}`);

    res.status(201).json({ success: true, entry: newEntry });
  } catch (err) {
    console.error("❌ Fehler beim Speichern der Blacklist:", err);
    res.status(500).json({ error: "Fehler beim Speichern der Nummer" });
  }
});

// NEU: Blacklist-Eintrag löschen
app.delete("/api/blacklist/:id", async (req, res) => {
  try {
    const entry = await Blacklist.findByIdAndDelete(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: "Blacklist-Eintrag nicht gefunden" });
    }
    console.log(`🗑️ Blacklist-Nummer gelöscht: ${entry.number}`);
    res.json({ success: true, message: "Eintrag erfolgreich gelöscht" });
  } catch (err) {
    console.error("❌ Fehler beim Löschen des Blacklist-Eintrags:", err);
    res.status(500).json({ error: "Fehler beim Löschen" });
  }
});

// ---------------------------------------------------------
// ❤️ Healthcheck
// ---------------------------------------------------------
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ---------------------------------------------------------
// 🚀 Server starten
// ---------------------------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Luna Backend läuft auf Port ${PORT}`);
});

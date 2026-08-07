import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import Ticket from "./models/ticket.js";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// 🔗 MailWatcher URL über Environment Variable oder Fallback (z.B. Port 3002)
const MAILWATCHER = process.env.MAILWATCHER_URL || "https://little-replacement-bidder-academic.trycloudflare.com";

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

// ⭐ Hilfsfunktion: Sicheres Erstellen des MongoDB-Suchfilters
function getTicketFilter(idParam) {
  if (mongoose.Types.ObjectId.isValid(idParam)) {
    return { $or: [{ ticketId: idParam }, { _id: idParam }] };
  }
  return { ticketId: idParam };
}

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

    // MailWatcher informieren
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

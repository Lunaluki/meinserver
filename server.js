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

const MAILWATCHER = "https://philadelphia-graphical-controller-totally.trycloudflare.com";
// ---------------------------------------------------------
// 🗄️ MongoDB Verbindung
// ---------------------------------------------------------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ Mongo Fehler:", err));

// ---------------------------------------------------------
// 🎫 Ticket-ID Generator
// ---------------------------------------------------------
function generateTicketId() {
  return "LUNA-" + Date.now();
}

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
    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });
    res.json(ticket);
  } catch (err) {
    console.error("❌ Fehler beim Abrufen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Abrufen des Tickets" });
  }
});

// ---------------------------------------------------------
// 🟡 Ticket auf "processing" setzen (NEU)
// ---------------------------------------------------------
app.post("/tickets/:id/processing", async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });

    ticket.status = "processing";
    await ticket.save();

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
    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });

    ticket.status = "closed";
    await ticket.save();

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
    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });

    ticket.status = "open";
    await ticket.save();

    res.json({ success: true, status: "open" });
  } catch (err) {
    console.error("❌ Fehler beim Öffnen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Öffnen des Tickets" });
  }
});

// ---------------------------------------------------------
// 📨 Admin-Antwort an Nutzer senden
// ---------------------------------------------------------
app.post("/tickets/:id/reply", async (req, res) => {
  const { email, text } = req.body;

  if (!email || !text) {
    return res.status(400).json({ error: "Email oder Text fehlt" });
  }

  try {
    await fetch(`${MAILWATCHER}/admin-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, text })
    });

    console.log(`📨 Admin-Antwort gesendet → ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fehler beim Senden der Admin-Antwort:", err.message);
    res.status(500).json({ error: "MailWatcher Fehler" });
  }
});

// ---------------------------------------------------------
// ❤️ Healthcheck für Render
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

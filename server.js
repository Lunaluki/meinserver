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
// 🌐 ZENTRALE KONFIGURATION
// =========================================================
// Holt sich den Cloudflare-Link deines Mailwatchers aus den Render-Umgebungsvariablen
const MAILWATCHER = process.env.MAILWATCHER_URL || "";

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

// 🔗 MongoDB Verbindung
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://Falkenauge:falkenauge@cluster0.doogtcl.mongodb.net/";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB erfolgreich verbunden"))
  .catch(err => console.error("❌ MongoDB Verbindungsfehler:", err));

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
      reportedBy: fan || "Unbekannt",
      imageUrl: imageUrl || null
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

// Ticket Status ändern (Schließen / Öffnen) inkl. Mailwatcher-Benachrichtigung
app.post("/tickets/:id/:action", async (req, res) => {
  try {
    const { id, action } = req.params;
    const newStatus = action === "close" ? "closed" : "open";
    
    const updatedTicket = await Ticket.findOneAndUpdate(
      { $or: [{ ticketId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }] },
      { status: newStatus },
      { new: true }
    );

    if (!updatedTicket) {
      return res.status(404).json({ error: "Ticket nicht gefunden" });
    }

    // Wenn das Ticket geschlossen wird -> Mailwatcher Bescheid geben, damit er die Schließungs-Mail sendet
    if (newStatus === "closed" && MAILWATCHER && updatedTicket.from) {
      try {
        await fetch(`${MAILWATCHER}/ticket-closed`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: updatedTicket.ticketId, email: updatedTicket.from })
        });
        console.log(`🔒 Ticket-Schließen an Mailwatcher übergeben für: ${updatedTicket.from}`);
      } catch (mailErr) {
        console.error("⚠️ Konnte Mailwatcher nicht erreichen für Ticket-Schließung:", mailErr.message);
      }
    }

    io.emit("ticketUpdated", updatedTicket);
    res.json({ success: true, updatedTicket });
  } catch (err) {
    console.error("❌ Fehler beim Aktualisieren des Status:", err);
    res.status(500).json({ error: "Fehler beim Aktualisieren des Status" });
  }
});

app.patch("/tickets/:id/process", async (req, res) => {
  try {
    const { id } = req.params;
    
    const updatedTicket = await Ticket.findOneAndUpdate(
      { $or: [{ ticketId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }] },
      { status: "processing" },
      { new: true }
    );

    if (!updatedTicket) {
      return res.status(404).json({ error: "Ticket nicht gefunden" });
    }

    io.emit("ticketUpdated", updatedTicket);
    res.json({ success: true, updatedTicket });
  } catch (err) {
    console.error("❌ Fehler beim Setzen auf Processing:", err);
    res.status(500).json({ error: "Fehler beim Aktualisieren" });
  }
});

app.delete("/tickets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await Ticket.findOneAndDelete({ 
      $or: [{ ticketId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }] 
    });
    
    io.emit("ticketDeleted", id);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fehler beim Löschen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Löschen des Tickets" });
  }
});

// Admin-Antwort an den Mailwatcher weiterleiten
app.post("/admin-reply", async (req, res) => {
  const { email, text } = req.body;

  if (!email || !text) {
    return res.status(400).json({ error: "Email oder Text fehlt" });
  }

  if (!MAILWATCHER) {
    return res.status(500).json({ error: "MAILWATCHER_URL ist auf Render nicht konfiguriert" });
  }

  try {
    const response = await fetch(`${MAILWATCHER}/admin-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, text })
    });

    if (!response.ok) {
      throw new Error("MailWatcher hat einen Fehler gemeldet");
    }

    console.log(`📨 Admin-Antwort gesendet an → ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Fehler beim Senden der Admin-Antwort:", err.message);
    res.status(500).json({ error: "MailWatcher Fehler" });
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

    console.log(`🎫 Neues Ticket erstellt: ${savedTicket.ticketId} von ${from}`);
    io.emit("newTicket", savedTicket);
    res.status(201).json(savedTicket);
  } catch (err) {
    console.error("❌ Fehler beim Erstellen des Tickets:", err);
    res.status(500).json({ error: "Falsche Daten oder Fehler beim Erstellen des Tickets" });
  }
});

// =========================================================
// RENDER SERVER START (Mit dynamischem Port & '0.0.0.0')
// =========================================================
const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Luna Backend läuft erfolgreich auf Port ${PORT}`);
});

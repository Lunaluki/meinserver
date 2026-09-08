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

// JSON-Limit erhöht, falls mal ein Bild als Base64 hochgeladen wird
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

// 🔗 MongoDB Verbindung
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://Falkenauge:falkenauge@cluster0.doogtcl.mongodb.net/";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB erfolgreich verbunden"))
  .catch(err => console.error("❌ MongoDB Verbindungsfehler:", err));

// 🔗 MailWatcher URL mit Cloudflare-Link als Fallback
const MAILWATCHER = process.env.MAILWATCHER_URL || "https://newspapers-reservoir-grown-joseph.trycloudflare.com";

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
// 🏴‍☠️ BLACKLIST ROUTES (Inkl. Logging & Bild-Funktion)
// =========================================================

// 1. Alle Blacklist-Einträge abrufen
app.get("/api/blacklist", async (req, res) => {
  try {
    const entries = await Blacklist.find().sort({ createdAt: -1 });
    console.log(`📋 ${entries.length} Blacklist-Einträge aus MongoDB geladen.`);
    res.json(entries);
  } catch (err) {
    console.error("❌ Fehler beim Laden der Blacklist:", err);
    res.status(500).json({ error: "Fehler beim Laden aus der Datenbank" });
  }
});

// 2. Neue Nummer zur Blacklist hinzufügen (mit Bild-Unterstützung und Log)
app.post("/api/blacklist", async (req, res) => {
  try {
    const { number, reason, fan, imageUrl } = req.body;
    
    if (!number) {
      console.warn("⚠️ Blacklist-Versuch ohne Nummer abgelehnt.");
      return res.status(400).json({ error: "Telefonnummer fehlt!" });
    }

    const newEntry = new Blacklist({
      number,
      reason: reason || "Kein Grund angegeben",
      reportedBy: fan || "Unbekannt",
      imageUrl: imageUrl || null // Optionales Bild (URL oder Base64)
    });

    const savedEntry = await newEntry.save();
    console.log(`🚨 Neue Nummer zur Blacklist hinzugefügt: ${number} (Gemeldet von: ${savedEntry.reportedBy})`);
    
    // Optional: Über WebSockets direkt ans Dashboard senden, falls gewünscht
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

// 1. Alle Tickets abrufen
app.get("/tickets", async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ date: -1 });
    res.json(tickets);
  } catch (err) {
    console.error("❌ Fehler beim Laden der Tickets:", err);
    res.status(500).json({ error: "Fehler beim Laden der Tickets" });
  }
});

// 2. Ticket Status ändern (Schließen / Öffnen)
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

    io.emit("ticketUpdated", updatedTicket);
    res.json({ success: true, updatedTicket });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Aktualisieren des Status" });
  }
});

// 2.5 Ticket Status auf "processing" (In Bearbeitung) setzen
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

// 3. Ticket löschen
app.delete("/tickets/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await Ticket.findOneAndDelete({ 
      $or: [{ ticketId: id }, { _id: mongoose.isValidObjectId(id) ? id : null }] 
    });
    
    io.emit("ticketDeleted", id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Löschen des Tickets" });
  }
});

// 4. Admin Antwort an User senden
app.post("/admin-reply", async (req, res) => {
  const { email, text } = req.body;

  if (!email || !text) {
    return res.status(400).json({ error: "Email oder Text fehlt" });
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

// Ticket erstellen
app.post("/tickets", async (req, res) => {
  try {
    const { ticketId, from, subject, message, text, os, source, isWhatsapp, userAgent } = req.body;
    const newTicket = new Ticket({
      ticketId: ticketId || `TID-${Date.now()}`,
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
    res.status(500).json({ error: "Fehler beim Erstellen des Tickets" });
  }
});

// Server starten
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Luna Backend läuft auf Port ${PORT}`);
});

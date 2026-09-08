import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());

// 🔗 MongoDB Verbindung
const MONGO_URI = process.env.MONGO_URI || "DEINE_MONGODB_CONNECTION_STRING";

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB erfolgreich verbunden"))
  .catch(err => console.error("❌ MongoDB Verbindungsfehler:", err));

// 📄 Blacklist Schema
const blacklistSchema = new mongoose.Schema({
  fan: { type: String, required: true },
  number: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reason: { type: String, default: "Kein Grund angegeben" },
  count: { type: Number, default: 1 },
  reporters: { type: [String], default: [] },
  screenshots: { type: [String], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const Blacklist = mongoose.models.Blacklist || mongoose.model("Blacklist", blacklistSchema);

// 📄 Ticket Schema
const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  from: { type: String, required: true },
  subject: { type: String, default: "Luna Support Anfrage" },
  text: { type: String, required: true },
  status: { type: String, default: "open" }, // "open" oder "closed"
  date: { type: Date, default: Date.now }
});
const Ticket = mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);

// 🔗 MailWatcher URL mit deinem Cloudflare-Link als Fallback
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

// 1. Alle Tickets abrufen
app.get("/tickets", async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ date: -1 });
    res.json(tickets);
  } catch (err) {
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

    // Sofort via WebSocket an alle offenen Admin-Dashboards senden!
    io.emit("ticketUpdated", updatedTicket);
    res.json({ success: true, updatedTicket });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Aktualisieren des Status" });
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

// Beispiel-Route zum Erstellen eines Tickets
app.post("/tickets", async (req, res) => {
  try {
    const { ticketId, from, subject, text } = req.body;
    const newTicket = new Ticket({
      ticketId: ticketId || `TID-${Date.now()}`,
      from,
      subject,
      text
    });
    const savedTicket = await newTicket.save();

    // ⚡ Direkt an alle verbundenen Admins streamen!
    io.emit("newTicket", savedTicket);

    res.status(201).json(savedTicket);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Erstellen des Tickets" });
  }
});

// Server starten
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Luna Backend läuft auf Port ${PORT}`);
});

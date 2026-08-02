import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import Ticket from "./models/ticket.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

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
// 🔒 Ticket schließen
// ---------------------------------------------------------
app.post("/tickets/:id/close", async (req, res) => {
  try {
    const ticket = await Ticket.findOne({ ticketId: req.params.id });
    if (!ticket) return res.status(404).json({ error: "Ticket nicht gefunden" });

    ticket.status = "closed";
    await ticket.save();

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

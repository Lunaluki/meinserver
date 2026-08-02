import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import Ticket from "./models/ticket.js";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ---------------------------------------------------------
// 🌙 Luna Logging – schön & übersichtlich
// ---------------------------------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  const time = new Date().toLocaleTimeString("de-DE");

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📥 [${time}] Anfrage: ${req.method} ${req.path}`);

  if (Object.keys(req.body).length > 0) {
    console.log(`   📦 Body:`, JSON.stringify(req.body, null, 2));
  }

  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const ms = Date.now() - start;
    const end = new Date().toLocaleTimeString("de-DE");

    console.log(`📤 [${end}] Antwort (${ms}ms): Status ${res.statusCode}`);
    console.log(`   🔁 Daten:`, JSON.stringify(data, null, 2));
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    return originalJson(data);
  };

  next();
});

// ---------------------------------------------------------
// 🗄️ MongoDB Verbindung
// ---------------------------------------------------------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB verbunden"))
  .catch(err => console.error("❌ Mongo Fehler:", err));

// ---------------------------------------------------------
// 📧 Nodemailer – Gmail Login
// ---------------------------------------------------------
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

transporter.verify((err) => {
  if (err) {
    console.error("❌ Gmail Login fehlgeschlagen:", err.message);
  } else {
    console.log("✅ Gmail bereit – Mailversand aktiv");
  }
});

// ---------------------------------------------------------
// 🎫 Ticket-ID Generator
// ---------------------------------------------------------
function generateTicketId() {
  return "LUNA-" + Date.now();
}

// ---------------------------------------------------------
// 📨 Testmail
// ---------------------------------------------------------
app.get("/testmail", async (req, res) => {
  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.GMAIL_USER,
      subject: "Luna Testmail",
      text: `Hallo,

dies ist eine automatische Testmail des Luna Support Systems.

✯ 『𝗟𝘂𝗻𝗮 𝗧𝗲𝗮𝗺』 ✯`
    });

    res.json({ success: true, message: "Testmail gesendet!" });
  } catch (err) {
    res.status(500).json({ error: "Mail Fehler" });
  }
});


// ---------------------------------------------------------
// 📋 Alle Tickets abrufen (Admin Panel)
// ---------------------------------------------------------
app.get("/tickets", async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ date: -1 });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Abrufen der Tickets" });
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
    res.status(500).json({ error: "Fehler beim Öffnen des Tickets" });
  }
});


// ---------------------------------------------------------
// 📝 Ticket erstellen (Admin Panel / API)
// ---------------------------------------------------------
app.post("/tickets", async (req, res) => {
  try {
    const ticketId = generateTicketId();

    const ticket = new Ticket({
      ticketId,
      from: req.body.from,
      subject: req.body.subject,
      message: req.body.message,
      status: "open",
      date: new Date()
    });

    await ticket.save();

    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: req.body.from,
      subject: `Ticket erhalten: ${req.body.subject}`,
      text: `Hallo,

wir haben dein Ticket erfolgreich erhalten.
Deine Ticket-ID lautet: ${ticketId}

Status: offen (in Bearbeitung)

✯ 『𝗟𝘂𝗻𝗮 𝗧𝗲𝗮𝗺』 ✯`
    });

    res.json({ success: true, ticketId });
  } catch (err) {
    res.status(500).json({ error: "Fehler beim Erstellen des Tickets" });
  }
});

// ---------------------------------------------------------
// 📬 IMAP Gmail Überwachung → nur Betreff "lunasupport"
// ---------------------------------------------------------

const GESUCHTER_BETREFF = "lunasupport";  // <<< NUR dieser Betreff wird erfasst

const imapClient = new ImapFlow({
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

async function startMailWatcher() {
  try {
    await imapClient.connect();
    const mailbox = await imapClient.mailboxOpen("INBOX");

    console.log("📡 Gmail Überwachung aktiv… (Filter: Betreff = lunasupport)");

    while (true) {
      await imapClient.idle();

      const messages = await imapClient.fetch(`${mailbox.exists}:*`, {
        uid: true,
        envelope: true,
        source: true,
      });

      for await (const msg of messages) {
        const mail = await simpleParser(msg.source);

        const betreff = (mail.subject || "").toLowerCase();
        const absender = mail.from.value[0].address;
        const text = mail.text || "";

        console.log(`📥 Neue Mail von ${absender}`);
        console.log(`   🏷️ Betreff: ${betreff}`);

        // ---------------------------------------------------------
        // ❌ Betreff passt NICHT → ignorieren
        // ---------------------------------------------------------
        if (betreff !== GESUCHTER_BETREFF) {
          console.log("   ❌ Betreff ignoriert (nicht lunasupport)");
          continue;
        }

        // ---------------------------------------------------------
        // ✔ Betreff passt → Ticket erstellen
        // ---------------------------------------------------------
        const ticketId = generateTicketId();

        const ticket = new Ticket({
          ticketId,
          from: absender,
          subject: betreff,
          message: text,
          status: "open",
          date: new Date()
        });

        await ticket.save();
        console.log(`   💾 Ticket erstellt → ${ticketId}`);

        // ---------------------------------------------------------
        // ✔ Automatische Antwort
        // ---------------------------------------------------------
        await transporter.sendMail({
          from: process.env.GMAIL_USER,
          to: absender,
          subject: `Ticket erhalten: ${ticketId}`,
          text: `Hallo,

wir haben deine Nachricht erhalten.
Deine Ticket-ID lautet: ${ticketId}

Status: offen (in Bearbeitung)

✯ 『𝗟𝘂𝗻𝗮 𝗧𝗲𝗮𝗺』 ✯`
        });

        console.log("   📨 Automatische Antwort gesendet.");
      }
    }
  } catch (err) {
    console.error("❌ Fehler im MailWatcher:", err);
  }
}

startMailWatcher();


// ---------------------------------------------------------
// 🚀 Server starten
// ---------------------------------------------------------
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Luna Backend läuft auf Port ${PORT}`);
});

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
    console.error("❌ Testmail Fehler:", err);
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
    console.error("❌ Fehler beim Abrufen der Tickets:", err);
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
    console.error("❌ Fehler beim Schließen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Schließen des Tickets" });
  }
});

// ---------------------------------------------------------
// ❤️ Healthcheck für Railway
// ---------------------------------------------------------
app.get("/health", (req, res) => {
  res.status(200).send("OK");
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
    console.error("❌ Fehler beim Erstellen des Tickets:", err);
    res.status(500).json({ error: "Fehler beim Erstellen des Tickets" });
  }
});

// ---------------------------------------------------------
// 📬 IMAP Gmail Überwachung → nur Betreff "lunasupport"
// ---------------------------------------------------------
const GESUCHTER_BETREFF = "lunasupport";

let imapClient = null;

if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
  imapClient = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  imapClient.on("error", (err) => {
    console.error("❌ IMAP Fehler:", err.message);
  });

  imapClient.on("close", () => {
    console.error("❌ IMAP Verbindung geschlossen");
  });
} else {
  console.warn("⚠️ IMAP deaktiviert: GMAIL_USER oder GMAIL_PASS fehlen");
}

async function startMailWatcher() {
  if (!imapClient) {
    console.warn("⚠️ MailWatcher nicht gestartet: kein IMAP-Client vorhanden");
    return;
  }

  try {
    await imapClient.connect();
    await imapClient.mailboxOpen("INBOX");

    console.log("📡 Gmail Überwachung aktiv…");

    imapClient.on("exists", async () => {
      console.log("📨 Neue Mail erkannt!");

      const lock = await imapClient.getMailboxLock("INBOX");

      try {
        const message = await imapClient.fetchOne(
          imapClient.mailbox.exists,
          { source: true, envelope: true }
        );

        const mail = await simpleParser(message.source);

        const betreff = (mail.subject || "").toLowerCase();
        const absender = mail.from?.value?.[0]?.address || "";
        const text = mail.text || "";

        console.log(`📥 Neue Mail von ${absender}`);
        console.log(`   🏷️ Betreff: ${betreff}`);

        if (betreff !== GESUCHTER_BETREFF) {
          console.log("   ❌ Betreff ignoriert (nicht lunasupport)");
          return;
        }

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
      } catch (err) {
        console.error("❌ Fehler beim Verarbeiten der Mail:", err);
      } finally {
        lock.release();
      }
    });

    // Nicht-blockierende Idle-Schleife
    async function idleLoop() {
      try {
        await imapClient.idle();
      } catch (err) {
        console.error("❌ Idle Fehler:", err.message);
      } finally {
        setTimeout(idleLoop, 2000);
      }
    }

    idleLoop();

  } catch (err) {
    console.error("❌ Fehler im MailWatcher:", err);
  }
}

// ---------------------------------------------------------
// 🚀 Server starten
// ---------------------------------------------------------
const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`🚀 Luna Backend läuft auf Port ${PORT}`);

  startMailWatcher();
});

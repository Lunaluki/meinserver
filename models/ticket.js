import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  from: { type: String, required: true },
  subject: { type: String, required: true, default: "Luna Support Anfrage" },
  message: { type: String },
  text: { type: String }, // Zusätzliches Textfeld zur Kompatibilität mit server.js
  date: { type: Date, default: Date.now },

  status: { 
    type: String, 
    enum: ["open", "processing", "closed"], 
    default: "open" 
  },

  // 📱 Neue Datenfelder (Android, iOS, WhatsApp, Browser)
  os: { type: String, default: "Unbekannt" },
  source: { type: String, default: "Webformular" },
  isWhatsapp: { type: Boolean, default: false },
  userAgent: { type: String, default: "Unbekannt" }
});

export default mongoose.models.Ticket || mongoose.model("Ticket", ticketSchema);

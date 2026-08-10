import mongoose from "mongoose";

const blacklistSchema = new mongoose.Schema({
  fan: { type: String, required: true },
  number: { type: String, required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Verknüpfung zum echten Account
  reason: { type: String, default: "Kein Grund angegeben" },
  count: { type: Number, default: 1 }, // Zähler für Mehrfach-Meldungen
  reporters: { type: [String], default: [] }, // Schutz vor doppelten Meldungen
  screenshots: { type: [String], default: [] }, // 📸 NEU: Speichert die Bild-Pfade/URLs
  createdAt: { type: Date, default: Date.now }
});

export default mongoose.models.Blacklist || mongoose.model("Blacklist", blacklistSchema);

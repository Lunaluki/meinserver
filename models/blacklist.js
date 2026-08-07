import mongoose from "mongoose";

const blacklistSchema = new mongoose.Schema({
  fan: { type: String, required: true },
  number: { type: String, required: true },
  reason: { type: String, default: "Kein Grund angegeben" },
  date: { type: Date, default: Date.now }
});

export default mongoose.models.Blacklist || mongoose.model("Blacklist", blacklistSchema);

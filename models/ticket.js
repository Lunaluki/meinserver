import mongoose from "mongoose";

const ticketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  from: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  date: { type: Date, default: Date.now },

  status: { 
    type: String, 
    enum: ["open", "processing", "closed"], 
    default: "open" 
  }
});

export default mongoose.model("Ticket", ticketSchema);

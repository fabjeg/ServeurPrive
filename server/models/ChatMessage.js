// Mémoire de conversation Jarvis — un document par message (pas un blob qui
// grossit), même granularité que Repair. Pro-only côté assistant (voir
// server/routes/chat.js), mais `space` reste explicite en défense en
// profondeur, comme partout ailleurs.
import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    ownerId: { type: String, required: true, index: true },
    space: { type: String, enum: ["pro", "perso"], required: true, default: "pro" },
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

chatMessageSchema.index({ ownerId: 1, space: 1, createdAt: 1 });

chatMessageSchema.methods.toClient = function toClient() {
  return { role: this.role, text: this.text, createdAt: this.createdAt };
};

export const ChatMessage =
  mongoose.models.ChatMessage || mongoose.model("ChatMessage", chatMessageSchema);

import express from "express";
import path from "path";
import cors from "cors";
import { CONFIG } from "./config/config";
import authRoutes from "./routes/authRoutes";
import donorRoutes from "./routes/donorRoutes";
import hospitalRoutes from "./routes/hospitalRoutes";
import campRoutes from "./routes/campRoutes";
import emergencyRoutes from "./routes/emergencyRoutes";
import notificationRoutes from "./routes/notificationRoutes";
import mlRoutes from "./routes/mlRoutes";
import chatRoutes from "./routes/chatRoutes";
import smsRoutes from "./routes/smsRoutes";
import statsRoutes from "./routes/statsRoutes";
import { createServer as createViteServer } from "vite";

const app = express();

// Parse CORS options safely 
app.use(cors({
  origin: CONFIG.FRONTEND_URL ? [CONFIG.FRONTEND_URL, "http://localhost:3000", "http://localhost:5173"] : "*",
  credentials: true
}));

app.use(express.json());

// 1. Health diagnostic route
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    environment: CONFIG.NODE_ENV,
    mongoConnected: !!process.env.MONGO_URI
  });
});

// 2. Central API route groups
app.use("/api/auth", authRoutes);
app.use("/api/donors", donorRoutes);
app.use("/api/hospitals", hospitalRoutes);
app.use("/api/camps", campRoutes);
app.use("/api/emergencies", emergencyRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/ml", mlRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/stats", statsRoutes);

// 3. Asset serving & Vite system integration
async function integrateVite() {
  if (CONFIG.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(CONFIG.PORT, "0.0.0.0", () => {
    console.log(`BloodRadar full-stack server running successfully on port ${CONFIG.PORT}`);
  });
}

integrateVite().catch((error) => {
  console.error("Vite integration crash on server boot:", error);
});

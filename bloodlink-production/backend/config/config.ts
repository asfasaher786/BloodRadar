import dotenv from "dotenv";
import path from "path";

// Load env variables
dotenv.config();

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  NODE_ENV: process.env.NODE_ENV || "development",
  MONGO_URI: process.env.MONGO_URI || "",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",
  FRONTEND_URL: process.env.FRONTEND_URL || "",
  BACKEND_URL: process.env.BACKEND_URL || "",
};

// Unified Client API Base Endpoint Configuration
// Supports integrated full-stack deployment and decoupled multi-platform deployments (Vercel + Render)
export const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

"""
SHAKTI AI Services — FastAPI Application
Handles LLM-based chatbot queries, file classification ML, and analytics.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config import settings
from app.routers import health, chatbot
from app.services.db import database


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Startup
    await database.connect()
    print(f"\n  SHAKTI AI Services v2.0")
    print(f"  Port: {settings.AI_SERVICE_PORT}")
    print(f"  Ollama: {settings.OLLAMA_BASE_URL}")
    print(f"  Model: {settings.OLLAMA_MODEL}\n")
    yield
    # Shutdown
    await database.disconnect()


app = FastAPI(
    title="SHAKTI AI Services",
    description="AI-powered investigation assistant for the SHAKTI platform",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS — Allow frontend and backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(health.router, prefix="/ai", tags=["Health"])
app.include_router(chatbot.router, prefix="/ai", tags=["Chatbot"])


@app.get("/")
async def root():
    return {
        "service": "SHAKTI AI Services",
        "version": "2.0.0",
        "status": "running",
    }

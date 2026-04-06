"""
Health check endpoints for SHAKTI AI Services.
"""

from fastapi import APIRouter
import httpx

from app.config import settings
from app.services.db import database

router = APIRouter()


@router.get("/health")
async def health_check():
    """Check service health, Ollama connectivity, and database status."""
    status = {
        "service": "shakti-ai-services",
        "status": "healthy",
        "checks": {},
    }

    # Check Ollama
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")
            if resp.status_code == 200:
                models = resp.json().get("models", [])
                model_names = [m.get("name", "") for m in models]
                status["checks"]["ollama"] = {
                    "connected": True,
                    "models": model_names,
                    "target_model": settings.OLLAMA_MODEL,
                    "model_available": any(settings.OLLAMA_MODEL in n for n in model_names),
                }
            else:
                status["checks"]["ollama"] = {"connected": False, "error": f"HTTP {resp.status_code}"}
                status["status"] = "degraded"
    except Exception as e:
        status["checks"]["ollama"] = {"connected": False, "error": str(e)}
        status["status"] = "degraded"

    # Check Database
    try:
        is_connected = await database.check_connection()
        status["checks"]["database"] = {"connected": is_connected}
        if not is_connected:
            status["status"] = "degraded"
    except Exception as e:
        status["checks"]["database"] = {"connected": False, "error": str(e)}
        status["status"] = "degraded"

    return status

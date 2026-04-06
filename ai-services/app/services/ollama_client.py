"""
Ollama HTTP client for LLM inference.
Communicates with the local Ollama runtime.
"""

import httpx
from app.config import settings


class OllamaClient:
    """Async client for Ollama API."""

    def __init__(self):
        self.base_url = settings.OLLAMA_BASE_URL
        self.timeout = settings.OLLAMA_TIMEOUT / 1000  # Convert ms to seconds

    async def generate(self, prompt: str, system: str = "", model: str = None) -> dict:
        """
        Generate a response from Ollama.

        Args:
            prompt: The user's message
            system: System prompt for context
            model: Model to use (defaults to settings)

        Returns:
            dict with 'response', 'model', 'eval_count', etc.
        """
        model = model or settings.OLLAMA_MODEL

        payload = {
            "model": model,
            "prompt": prompt,
            "system": system,
            "stream": False,
            "options": {
                "temperature": 0.3,  # Lower temperature for factual responses
                "top_p": 0.9,
                "num_predict": 2048,
            },
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/generate",
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def chat(self, messages: list, model: str = None) -> dict:
        """
        Chat-style interaction with Ollama.

        Args:
            messages: List of {role, content} message dicts
            model: Model to use

        Returns:
            dict with response
        """
        model = model or settings.OLLAMA_MODEL

        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "top_p": 0.9,
                "num_predict": 2048,
            },
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def list_models(self) -> list:
        """List available models on Ollama."""
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            return data.get("models", [])

    async def is_available(self) -> bool:
        """Check if Ollama is running and reachable."""
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception:
            return False

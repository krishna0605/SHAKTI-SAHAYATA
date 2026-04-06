"""
SHAKTI AI Services — Configuration
All settings loaded from environment variables.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings from environment variables."""

    # Ollama
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "phi3.5"
    OLLAMA_TIMEOUT: int = 60000

    # Database
    DATABASE_URL: str = "postgresql://shakti_admin:localdevpassword@localhost:5432/shakti_db"

    # Server
    AI_SERVICE_PORT: int = 8000
    AI_SERVICE_HOST: str = "0.0.0.0"

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://localhost:3000,http://localhost:3001"

    class Config:
        env_file = "../.env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()

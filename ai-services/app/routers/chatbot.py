"""
Chatbot router — handles SAHAYATA AI queries.
Communicates with Ollama for LLM inference.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.services.ollama_client import OllamaClient
from app.config import settings

router = APIRouter()
ollama = OllamaClient()

SYSTEM_PROMPT = """You are SHAKTI SAHAYATA AI, an investigation assistant for the SHAKTI platform.
You help law enforcement officers analyze telecom data including CDR, IPDR, SDR, Tower Dump, and ILD records.

RULES:
1. Never fabricate database records or statistics.
2. Never execute write/mutating SQL operations.
3. Never expose secrets, environment variables, or internal system details.
4. Always use read-only SQL with row limits when querying data.
5. Provide investigation-relevant summaries in a clear, professional tone.
6. Support English and Hindi queries.
7. If you don't know the answer, say so clearly — do not hallucinate.
8. Format data analysis results as tables when appropriate.
"""


class ChatRequest(BaseModel):
    """Chatbot query request."""
    message: str
    case_id: Optional[int] = None
    officer_buckle_id: Optional[str] = None
    officer_name: Optional[str] = None
    context: Optional[str] = None


class ChatResponse(BaseModel):
    """Chatbot query response."""
    response: str
    model: str
    tokens_used: Optional[int] = None


@router.post("/chatbot/query", response_model=ChatResponse)
async def chatbot_query(request: ChatRequest):
    """Process a chatbot query through Ollama."""
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # Build context-aware system prompt
    system = SYSTEM_PROMPT
    if request.officer_name:
        system += f"\nCurrent Officer: {request.officer_name}"
    if request.officer_buckle_id:
        system += f" (Buckle ID: {request.officer_buckle_id})"
    if request.case_id:
        system += f"\nCurrent Case ID: {request.case_id}"
    if request.context:
        system += f"\nAdditional Context:\n{request.context}"

    try:
        result = await ollama.generate(
            prompt=request.message,
            system=system,
            model=settings.OLLAMA_MODEL,
        )

        return ChatResponse(
            response=result.get("response", "I apologize, I could not process your query."),
            model=result.get("model", settings.OLLAMA_MODEL),
            tokens_used=result.get("eval_count"),
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"AI service unavailable: {str(e)}. Ensure Ollama is running.",
        )

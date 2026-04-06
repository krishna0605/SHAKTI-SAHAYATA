"""
Database service for SHAKTI AI Services.
Async PostgreSQL connection using psycopg2 (sync wrapper for simplicity).
"""

import psycopg2
from psycopg2.extras import RealDictCursor
from app.config import settings


class Database:
    """PostgreSQL database connection manager."""

    def __init__(self):
        self.conn = None
        self.dsn = settings.DATABASE_URL

    async def connect(self):
        """Establish database connection."""
        try:
            self.conn = psycopg2.connect(self.dsn)
            self.conn.autocommit = True
            print(f"[AI-DB] Connected to PostgreSQL")
        except Exception as e:
            print(f"[AI-DB] Connection failed: {e}")
            self.conn = None

    async def disconnect(self):
        """Close database connection."""
        if self.conn:
            self.conn.close()
            print("[AI-DB] Disconnected from PostgreSQL")

    async def check_connection(self) -> bool:
        """Check if database connection is alive."""
        if not self.conn:
            return False
        try:
            cur = self.conn.cursor()
            cur.execute("SELECT 1")
            cur.close()
            return True
        except Exception:
            # Try to reconnect
            try:
                await self.connect()
                return self.conn is not None
            except Exception:
                return False

    def execute_readonly(self, query: str, params: tuple = None) -> list:
        """
        Execute a read-only query and return results as list of dicts.
        SAFETY: Only SELECT queries are allowed.
        """
        if not self.conn:
            raise ConnectionError("Database not connected")

        # Safety check — only allow SELECT
        normalized = query.strip().upper()
        if not normalized.startswith("SELECT"):
            raise ValueError("Only SELECT queries are allowed for AI services")

        # Additional safety checks
        forbidden = ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE", "TRUNCATE", "GRANT"]
        for word in forbidden:
            if word in normalized:
                raise ValueError(f"Forbidden SQL keyword detected: {word}")

        cur = self.conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(query, params)
        results = cur.fetchall()
        cur.close()
        return [dict(row) for row in results]


# Singleton instance
database = Database()

FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY pyproject.toml ./
RUN pip install --no-cache-dir httpx anthropic

# Copy application code
COPY services/ ./services/
COPY workflows/ ./workflows/

# Env vars are provided at runtime
ENV AGENTMAIL_API_KEY=""
ENV SUPABASE_URL=""
ENV SUPABASE_SERVICE_KEY=""
ENV ANTHROPIC_API_KEY=""

CMD ["python", "-m", "services.agent_mail.poller", "--config", "/app/services/agent_mail/config.json", "--write", "--watch"]

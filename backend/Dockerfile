FROM python:3.12-slim

# libgomp: LightGBM's OpenMP runtime.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8.22 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY curtail ./curtail
RUN uv sync --frozen --no-dev

ENV CURTAIL_DATA_DIR=/data
EXPOSE 8000
# Hosts such as Render set PORT; docker-compose uses the default.
CMD ["sh", "-c", "exec uv run --no-dev uvicorn curtail.api.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

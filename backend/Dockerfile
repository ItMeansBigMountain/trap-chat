FROM python:3.12-slim

# Which commit this image was built from. The deploy pipeline waits
# until /api/health reports it, so tests cannot run against the
# revision that was serving a moment ago.
ARG GIT_SHA=unknown
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    GIT_SHA=$GIT_SHA

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN rm -f trapchat.db

EXPOSE 8080
# --access-logfile - sends request logs to stdout. Without it Gunicorn logs
# nothing but startup and crashes, so the Container Apps log stream shows no
# trace of what a client actually did, which makes live debugging impossible.
CMD ["sh", "-c", "exec gunicorn --worker-class gthread --workers 1 --threads 100 --timeout 120 --access-logfile - --bind 0.0.0.0:${PORT} app:app"]
